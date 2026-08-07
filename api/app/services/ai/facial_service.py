from collections.abc import Mapping
from dataclasses import dataclass, replace
from functools import lru_cache
from statistics import median
from time import perf_counter

import numpy as np
import cv2

from app.core.config import Settings, settings
from app.core.errors import FaceServiceUnavailableError
from app.services.ai.base import FaceInferenceResult, FaceProvider, FaceProviderState
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
            [
                min(255, round(((value / 255.0) ** 0.72) * 255.0))
                for value in range(256)
            ],
            dtype=np.uint8,
        )
        aggressive_luminance = cv2.LUT(aggressive_luminance, lookup)
    aggressive = cv2.cvtColor(
        cv2.merge((aggressive_luminance, channel_a, channel_b)),
        cv2.COLOR_LAB2BGR,
    )
    aggressive = cv2.bilateralFilter(aggressive, 5, 28, 28)
    return [balanced, aggressive]


def serialize_embedding(vector: list[float]) -> bytes:
    arr = np.asarray(vector, dtype=np.float32)
    return arr.tobytes()


def deserialize_embedding(blob: bytes) -> np.ndarray:
    vector = np.frombuffer(blob, dtype=np.float32)
    return vector / max(float(np.linalg.norm(vector)), 1e-9)


def cosine_similarity(
    left: list[float] | np.ndarray,
    right: bytes | list[float] | np.ndarray,
) -> float:
    left_arr = np.asarray(left, dtype=np.float32)
    if isinstance(right, bytes):
        right_arr = deserialize_embedding(right)
    else:
        right_arr = np.asarray(right, dtype=np.float32)
    if left_arr.size == 0 or right_arr.size == 0 or left_arr.shape != right_arr.shape:
        return 0.0
    left_arr = left_arr / max(float(np.linalg.norm(left_arr)), 1e-9)
    right_arr = right_arr / max(float(np.linalg.norm(right_arr)), 1e-9)
    return float(np.dot(left_arr, right_arr))


def _clamp_score(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def rank_identity_candidates(
    query_embedding: list[float] | np.ndarray,
    candidates_by_employee: Mapping[str, list[TemplateCandidate]],
) -> list[RankedFaceMatch]:
    """Rank identities with a quality-weighted centroid and a robust per-template score.

    Templates are quality-gated and capped before scoring. This keeps an identity from
    gaining weight merely because it has more stored captures.
    """
    query = np.asarray(query_embedding, dtype=np.float32)
    query_norm = float(np.linalg.norm(query))
    if query.size == 0 or query_norm <= 1e-9:
        return []
    query = query / query_norm

    ranked: list[RankedFaceMatch] = []
    maximum_templates = max(1, int(settings.FACE_IDENTITY_MAX_TEMPLATES))
    top_k = max(1, int(settings.FACE_IDENTITY_TOP_K))
    minimum_quality = float(settings.FACE_MATCH_MIN_TEMPLATE_QUALITY)

    for employee_id, candidates in candidates_by_employee.items():
        eligible = sorted(
            (
                candidate
                for candidate in candidates
                if float(candidate.quality_score) >= minimum_quality
            ),
            key=lambda candidate: (-float(candidate.quality_score), candidate.template_id),
        )[:maximum_templates]
        rejected_count = len(candidates) - len(eligible)
        if not eligible:
            continue

        vectors: list[np.ndarray] = []
        qualities: list[float] = []
        individual_scores: list[float] = []
        for candidate in eligible:
            vector = deserialize_embedding(candidate.embedding)
            if vector.shape != query.shape:
                rejected_count += 1
                continue
            quality = _clamp_score(candidate.quality_score)
            vectors.append(vector)
            qualities.append(max(quality, 1e-6))
            similarity = float(np.dot(query, vector))
            individual_scores.append(_clamp_score(similarity) * (0.85 + (0.15 * quality)))

        if not vectors:
            continue
        centroid = np.average(np.stack(vectors), axis=0, weights=np.asarray(qualities))
        centroid /= max(float(np.linalg.norm(centroid)), 1e-9)
        centroid_score = _clamp_score(float(np.dot(query, centroid)))
        strongest = sorted(individual_scores, reverse=True)[:top_k]
        robust_score = _clamp_score(float(median(strongest)))
        aggregate_score = _clamp_score((centroid_score * 0.55) + (robust_score * 0.45))
        ranked.append(
            RankedFaceMatch(
                employee_id=employee_id,
                score=aggregate_score,
                best_score=_clamp_score(max(individual_scores)),
                template_count=len(vectors),
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

        selected_image = image
        inference = self.provider.analyze(image.image_bgr)
        quality = self.validator.quality_report(image, inference)
        retryable_quality_reasons = {
            FaceQualityReason.NO_FACE,
            FaceQualityReason.LOW_DETECTION_CONFIDENCE,
            FaceQualityReason.IMAGE_TOO_BLURRY,
            FaceQualityReason.UNDEREXPOSED,
            FaceQualityReason.OVEREXPOSED,
            FaceQualityReason.LOW_CONTRAST,
            FaceQualityReason.LOW_OVERALL_QUALITY,
        }
        should_retry = (
            inference.state
            in {
                FaceProviderState.NO_FACE,
                FaceProviderState.LOW_DETECTION_CONFIDENCE,
            }
            or bool(set(quality.reasons) & retryable_quality_reasons)
        )

        if should_retry:
            best_ready = (
                (selected_image, inference, quality)
                if inference.state == FaceProviderState.READY
                else None
            )
            for enhanced_bgr in _enhanced_detection_frames(image.image_bgr):
                enhanced_image = replace(image, image_bgr=enhanced_bgr)
                enhanced_inference = self.provider.analyze(enhanced_bgr)
                enhanced_quality = self.validator.quality_report(
                    enhanced_image,
                    enhanced_inference,
                )
                if enhanced_inference.state == FaceProviderState.MULTIPLE_FACES:
                    selected_image = enhanced_image
                    inference = enhanced_inference
                    quality = enhanced_quality
                    break
                if enhanced_inference.state != FaceProviderState.READY:
                    continue
                if (
                    best_ready is None
                    or enhanced_quality.quality_score > best_ready[2].quality_score
                ):
                    best_ready = (
                        enhanced_image,
                        enhanced_inference,
                        enhanced_quality,
                    )
                if enhanced_quality.accepted:
                    break
            else:
                if best_ready is not None:
                    selected_image, inference, quality = best_ready

            if (
                inference.state != FaceProviderState.MULTIPLE_FACES
                and best_ready is not None
            ):
                selected_image, inference, quality = best_ready

        if inference.state in {
            FaceProviderState.MODEL_NOT_FOUND,
            FaceProviderState.MODEL_LOAD_FAILED,
            FaceProviderState.EXECUTION_PROVIDER_UNAVAILABLE,
            FaceProviderState.INTERNAL_ERROR,
        }:
            failure = inference.failure
            raise FaceServiceUnavailableError(
                code=inference.state.value,
                message=failure.message if failure else "Inferencia facial indisponivel",
                provider_state=inference.state.value,
                **(failure.details if failure else {}),
            )
        return ProcessedFace(
            image=selected_image,
            inference=inference,
            quality=quality,
            total_ms=round((perf_counter() - started_at) * 1000, 3),
        )
