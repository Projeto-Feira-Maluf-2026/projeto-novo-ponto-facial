import hashlib
import importlib.metadata
import logging
import math
from pathlib import Path
from threading import Lock
from time import perf_counter
from typing import Any

import numpy as np

from app.core.config import settings
from app.services.ai.base import (
    FaceBoundingBox,
    FaceFailure,
    FaceInferenceResult,
    FaceLandmark,
    FaceModelInfo,
    FacePose,
    FaceProvider,
    FaceProviderState,
)

logger = logging.getLogger(__name__)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as model_file:
        for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _model_file(model: Any) -> Path | None:
    value = getattr(model, "model_file", None)
    return Path(value).resolve() if value else None


def _reliable_face_candidates(
    faces: list[Any],
    minimum_score: float,
    maximum_score_gap: float,
    secondary_score_cap: float,
) -> tuple[list[Any], float]:
    """Ignore weak detector echoes without hiding a second credible face."""
    best_score = max(
        (float(getattr(candidate, "det_score", 0.0)) for candidate in faces),
        default=0.0,
    )
    threshold = max(
        float(minimum_score),
        min(
            float(secondary_score_cap),
            best_score - float(maximum_score_gap),
        ),
    )
    reliable = [
        candidate
        for candidate in faces
        if float(getattr(candidate, "det_score", 0.0)) >= threshold
    ]
    return reliable, threshold


def _estimate_pose(face: Any, landmarks: list[FaceLandmark]) -> FacePose | None:
    raw_pose = getattr(face, "pose", None)
    if raw_pose is not None:
        values = np.asarray(raw_pose, dtype=np.float32).reshape(-1)
        if values.size >= 3 and np.isfinite(values[:3]).all():
            pitch, yaw, roll = (float(value) for value in values[:3])
            return FacePose(yaw=yaw, pitch=pitch, roll=roll, method="insightface-3d-landmarks")

    if len(landmarks) < 5:
        return None
    left_eye, right_eye, nose, left_mouth, right_mouth = landmarks[:5]
    eye_dx = right_eye.x - left_eye.x
    eye_dy = right_eye.y - left_eye.y
    eye_distance = max(math.hypot(eye_dx, eye_dy), 1e-6)
    eye_mid_x = (left_eye.x + right_eye.x) / 2
    eye_mid_y = (left_eye.y + right_eye.y) / 2
    mouth_mid_x = (left_mouth.x + right_mouth.x) / 2
    mouth_mid_y = (left_mouth.y + right_mouth.y) / 2
    face_axis_height = max(math.hypot(mouth_mid_x - eye_mid_x, mouth_mid_y - eye_mid_y), 1e-6)
    roll = math.degrees(math.atan2(eye_dy, eye_dx))
    yaw = max(-45.0, min(45.0, ((nose.x - eye_mid_x) / eye_distance) * 55.0))
    expected_nose_y = eye_mid_y + face_axis_height * 0.52
    pitch = max(-35.0, min(35.0, ((nose.y - expected_nose_y) / face_axis_height) * 55.0))
    return FacePose(yaw=yaw, pitch=pitch, roll=roll, method="five-landmark-estimate")


