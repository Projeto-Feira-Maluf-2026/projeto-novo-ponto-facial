from collections.abc import Mapping
from dataclasses import dataclass, replace
from functools import lru_cache
from itertools import islice
from math import isfinite
from statistics import median
from time import perf_counter

import numpy as np
import cv2

from app.core.config import Settings, settings
from app.core.errors import FaceServiceUnavailableError
from app.services.ai.base import (
    FaceBoundingBox,
    FaceInferenceResult,
    FaceLandmark,
    FaceProvider,
    FaceProviderState,
)
from app.services.ai.fake_provider import FakeFaceProvider
from app.services.ai.image_validation import (
    FaceImageValidator,
    FaceQualityReason,
    FaceQualityReport,
    ValidatedFaceImage,
)
from app.services.ai.insightface_provider import InsightFaceArcFaceProvider


@dataclass(frozen=True)
class RankedFaceMatch:
    employee_id: str
    score: float
    best_score: float
    template_count: int
    centroid_score: float = 0.0
    robust_score: float = 0.0
    rejected_template_count: int = 0


@dataclass(frozen=True)
class TemplateCandidate:
    template_id: str
    embedding: bytes
    quality_score: float


@dataclass(frozen=True)
class _PreparedGalleryBatch:
    identities: tuple[tuple[str, int, int, int], ...]
    normalized: np.ndarray
    valid: np.ndarray
    qualities: np.ndarray
    centroids: np.ndarray


@dataclass(frozen=True)
class PreparedFaceGallery:
    """Request/cache-owned derived vectors; never persisted or sent to a client."""

    dimension: int
    batches: tuple[_PreparedGalleryBatch, ...]
    source_template_count: int


@dataclass(frozen=True)
class ProcessedFace:
    image: ValidatedFaceImage
    inference: FaceInferenceResult
    quality: FaceQualityReport
    total_ms: float


def _enhanced_detection_frames(image_bgr: np.ndarray) -> list[np.ndarray]:
    """Build conservative variants for dark, low-contrast or soft camera frames."""
    lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB)
    luminance, channel_a, channel_b = cv2.split(lab)

    balanced_luminance = cv2.createCLAHE(
        clipLimit=2.0,
        tileGridSize=(8, 8),
    ).apply(luminance)
    balanced = cv2.cvtColor(
        cv2.merge((balanced_luminance, channel_a, channel_b)),
        cv2.COLOR_LAB2BGR,
    )
    balanced_blur = cv2.GaussianBlur(balanced, (0, 0), 0.9)
    balanced = cv2.addWeighted(balanced, 1.28, balanced_blur, -0.28, 0)

    aggressive_luminance = cv2.createCLAHE(
        clipLimit=3.2,
        tileGridSize=(6, 6),
    ).apply(luminance)
    if float(np.mean(aggressive_luminance)) < 105.0:
        lookup = np.array(
            [min(255, round(((value / 255.0) ** 0.72) * 255.0)) for value in range(256)],
            dtype=np.uint8,
        )
        aggressive_luminance = cv2.LUT(aggressive_luminance, lookup)
    aggressive = cv2.cvtColor(
        cv2.merge((aggressive_luminance, channel_a, channel_b)),
        cv2.COLOR_LAB2BGR,
    )
    aggressive = cv2.bilateralFilter(aggressive, 5, 28, 28)
    return [balanced, aggressive]


