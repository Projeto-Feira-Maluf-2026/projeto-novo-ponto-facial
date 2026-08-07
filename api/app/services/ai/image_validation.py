import base64
import binascii
import hashlib
import math
import warnings
from dataclasses import dataclass, field
from enum import StrEnum
from io import BytesIO

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import Settings, settings
from app.core.errors import FaceInputError
from app.services.ai.base import FaceInferenceResult, FaceProviderState


class FaceQualityReason(StrEnum):
    PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
    INVALID_BASE64 = "INVALID_BASE64"
    INVALID_IMAGE = "INVALID_IMAGE"
    UNSUPPORTED_MIME = "UNSUPPORTED_MIME"
    MIME_MISMATCH = "MIME_MISMATCH"
    DECOMPRESSION_BOMB = "DECOMPRESSION_BOMB"
    IMAGE_TOO_SMALL = "IMAGE_TOO_SMALL"
    IMAGE_TOO_LARGE = "IMAGE_TOO_LARGE"
    NO_FACE = "NO_FACE"
    MULTIPLE_FACES = "MULTIPLE_FACES"
    LOW_DETECTION_CONFIDENCE = "LOW_DETECTION_CONFIDENCE"
    FACE_TOO_SMALL = "FACE_TOO_SMALL"
    FACE_OUT_OF_FRAME = "FACE_OUT_OF_FRAME"
    FACE_OFF_CENTER = "FACE_OFF_CENTER"
    IMAGE_TOO_BLURRY = "IMAGE_TOO_BLURRY"
    UNDEREXPOSED = "UNDEREXPOSED"
    OVEREXPOSED = "OVEREXPOSED"
    LOW_CONTRAST = "LOW_CONTRAST"
    EXCESSIVE_YAW = "EXCESSIVE_YAW"
    EXCESSIVE_PITCH = "EXCESSIVE_PITCH"
    EXCESSIVE_ROLL = "EXCESSIVE_ROLL"
    LANDMARKS_INSUFFICIENT = "LANDMARKS_INSUFFICIENT"
    LOW_OVERALL_QUALITY = "LOW_OVERALL_QUALITY"
    PROVIDER_ERROR = "PROVIDER_ERROR"


@dataclass(frozen=True)
class ImageMetrics:
    blur_variance: float
    luminance_mean: float
    contrast_stddev: float
    dark_pixel_ratio: float
    bright_pixel_ratio: float


@dataclass(frozen=True)
class ValidatedFaceImage:
    image_bgr: np.ndarray
    original_bytes: bytes
    sha256: str
    mime_type: str
    width: int
    height: int
    image_metrics: ImageMetrics


@dataclass(frozen=True)
class FaceQualityMetrics:
    blur_variance: float
    luminance_mean: float
    contrast_stddev: float
    dark_pixel_ratio: float
    bright_pixel_ratio: float
    face_area_ratio: float | None = None
    center_offset: float | None = None
    landmark_visibility_ratio: float | None = None
    yaw_degrees: float | None = None
    pitch_degrees: float | None = None
    roll_degrees: float | None = None
    occlusion_score: float | None = None
    eyes_closed: bool | None = None


@dataclass(frozen=True)
class FaceQualityReport:
    accepted: bool
    quality_score: float
    reasons: list[FaceQualityReason]
    metrics: FaceQualityMetrics
    threshold_profile: str
    thresholds_calibrated: bool
    limitations: list[str] = field(default_factory=list)


