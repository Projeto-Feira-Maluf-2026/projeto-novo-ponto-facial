import base64
from io import BytesIO

import numpy as np
import pytest
from PIL import Image

from app.core.config import Settings
from app.core.errors import FaceInputError
from app.services.ai.base import FaceInferenceResult, FaceProviderState
from app.services.ai.fake_provider import FakeFaceProvider
from app.services.ai.facial_service import (
    FaceEmbeddingService,
    _enhanced_detection_frames,
)
from app.services.ai.image_validation import FaceImageValidator, FaceQualityReason


def make_test_settings(**overrides) -> Settings:
    values = {
        "_env_file": None,
        "DATABASE_URL": "postgresql://postgres:test@db.example.supabase.co:5432/postgres",
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test",
        "SUPABASE_SECRET_KEY": "sb_secret_test",
        "ENVIRONMENT": "test",
        "FACE_PROVIDER": "fake",
        "FACE_MIN_BLUR_VARIANCE": 1.0,
        "FACE_MIN_CONTRAST": 1.0,
        "FACE_MIN_QUALITY": 0.1,
    }
    values.update(overrides)
    return Settings(**values)


def image_data_uri(width: int = 640, height: int = 480, mime: str = "image/jpeg") -> str:
    rng = np.random.default_rng(42)
    pixels = rng.integers(35, 220, size=(height, width, 3), dtype=np.uint8)
    image = Image.fromarray(pixels, mode="RGB")
    output = BytesIO()
    image.save(output, format="JPEG", quality=92)
    encoded = base64.b64encode(output.getvalue()).decode()
    return f"data:{mime};base64,{encoded}"


def test_validated_image_has_real_mime_metrics_and_single_embedding() -> None:
    config = make_test_settings()
    validator = FaceImageValidator(config)
    service = FaceEmbeddingService(FakeFaceProvider(), validator, config)

    processed = service.from_image_base64(image_data_uri())

    assert processed.image.mime_type == "image/jpeg"
    assert processed.image.width == 640
    assert processed.inference.embedding_dimension == 512
    assert processed.inference.embedding is not None
    assert processed.quality.accepted is True
    assert processed.quality.metrics.occlusion_score is None
    assert processed.quality.metrics.eyes_closed is None


def test_rejects_declared_mime_that_does_not_match_content() -> None:
    validator = FaceImageValidator(make_test_settings())

    with pytest.raises(FaceInputError) as error:
        validator.from_base64(image_data_uri(mime="image/png"))

    assert error.value.code == FaceQualityReason.MIME_MISMATCH


def test_rejects_small_image_before_face_inference() -> None:
    validator = FaceImageValidator(make_test_settings())

    with pytest.raises(FaceInputError) as error:
        validator.from_base64(image_data_uri(width=120, height=120))

    assert error.value.code == FaceQualityReason.IMAGE_TOO_SMALL


def test_rejects_payload_over_configured_limit() -> None:
    validator = FaceImageValidator(make_test_settings(FACE_MAX_IMAGE_BYTES=128))

    with pytest.raises(FaceInputError) as error:
        validator.from_base64(image_data_uri())

    assert error.value.code == FaceQualityReason.PAYLOAD_TOO_LARGE


def test_enhancement_builds_brighter_full_resolution_detection_frames() -> None:
    image = np.full((480, 640, 3), 28, dtype=np.uint8)
    image[120:360, 220:420] = 42

    variants = _enhanced_detection_frames(image)

    assert len(variants) == 2
    assert all(variant.shape == image.shape for variant in variants)
    assert all(variant.dtype == np.uint8 for variant in variants)
    assert float(np.mean(variants[-1])) > float(np.mean(image))


def test_face_service_retries_detection_with_an_enhanced_frame() -> None:
    class RecoveringProvider(FakeFaceProvider):
        def __init__(self) -> None:
            super().__init__()
            self.calls = 0

        def analyze(self, image_bgr: np.ndarray) -> FaceInferenceResult:
            self.calls += 1
            if self.calls == 1:
                return FaceInferenceResult(
                    state=FaceProviderState.NO_FACE,
                    face_count=0,
                    model_name="fake-test-model",
                    model_version="fake-v1",
                    detector_name="fake-detector",
                    normalization_version="fake-norm-v1",
                    execution_provider="FakeExecutionProvider",
                    embedding_dimension=512,
                    inference_ms=0.1,
                )
            return super().analyze(image_bgr)

    config = make_test_settings()
    provider = RecoveringProvider()
    service = FaceEmbeddingService(provider, FaceImageValidator(config), config)

    processed = service.from_image_base64(image_data_uri())

    assert provider.calls == 2
    assert processed.inference.state == FaceProviderState.READY
    assert processed.inference.embedding is not None