def _analyze_original_from_detection(
    provider: FaceProvider,
    image_bgr: np.ndarray,
    detected: FaceInferenceResult,
) -> FaceInferenceResult:
    """Use an enhanced frame only as a locator; embed an aligned original-pixel crop."""
    box = detected.bounding_box
    if box is None or box.width <= 0 or box.height <= 0:
        return provider.analyze(image_bgr)
    image_height, image_width = image_bgr.shape[:2]
    padding_x = box.width * 0.34
    padding_y = box.height * 0.42
    left = max(0, int(box.x - padding_x))
    top = max(0, int(box.y - padding_y))
    right = min(image_width, int(box.x + box.width + padding_x))
    bottom = min(image_height, int(box.y + box.height + padding_y))
    if right - left < 48 or bottom - top < 48:
        return provider.analyze(image_bgr)

    crop = image_bgr[top:bottom, left:right]
    shortest = min(crop.shape[:2])
    scale = min(2.5, max(1.0, 420.0 / max(shortest, 1)))
    if scale > 1.01:
        crop = cv2.resize(
            crop,
            None,
            fx=scale,
            fy=scale,
            interpolation=cv2.INTER_CUBIC,
        )
    canonical = provider.analyze(crop)
    if canonical.state != FaceProviderState.READY or canonical.embedding is None:
        return canonical

    canonical_box = canonical.bounding_box
    mapped_box = None
    if canonical_box is not None:
        mapped_box = FaceBoundingBox(
            x=(canonical_box.x / scale) + left,
            y=(canonical_box.y / scale) + top,
            width=canonical_box.width / scale,
            height=canonical_box.height / scale,
        )
    mapped_landmarks = [
        FaceLandmark(
            x=(landmark.x / scale) + left,
            y=(landmark.y / scale) + top,
        )
        for landmark in canonical.landmarks
    ]
    return replace(
        canonical,
        bounding_box=mapped_box,
        landmarks=mapped_landmarks,
        inference_ms=round(detected.inference_ms + canonical.inference_ms, 3),
    )


def serialize_embedding(vector: list[float]) -> bytes:
    arr = np.asarray(vector, dtype=np.float32)
    return arr.tobytes()


def deserialize_embedding(blob: bytes) -> np.ndarray:
    vector = np.frombuffer(blob, dtype=np.float32)
    return _normalize_embedding(vector)


def _normalize_embedding(vector: list[float] | np.ndarray) -> np.ndarray:
    arr = np.asarray(vector, dtype=np.float32)
    if arr.ndim != 1 or not arr.size or not np.isfinite(arr).all():
        raise ValueError("Embedding deve ser um vetor finito nao vazio")
    # Accumulate in float64 so finite float32 values cannot overflow the norm.
    norm = float(np.linalg.norm(arr.astype(np.float64)))
    if not isfinite(norm) or norm <= 1e-9:
        raise ValueError("Embedding deve ter norma finita e positiva")
    return np.asarray(arr.astype(np.float64) / norm, dtype=np.float32)


def cosine_similarity(
    left: list[float] | np.ndarray,
    right: bytes | list[float] | np.ndarray,
) -> float:
    try:
        left_arr = _normalize_embedding(left)
        right_arr = (
            deserialize_embedding(right)
            if isinstance(right, bytes)
            else _normalize_embedding(right)
        )
    except (TypeError, ValueError):
        return 0.0
    if left_arr.shape != right_arr.shape:
        return 0.0
    return float(np.dot(left_arr, right_arr))


def _clamp_score(value: float) -> float:
    if not isfinite(float(value)):
        return 0.0
    return max(0.0, min(1.0, float(value)))