class FaceImageValidator:
    allowed_formats = {
        "JPEG": "image/jpeg",
        "PNG": "image/png",
        "WEBP": "image/webp",
    }

    def __init__(self, config: Settings = settings) -> None:
        self.config = config

    def from_base64(self, image_base64: str) -> ValidatedFaceImage:
        if not image_base64:
            raise FaceInputError(
                FaceQualityReason.INVALID_BASE64,
                "A imagem base64 e obrigatoria",
            )

        declared_mime: str | None = None
        encoded = image_base64.strip()
        if encoded.startswith("data:"):
            try:
                header, encoded = encoded.split(",", 1)
                media_declaration, encoding = header[5:].split(";", 1)
            except ValueError as exc:
                raise FaceInputError(
                    FaceQualityReason.INVALID_BASE64,
                    "Data URI de imagem invalida",
                ) from exc
            if encoding.lower() != "base64":
                raise FaceInputError(
                    FaceQualityReason.INVALID_BASE64,
                    "A imagem deve usar codificacao base64",
                )
            declared_mime = media_declaration.lower()

        maximum_encoded_size = math.ceil(self.config.FACE_MAX_IMAGE_BYTES / 3) * 4 + 4
        if len(encoded) > maximum_encoded_size:
            raise FaceInputError(
                FaceQualityReason.PAYLOAD_TOO_LARGE,
                "A imagem excede o limite de payload",
                maximum_bytes=self.config.FACE_MAX_IMAGE_BYTES,
            )
        try:
            image_bytes = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise FaceInputError(
                FaceQualityReason.INVALID_BASE64,
                "Imagem base64 invalida",
            ) from exc
        return self.from_bytes(image_bytes, declared_mime=declared_mime)

    def from_bytes(
        self,
        image_bytes: bytes,
        *,
        declared_mime: str | None = None,
    ) -> ValidatedFaceImage:
        if not image_bytes:
            raise FaceInputError(FaceQualityReason.INVALID_IMAGE, "A imagem esta vazia")
        if len(image_bytes) > self.config.FACE_MAX_IMAGE_BYTES:
            raise FaceInputError(
                FaceQualityReason.PAYLOAD_TOO_LARGE,
                "A imagem excede o limite de payload",
                maximum_bytes=self.config.FACE_MAX_IMAGE_BYTES,
                received_bytes=len(image_bytes),
            )

        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(BytesIO(image_bytes)) as source:
                    image_format = (source.format or "").upper()
                    actual_mime = self.allowed_formats.get(image_format)
                    if actual_mime is None:
                        raise FaceInputError(
                            FaceQualityReason.UNSUPPORTED_MIME,
                            "Formato real da imagem nao permitido",
                            allowed_mime_types=sorted(self.allowed_formats.values()),
                        )
                    width, height = source.size
                    if width * height > self.config.FACE_MAX_IMAGE_PIXELS:
                        raise FaceInputError(
                            FaceQualityReason.DECOMPRESSION_BOMB,
                            "A imagem excede o limite seguro de pixels",
                            maximum_pixels=self.config.FACE_MAX_IMAGE_PIXELS,
                        )
                    if (
                        width < self.config.FACE_MIN_IMAGE_WIDTH
                        or height < self.config.FACE_MIN_IMAGE_HEIGHT
                    ):
                        raise FaceInputError(
                            FaceQualityReason.IMAGE_TOO_SMALL,
                            "As dimensoes da imagem sao insuficientes",
                            minimum_width=self.config.FACE_MIN_IMAGE_WIDTH,
                            minimum_height=self.config.FACE_MIN_IMAGE_HEIGHT,
                            width=width,
                            height=height,
                        )
                    source.load()
                    normalized = ImageOps.exif_transpose(source).convert("RGB")
        except FaceInputError:
            raise
        except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise FaceInputError(
                FaceQualityReason.DECOMPRESSION_BOMB,
                "A imagem excede os limites seguros de descompressao",
            ) from exc
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise FaceInputError(
                FaceQualityReason.INVALID_IMAGE,
                "O payload nao contem uma imagem valida",
            ) from exc

        if declared_mime and declared_mime != actual_mime:
            raise FaceInputError(
                FaceQualityReason.MIME_MISMATCH,
                "O MIME declarado nao corresponde ao conteudo da imagem",
                declared_mime=declared_mime,
                actual_mime=actual_mime,
            )

        rgb = np.asarray(normalized, dtype=np.uint8)
        image_bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        height, width = image_bgr.shape[:2]
        metrics = self._image_metrics(image_bgr)
        return ValidatedFaceImage(
            image_bgr=image_bgr,
            original_bytes=image_bytes,
            sha256=hashlib.sha256(image_bytes).hexdigest(),
            mime_type=actual_mime,
            width=width,
            height=height,
            image_metrics=metrics,
        )

    @staticmethod
    def _image_metrics(image_bgr: np.ndarray) -> ImageMetrics:
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        return ImageMetrics(
            blur_variance=float(cv2.Laplacian(gray, cv2.CV_64F).var()),
            luminance_mean=float(gray.mean()),
            contrast_stddev=float(gray.std()),
            dark_pixel_ratio=float(np.mean(gray <= 12)),
            bright_pixel_ratio=float(np.mean(gray >= 243)),
        )

    @staticmethod
    def perceptual_hash(image_bgr: np.ndarray) -> str:
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        resized = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
        bits = (resized[:, 1:] > resized[:, :-1]).reshape(-1)
        value = sum(int(bit) << index for index, bit in enumerate(bits))
        return f"{value:016x}"

    @staticmethod
    def perceptual_distance(left: str, right: str) -> int:
        return (int(left, 16) ^ int(right, 16)).bit_count()

    def quality_report(
        self,
        image: ValidatedFaceImage,
        inference: FaceInferenceResult,
    ) -> FaceQualityReport:
        reasons: list[FaceQualityReason] = []
        limitations = [
            "Occlusion and closed-eye PAD require a validated dedicated model and are not inferred from five ArcFace landmarks.",
        ]
        initial = image.image_metrics
        face_area_ratio: float | None = None
        center_offset: float | None = None
        landmark_visibility_ratio: float | None = None
        face_metrics = initial

        failure_reason_map = {
            FaceProviderState.NO_FACE: FaceQualityReason.NO_FACE,
            FaceProviderState.MULTIPLE_FACES: FaceQualityReason.MULTIPLE_FACES,
            FaceProviderState.LOW_DETECTION_CONFIDENCE: (
                FaceQualityReason.LOW_DETECTION_CONFIDENCE
            ),
        }
        if inference.state != FaceProviderState.READY:
            reasons.append(
                failure_reason_map.get(inference.state, FaceQualityReason.PROVIDER_ERROR)
            )

        box = inference.bounding_box
        if box is not None:
            left = max(0, int(math.floor(box.x)))
            top = max(0, int(math.floor(box.y)))
            right = min(image.width, int(math.ceil(box.x + box.width)))
            bottom = min(image.height, int(math.ceil(box.y + box.height)))
            if right > left and bottom > top:
                face_metrics = self._image_metrics(image.image_bgr[top:bottom, left:right])
            face_area_ratio = (box.width * box.height) / max(image.width * image.height, 1)
            center_x = box.x + box.width / 2
            center_y = box.y + box.height / 2
            center_offset = math.hypot(
                (center_x / image.width) - 0.5,
                (center_y / image.height) - 0.5,
            )
            edge_tolerance = max(2.0, min(image.width, image.height) * 0.006)
            if (
                box.x <= edge_tolerance
                or box.y <= edge_tolerance
                or box.x + box.width >= image.width - edge_tolerance
                or box.y + box.height >= image.height - edge_tolerance
            ):
                reasons.append(FaceQualityReason.FACE_OUT_OF_FRAME)
            if face_area_ratio < self.config.FACE_MIN_FACE_AREA_RATIO:
                reasons.append(FaceQualityReason.FACE_TOO_SMALL)
            if center_offset > self.config.FACE_MAX_CENTER_OFFSET:
                reasons.append(FaceQualityReason.FACE_OFF_CENTER)

            if inference.landmarks:
                visible = sum(
                    1
                    for point in inference.landmarks
                    if box.x <= point.x <= box.x + box.width
                    and box.y <= point.y <= box.y + box.height
                )
                landmark_visibility_ratio = visible / len(inference.landmarks)
            if len(inference.landmarks) < 5 or (landmark_visibility_ratio or 0.0) < 1.0:
                reasons.append(FaceQualityReason.LANDMARKS_INSUFFICIENT)

        if face_metrics.blur_variance < self.config.FACE_MIN_BLUR_VARIANCE:
            reasons.append(FaceQualityReason.IMAGE_TOO_BLURRY)
        if face_metrics.luminance_mean < self.config.FACE_MIN_LUMINANCE:
            reasons.append(FaceQualityReason.UNDEREXPOSED)
        if face_metrics.luminance_mean > self.config.FACE_MAX_LUMINANCE:
            reasons.append(FaceQualityReason.OVEREXPOSED)
        if face_metrics.contrast_stddev < self.config.FACE_MIN_CONTRAST:
            reasons.append(FaceQualityReason.LOW_CONTRAST)

        pose = inference.pose
        if pose:
            if abs(pose.yaw) > self.config.FACE_MAX_YAW_DEGREES:
                reasons.append(FaceQualityReason.EXCESSIVE_YAW)
            if abs(pose.pitch) > self.config.FACE_MAX_PITCH_DEGREES:
                reasons.append(FaceQualityReason.EXCESSIVE_PITCH)
            if abs(pose.roll) > self.config.FACE_MAX_ROLL_DEGREES:
                reasons.append(FaceQualityReason.EXCESSIVE_ROLL)

        blur_component = min(
            1.0,
            face_metrics.blur_variance / max(self.config.FACE_MIN_BLUR_VARIANCE * 1.8, 1.0),
        )
        exposure_component = max(0.0, 1.0 - abs(face_metrics.luminance_mean - 130.0) / 130.0)
        contrast_component = min(
            1.0,
            face_metrics.contrast_stddev / max(self.config.FACE_MIN_CONTRAST * 1.8, 1.0),
        )
        size_component = min(1.0, (face_area_ratio or 0.0) / 0.18)
        center_component = max(
            0.0,
            1.0 - (center_offset or 1.0) / max(self.config.FACE_MAX_CENTER_OFFSET, 1e-6),
        )
        detection_component = float(inference.detection_score or 0.0)
        quality_score = round(
            max(
                0.0,
                min(
                    1.0,
                    blur_component * 0.20
                    + exposure_component * 0.18
                    + contrast_component * 0.14
                    + size_component * 0.18
                    + center_component * 0.14
                    + detection_component * 0.16,
                ),
            ),
            4,
        )
        if quality_score < self.config.FACE_MIN_QUALITY:
            reasons.append(FaceQualityReason.LOW_OVERALL_QUALITY)

        unique_reasons = list(dict.fromkeys(reasons))
        metrics = FaceQualityMetrics(
            blur_variance=round(face_metrics.blur_variance, 3),
            luminance_mean=round(face_metrics.luminance_mean, 3),
            contrast_stddev=round(face_metrics.contrast_stddev, 3),
            dark_pixel_ratio=round(face_metrics.dark_pixel_ratio, 5),
            bright_pixel_ratio=round(face_metrics.bright_pixel_ratio, 5),
            face_area_ratio=round(face_area_ratio, 5) if face_area_ratio is not None else None,
            center_offset=round(center_offset, 5) if center_offset is not None else None,
            landmark_visibility_ratio=(
                round(landmark_visibility_ratio, 4)
                if landmark_visibility_ratio is not None
                else None
            ),
            yaw_degrees=round(pose.yaw, 3) if pose else None,
            pitch_degrees=round(pose.pitch, 3) if pose else None,
            roll_degrees=round(pose.roll, 3) if pose else None,
            occlusion_score=None,
            eyes_closed=None,
        )
        return FaceQualityReport(
            accepted=not unique_reasons,
            quality_score=quality_score,
            reasons=unique_reasons,
            metrics=metrics,
            threshold_profile=self.config.FACE_THRESHOLD_PROFILE,
            thresholds_calibrated=self.config.FACE_THRESHOLDS_CALIBRATED,
            limitations=limitations,
        )