class InsightFaceArcFaceProvider(FaceProvider):
    """Real InsightFace provider. It never creates synthetic or fallback embeddings."""

    normalization_version = "insightface-arcface-norm-v1"

    def __init__(
        self,
        *,
        model_pack: str | None = None,
        model_root: Path | None = None,
        execution_providers: list[str] | None = None,
        detection_size: int | None = None,
        detection_sizes: list[tuple[int, int]] | None = None,
        expected_embedding_dimension: int | None = None,
        minimum_detection_confidence: float | None = None,
        expected_model_sha256: str | None = None,
        configured_model_version: str | None = None,
    ) -> None:
        self.model_pack = model_pack or settings.FACE_MODEL_NAME
        self.model_root = model_root or settings.face_model_root
        self.requested_execution_providers = (
            execution_providers or settings.face_execution_providers
        )
        self.detection_sizes = (
            detection_sizes
            or (
                [(detection_size, detection_size)]
                if detection_size is not None
                else settings.face_detection_sizes
            )
        )
        self.expected_embedding_dimension = (
            expected_embedding_dimension or settings.FACE_EXPECTED_EMBEDDING_DIMENSION
        )
        self.minimum_detection_confidence = (
            minimum_detection_confidence
            if minimum_detection_confidence is not None
            else settings.FACE_MIN_DETECTION_CONFIDENCE
        )
        self.expected_model_sha256 = expected_model_sha256 or settings.FACE_MODEL_SHA256
        self.configured_model_version = configured_model_version or settings.FACE_MODEL_VERSION
        self._lock = Lock()
        self._inference_lock = Lock()
        self._app: Any | None = None
        self._recognition_model: Any | None = None
        self._state = FaceProviderState.MODEL_LOAD_FAILED
        self._failure: FaceFailure | None = FaceFailure(
            FaceProviderState.MODEL_LOAD_FAILED,
            "Provider facial ainda nao inicializado",
        )
        self._model_name: str | None = None
        self._model_version: str | None = None
        self._detector_name: str | None = None
        self._execution_provider: str | None = None
        self._embedding_dimension: int | None = None
        self._warmup_ms: float | None = None

    def _set_failure(
        self,
        state: FaceProviderState,
        message: str,
        **details: Any,
    ) -> FaceModelInfo:
        self._state = state
        self._failure = FaceFailure(code=state, message=message, details=details)
        self._app = None
        self._recognition_model = None
        logger.error("Provider facial indisponivel: %s (%s)", state, details)
        return self._current_info()

    def _current_info(self) -> FaceModelInfo:
        return FaceModelInfo(
            provider_name="insightface",
            state=self._state,
            model_name=self._model_name,
            model_version=self._model_version,
            detector_name=self._detector_name,
            normalization_version=self.normalization_version,
            execution_provider=self._execution_provider,
            embedding_dimension=self._embedding_dimension,
            warmup_ms=self._warmup_ms,
            is_real_model=True,
            failure=self._failure,
        )

    def initialize(self) -> FaceModelInfo:
        if self._state == FaceProviderState.READY and self._app is not None:
            return self._current_info()

        with self._lock:
            if self._state == FaceProviderState.READY and self._app is not None:
                return self._current_info()

            model_directory = self.model_root / "models" / self.model_pack
            if not model_directory.is_dir() or not any(model_directory.glob("*.onnx")):
                return self._set_failure(
                    FaceProviderState.MODEL_NOT_FOUND,
                    "Pacote de modelo facial nao encontrado",
                    model_pack=self.model_pack,
                    model_directory=str(model_directory),
                )

            started_at = perf_counter()
            try:
                import onnxruntime as ort
                from insightface.app import FaceAnalysis

                available_providers = ort.get_available_providers()
                selected_providers = [
                    provider
                    for provider in self.requested_execution_providers
                    if provider in available_providers
                ]
                if not selected_providers:
                    return self._set_failure(
                        FaceProviderState.EXECUTION_PROVIDER_UNAVAILABLE,
                        "Nenhum execution provider ONNX solicitado esta disponivel",
                        requested=self.requested_execution_providers,
                        available=available_providers,
                    )

                app = FaceAnalysis(
                    name=self.model_pack,
                    root=str(self.model_root),
                    allowed_modules=["detection", "recognition"],
                    providers=selected_providers,
                )
                ctx_id = 0 if "CUDAExecutionProvider" in selected_providers else -1
                app.prepare(
                    ctx_id=ctx_id,
                    det_thresh=self.minimum_detection_confidence,
                    det_size=self.detection_sizes,
                )
                recognition_model = next(
                    (
                        model
                        for model in app.models.values()
                        if getattr(model, "taskname", "") == "recognition"
                    ),
                    None,
                )
                detection_model = next(
                    (
                        model
                        for model in app.models.values()
                        if getattr(model, "taskname", "") == "detection"
                    ),
                    None,
                )
                if recognition_model is None or detection_model is None:
                    raise RuntimeError("Pacote nao contem os modulos detection e recognition")

                recognition_path = _model_file(recognition_model)
                detection_path = _model_file(detection_model)
                if recognition_path is None or not recognition_path.is_file():
                    raise FileNotFoundError("Arquivo ONNX de reconhecimento nao encontrado")

                recognition_sha256 = _sha256_file(recognition_path)
                if (
                    self.expected_model_sha256
                    and recognition_sha256.lower() != self.expected_model_sha256.lower()
                ):
                    raise ValueError("Checksum do modelo de reconhecimento divergente")

                warmup_embedding = np.asarray(
                    recognition_model.get_feat(np.zeros((112, 112, 3), dtype=np.uint8)),
                    dtype=np.float32,
                ).reshape(-1)
                detection_model.detect(
                    np.zeros((320, 320, 3), dtype=np.uint8),
                    max_num=1,
                )
                if not warmup_embedding.size or not np.isfinite(warmup_embedding).all():
                    raise RuntimeError("Warm-up do modelo retornou embedding invalido")
                if warmup_embedding.size != self.expected_embedding_dimension:
                    raise RuntimeError(
                        "Dimensao do embedding divergente: "
                        f"esperado={self.expected_embedding_dimension}, "
                        f"obtido={warmup_embedding.size}"
                    )

                session = getattr(recognition_model, "session", None)
                runtime_providers = session.get_providers() if session is not None else selected_providers
                package_version = importlib.metadata.version("insightface")
                model_stem = recognition_path.stem
                self._app = app
                self._recognition_model = recognition_model
                self._model_name = f"{self.model_pack}/{model_stem}"
                self._model_version = self.configured_model_version or (
                    f"insightface-{package_version}+sha256.{recognition_sha256[:16]}"
                )
                self._detector_name = detection_path.stem if detection_path else "unknown"
                self._execution_provider = runtime_providers[0] if runtime_providers else None
                self._embedding_dimension = int(warmup_embedding.size)
                self._warmup_ms = round((perf_counter() - started_at) * 1000, 3)
                self._state = FaceProviderState.READY
                self._failure = None
                logger.info(
                    "Provider facial pronto model=%s version=%s execution_provider=%s warmup_ms=%.3f",
                    self._model_name,
                    self._model_version,
                    self._execution_provider,
                    self._warmup_ms,
                )
                return self._current_info()
            except FileNotFoundError as exc:
                return self._set_failure(
                    FaceProviderState.MODEL_NOT_FOUND,
                    "Arquivo do modelo facial nao encontrado",
                    exception_type=type(exc).__name__,
                )
            except Exception as exc:  # native model/runtime failures are normalized here
                logger.exception("Falha ao carregar provider InsightFace")
                return self._set_failure(
                    FaceProviderState.MODEL_LOAD_FAILED,
                    "Falha ao carregar ou aquecer o modelo facial",
                    exception_type=type(exc).__name__,
                )

    def info(self) -> FaceModelInfo:
        return self.initialize()

    def _faces_for_sizes(
        self,
        image_bgr: np.ndarray,
        input_sizes: list[tuple[int, int]],
    ) -> list[Any]:
        if self._app is None:
            return []
        from insightface.app.common import Face

        bboxes, keypoints = self._app.det_model.detect(
            image_bgr,
            input_size=input_sizes,
            max_num=0,
        )
        faces: list[Any] = []
        for index in range(bboxes.shape[0]):
            face = Face(
                bbox=bboxes[index, :4],
                kps=keypoints[index] if keypoints is not None else None,
                det_score=bboxes[index, 4],
            )
            for task_name, model in self._app.models.items():
                if task_name != "detection":
                    model.get(image_bgr, face)
            faces.append(face)
        return faces

    @staticmethod
    def _needs_high_resolution_pass(faces: list[Any], image_bgr: np.ndarray) -> bool:
        if not faces:
            return True
        image_area = max(float(image_bgr.shape[0] * image_bgr.shape[1]), 1.0)
        best_area_ratio = max(
            (
                max(0.0, float(face.bbox[2] - face.bbox[0]))
                * max(0.0, float(face.bbox[3] - face.bbox[1]))
                / image_area
                for face in faces
            ),
            default=0.0,
        )
        return best_area_ratio < 0.028

    def _adaptive_faces(self, image_bgr: np.ndarray) -> list[Any]:
        sizes = list(self.detection_sizes)
        if len(sizes) <= 1:
            return self._faces_for_sizes(image_bgr, sizes)
        # Um recorte vindo do terminal já concentra o rosto. Uma única passagem
        # intermediária é suficiente na maioria dos casos e evita rodar o detector
        # duas ou três vezes antes de cada embedding.
        regular_size = sizes[-2]
        faces = self._faces_for_sizes(image_bgr, [regular_size])
        if not self._needs_high_resolution_pass(faces, image_bgr):
            return faces
        detailed_faces = self._faces_for_sizes(image_bgr, [sizes[-1]])
        return detailed_faces or faces

    def _result_failure(
        self,
        state: FaceProviderState,
        message: str,
        *,
        inference_ms: float,
        face_count: int = 0,
        **details: Any,
    ) -> FaceInferenceResult:
        return FaceInferenceResult(
            state=state,
            face_count=face_count,
            model_name=self._model_name,
            model_version=self._model_version,
            detector_name=self._detector_name,
            normalization_version=self.normalization_version,
            execution_provider=self._execution_provider,
            embedding_dimension=self._embedding_dimension,
            inference_ms=round(inference_ms, 3),
            failure=FaceFailure(code=state, message=message, details=details),
        )

    def analyze(self, image_bgr: np.ndarray) -> FaceInferenceResult:
        info = self.initialize()
        if info.state != FaceProviderState.READY or self._app is None:
            return self._result_failure(
                info.state,
                info.failure.message if info.failure else "Provider facial indisponivel",
                inference_ms=0.0,
                **(info.failure.details if info.failure else {}),
            )

        if not isinstance(image_bgr, np.ndarray) or image_bgr.ndim != 3:
            return self._result_failure(
                FaceProviderState.INVALID_IMAGE,
                "Imagem normalizada invalida",
                inference_ms=0.0,
            )

        started_at = perf_counter()
        try:
            with self._inference_lock:
                faces = self._adaptive_faces(image_bgr)
            elapsed_ms = (perf_counter() - started_at) * 1000
            if not faces:
                return self._result_failure(
                    FaceProviderState.NO_FACE,
                    "Nenhum rosto detectado",
                    inference_ms=elapsed_ms,
                )
            reliable_faces, reliable_threshold = _reliable_face_candidates(
                faces,
                self.minimum_detection_confidence,
                settings.FACE_SECONDARY_FACE_SCORE_GAP,
                settings.FACE_SECONDARY_FACE_CONFIDENCE,
            )
            if len(reliable_faces) != 1:
                return self._result_failure(
                    FaceProviderState.MULTIPLE_FACES,
                    "A imagem deve conter exatamente um rosto",
                    inference_ms=elapsed_ms,
                    face_count=len(reliable_faces),
                    detected_candidates=len(faces),
                    reliable_threshold=round(reliable_threshold, 4),
                )

            face = reliable_faces[0]
            detection_score = float(getattr(face, "det_score", 0.0))
            if detection_score < self.minimum_detection_confidence:
                return self._result_failure(
                    FaceProviderState.LOW_DETECTION_CONFIDENCE,
                    "Confianca da deteccao facial abaixo do limite operacional",
                    inference_ms=elapsed_ms,
                    face_count=1,
                    detection_score=detection_score,
                    minimum_detection_confidence=self.minimum_detection_confidence,
                )

            raw_box = np.asarray(face.bbox, dtype=np.float32).reshape(-1)
            if raw_box.size < 4:
                raise ValueError("Detector retornou bounding box invalida")
            left, top, right, bottom = (float(value) for value in raw_box[:4])
            bounding_box = FaceBoundingBox(
                x=max(0.0, left),
                y=max(0.0, top),
                width=max(0.0, right - left),
                height=max(0.0, bottom - top),
            )
            raw_landmarks = np.asarray(getattr(face, "kps", []), dtype=np.float32)
            landmarks = (
                [FaceLandmark(x=float(point[0]), y=float(point[1])) for point in raw_landmarks]
                if raw_landmarks.ndim == 2 and raw_landmarks.shape[1] >= 2
                else []
            )
            raw_embedding = getattr(face, "normed_embedding", None)
            if raw_embedding is None:
                raw_embedding = getattr(face, "embedding", None)
            vector = np.asarray(raw_embedding, dtype=np.float32).reshape(-1)
            if vector.size != self.expected_embedding_dimension or not np.isfinite(vector).all():
                raise ValueError("Modelo retornou embedding invalido")
            norm = float(np.linalg.norm(vector))
            if norm <= 1e-9:
                raise ValueError("Modelo retornou embedding sem norma")
            vector /= norm

            return FaceInferenceResult(
                state=FaceProviderState.READY,
                face_count=1,
                model_name=self._model_name,
                model_version=self._model_version,
                detector_name=self._detector_name,
                normalization_version=self.normalization_version,
                execution_provider=self._execution_provider,
                embedding_dimension=int(vector.size),
                inference_ms=round(elapsed_ms, 3),
                embedding=vector.tolist(),
                bounding_box=bounding_box,
                landmarks=landmarks,
                detection_score=detection_score,
                pose=_estimate_pose(face, landmarks),
            )
        except Exception as exc:
            logger.exception("Falha durante inferencia facial")
            elapsed_ms = (perf_counter() - started_at) * 1000
            return self._result_failure(
                FaceProviderState.INTERNAL_ERROR,
                "Falha interna durante a inferencia facial",
                inference_ms=elapsed_ms,
                exception_type=type(exc).__name__,
            )