def prepare_face_gallery(
    candidates_by_employee: Mapping[str, list[TemplateCandidate]],
    dimension: int,
) -> PreparedFaceGallery:
    """Normalize templates and calculate centroids once per gallery snapshot."""
    batches = []
    maximum_templates = max(1, int(settings.FACE_IDENTITY_MAX_TEMPLATES))
    minimum_quality = float(settings.FACE_MATCH_MIN_TEMPLATE_QUALITY)

    # Bound temporary matrices: never materialize the complete tenant gallery.
    identities = iter(candidates_by_employee.items())
    while batch := list(islice(identities, 256)):
        prepared = []
        raw_vectors = []
        raw_qualities = []
        for employee_id, candidates in batch:
            eligible = sorted(
                (
                    candidate
                    for candidate in candidates
                    if isfinite(float(candidate.quality_score))
                    and minimum_quality <= float(candidate.quality_score) <= 1.0
                ),
                key=lambda candidate: (-float(candidate.quality_score), candidate.template_id),
            )[:maximum_templates]
            rejected_count = len(candidates) - len(eligible)
            qualities = []
            start = len(raw_vectors)
            for candidate in eligible:
                try:
                    vector = np.frombuffer(candidate.embedding, dtype=np.float32)
                except (TypeError, ValueError):
                    rejected_count += 1
                    continue
                if vector.shape != (dimension,):
                    rejected_count += 1
                    continue
                raw_vectors.append(vector)
                qualities.append(_clamp_score(candidate.quality_score))
            if len(raw_vectors) > start:
                raw_qualities.extend(qualities)
                prepared.append((employee_id, start, len(raw_vectors), qualities, rejected_count))
        if not raw_vectors:
            continue
        matrix = np.stack(raw_vectors)
        # float64 accumulation preserves overflow protection from scalar normalization.
        norms = np.linalg.norm(matrix.astype(np.float64), axis=1)
        valid = np.isfinite(matrix).all(axis=1) & np.isfinite(norms) & (norms > 1e-9)
        normalized = np.zeros_like(matrix)
        np.divide(matrix.astype(np.float64), norms[:, None], out=normalized, where=valid[:, None])
        weights = np.maximum(np.asarray(raw_qualities), 1e-6) * valid
        starts = [entry[1] for entry in prepared]
        weight_totals = np.add.reduceat(weights, starts)
        centroids = np.add.reduceat(
            normalized.astype(np.float64) * weights[:, None], starts, axis=0
        )
        np.divide(
            centroids, weight_totals[:, None], out=centroids, where=weight_totals[:, None] > 0
        )
        centroid_norms = np.maximum(np.linalg.norm(centroids, axis=1), 1e-9)
        centroids /= centroid_norms[:, None]
        qualities = np.asarray(raw_qualities)
        for array in (normalized, valid, qualities, centroids):
            array.setflags(write=False)
        batches.append(_PreparedGalleryBatch(
            identities=tuple((employee_id, start, end, rejected_count)
                             for employee_id, start, end, _, rejected_count in prepared),
            normalized=normalized, valid=valid, qualities=qualities, centroids=centroids,
        ))
    return PreparedFaceGallery(
        dimension, tuple(batches), sum(len(items) for items in candidates_by_employee.values()),
    )


def rank_identity_candidates(
    query_embedding: list[float] | np.ndarray,
    candidates_by_employee: Mapping[str, list[TemplateCandidate]] | PreparedFaceGallery,
) -> list[RankedFaceMatch]:
    """Score a fresh query with unchanged quality, centroid and ambiguity rules."""
    try:
        query = _normalize_embedding(query_embedding)
    except (TypeError, ValueError):
        return []
    gallery = (
        candidates_by_employee if isinstance(candidates_by_employee, PreparedFaceGallery)
        else prepare_face_gallery(candidates_by_employee, len(query))
    )
    if gallery.dimension != len(query):
        return []
    ranked: list[RankedFaceMatch] = []
    top_k = max(1, int(settings.FACE_IDENTITY_TOP_K))
    for batch in gallery.batches:
        similarities = np.einsum("ij,j->i", batch.normalized, query)
        centroid_scores = np.clip(np.einsum("ij,j->i", batch.centroids, query), 0.0, 1.0)
        for index, (employee_id, start, end, rejected_count) in enumerate(batch.identities):
            mask = batch.valid[start:end]
            template_count = int(np.count_nonzero(mask))
            rejected_count += int(np.count_nonzero(~mask))
            if not template_count:
                continue
            qualities = batch.qualities[start:end][mask]
            individual_scores = (
                np.clip(similarities[start:end][mask], 0.0, 1.0) * (0.85 + 0.15 * qualities)
            ).tolist()
            centroid_score = float(centroid_scores[index])
            strongest = sorted(individual_scores, reverse=True)[:top_k]
            robust_score = _clamp_score(float(median(strongest)))
            aggregate_score = _clamp_score((centroid_score * 0.55) + (robust_score * 0.45))
            ranked.append(
                RankedFaceMatch(
                    employee_id=employee_id,
                    score=aggregate_score,
                    best_score=_clamp_score(max(individual_scores)),
                    template_count=template_count,
                    centroid_score=centroid_score,
                    robust_score=robust_score,
                    rejected_template_count=rejected_count,
                )
            )
    return sorted(ranked, key=lambda item: item.score, reverse=True)


def face_match_margin(best_score: float, second_best_score: float | None) -> float | None:
    if second_best_score is None:
        return None
    return round(max(0.0, float(best_score) - float(second_best_score)), 4)


def is_face_match_ambiguous(best_score: float, second_best_score: float | None) -> bool:
    if second_best_score is None:
        return False
    required_margin = float(settings.FACE_MATCH_MARGIN)
    if best_score >= settings.FACE_STRONG_SIMILARITY:
        required_margin *= 0.55
    return (float(best_score) - float(second_best_score)) < required_margin


def face_match_confidence_score(
    best_score: float,
    second_best_score: float | None = None,
) -> float:
    strong_span = max(
        float(settings.FACE_STRONG_SIMILARITY) - float(settings.FACE_MIN_SIMILARITY),
        1e-6,
    )
    score_component = _clamp_score(
        (float(best_score) - float(settings.FACE_MIN_SIMILARITY)) / strong_span
    )
    if second_best_score is None:
        margin_component = 1.0
    else:
        margin = max(0.0, float(best_score) - float(second_best_score))
        margin_component = _clamp_score(margin / max(float(settings.FACE_MATCH_MARGIN), 1e-6))
    confidence = 0.52 + (score_component * 0.37) + (margin_component * 0.10)
    return round(min(0.99, max(0.0, confidence)), 4)


@lru_cache
def get_face_provider() -> FaceProvider:
    provider_name = settings.FACE_PROVIDER.lower()
    if provider_name == "insightface":
        return InsightFaceArcFaceProvider()
    if provider_name == "fake" and settings.ENVIRONMENT == "test":
        return FakeFaceProvider(settings.FACE_EXPECTED_EMBEDDING_DIMENSION)
    raise RuntimeError(
        f"FACE_PROVIDER={provider_name!r} nao e permitido em ENVIRONMENT={settings.ENVIRONMENT!r}"
    )


class FaceEmbeddingService:
    def __init__(
        self,
        provider: FaceProvider | None = None,
        validator: FaceImageValidator | None = None,
        config: Settings = settings,
    ) -> None:
        self.config = config
        self.provider = provider or get_face_provider()
        self.validator = validator or FaceImageValidator(config)

    def from_image_base64(self, image_base64: str) -> ProcessedFace:
        started_at = perf_counter()
        image = self.validator.from_base64(image_base64)
        return self._process_validated_image(image, started_at=started_at)

    def from_mirrored_image(self, image: ValidatedFaceImage) -> ProcessedFace:
        """Run a conditional flip-test without decoding or trusting a new payload."""
        started_at = perf_counter()
        mirrored = replace(
            image,
            image_bgr=np.ascontiguousarray(image.image_bgr[:, ::-1]),
        )
        return self._process_validated_image(mirrored, started_at=started_at)

    def _process_validated_image(
        self,
        image: ValidatedFaceImage,
        *,
        started_at: float,
    ) -> ProcessedFace:
        if (
            self.config.ENVIRONMENT in {"staging", "production"}
            and not self.config.FACE_THRESHOLDS_CALIBRATED
        ):
            raise FaceServiceUnavailableError(
                code="THRESHOLDS_NOT_CALIBRATED",
                message="Operacoes faciais estao bloqueadas sem calibracao aprovada",
                threshold_profile=self.config.FACE_THRESHOLD_PROFILE,
            )
        provider_info = self.provider.info()
        if provider_info.state != FaceProviderState.READY:
            failure = provider_info.failure
            raise FaceServiceUnavailableError(
                code=provider_info.state.value,
                message=failure.message if failure else "Provider facial indisponivel",
                provider_state=provider_info.state.value,
                **(failure.details if failure else {}),
            )

        inference = self.provider.analyze(image.image_bgr)
        quality = self.validator.quality_report(image, inference)
        # Blur, exposicao e contraste sao medidos sobre os pixels originais. Um
        # quadro realcado so muda a localizacao do rosto, entao repetir a
        # inferencia por esses motivos custava ate quatro passadas extras sem
        # alterar o resultado. O realce continua para rosto nao encontrado,
        # deteccao fraca e qualidade geral baixa, onde a caixa influencia a nota.
        retryable_quality_reasons = {
            FaceQualityReason.NO_FACE,
            FaceQualityReason.LOW_DETECTION_CONFIDENCE,
            FaceQualityReason.LOW_OVERALL_QUALITY,
        }
        unavailable_states = {
            FaceProviderState.MODEL_NOT_FOUND,
            FaceProviderState.MODEL_LOAD_FAILED,
            FaceProviderState.EXECUTION_PROVIDER_UNAVAILABLE,
            FaceProviderState.INTERNAL_ERROR,
        }
        should_retry = inference.state in {
            FaceProviderState.NO_FACE,
            FaceProviderState.LOW_DETECTION_CONFIDENCE,
        } or (
            inference.state == FaceProviderState.READY
            and bool(set(quality.reasons) & retryable_quality_reasons)
        )
        locate = getattr(self.provider, "locate", self.provider.analyze)

        if should_retry:
            best_ready = (
                (inference, quality) if inference.state == FaceProviderState.READY else None
            )
            for enhanced_bgr in _enhanced_detection_frames(image.image_bgr):
                locator_inference = locate(enhanced_bgr)
                if locator_inference.state in unavailable_states | {
                    FaceProviderState.MULTIPLE_FACES
                }:
                    inference = locator_inference
                    quality = self.validator.quality_report(image, locator_inference)
                    break
                if locator_inference.state != FaceProviderState.READY:
                    continue
                canonical_inference = _analyze_original_from_detection(
                    self.provider,
                    image.image_bgr,
                    locator_inference,
                )
                if canonical_inference.state in unavailable_states | {
                    FaceProviderState.MULTIPLE_FACES
                }:
                    inference = canonical_inference
                    quality = self.validator.quality_report(image, canonical_inference)
                    break
                if canonical_inference.state != FaceProviderState.READY:
                    continue
                canonical_quality = self.validator.quality_report(image, canonical_inference)
                if (
                    best_ready is None
                    or canonical_quality.quality_score > best_ready[1].quality_score
                ):
                    best_ready = (canonical_inference, canonical_quality)
                if canonical_quality.accepted:
                    break
            else:
                if best_ready is not None:
                    inference, quality = best_ready

            if (
                inference.state not in unavailable_states | {FaceProviderState.MULTIPLE_FACES}
                and best_ready is not None
            ):
                inference, quality = best_ready

        if inference.state in unavailable_states:
            failure = inference.failure
            raise FaceServiceUnavailableError(
                code=inference.state.value,
                message=failure.message if failure else "Inferencia facial indisponivel",
                provider_state=inference.state.value,
                **(failure.details if failure else {}),
            )
        return ProcessedFace(
            image=image,
            inference=inference,
            quality=quality,
            total_ms=round((perf_counter() - started_at) * 1000, 3),
        )
