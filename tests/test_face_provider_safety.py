import base64
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import numpy as np
import pytest
from PIL import Image
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import FaceServiceUnavailableError
from app.services.ai.base import (
    FaceBoundingBox,
    FaceFailure,
    FaceInferenceResult,
    FaceProviderState,
)
from app.services.ai.fake_provider import FakeFaceProvider
from app.services.ai.facial_service import FaceEmbeddingService
from app.services.ai.image_validation import FaceImageValidator, FaceQualityReason
from app.services.ai.image_validation import ImageMetrics, ValidatedFaceImage
from app.services.ai.insightface_provider import (
    InsightFaceArcFaceProvider,
    _reliable_face_candidates,
)


SUPABASE_SETTINGS = {
    "DATABASE_URL": "postgresql://postgres:test@db.example.supabase.co:5432/postgres",
    "SUPABASE_URL": "https://example.supabase.co",
    "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test",
    "PASSWORD_PEPPER": "test-only-password-pepper-value-1234567890",
    "FIELD_ENCRYPTION_KEY": "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
}


def test_fake_provider_is_blocked_outside_tests() -> None:
    with pytest.raises(ValidationError, match="FACE_PROVIDER=fake"):
        Settings(
            _env_file=None,
            **SUPABASE_SETTINGS,
            ENVIRONMENT="production",
            FACE_PROVIDER="fake",
        )


@pytest.mark.parametrize("origin", ["*", "https://example.com/path", "https://user:pass@example.com", "http://localhost:5173"])
def test_production_cors_rejects_wildcards_paths_credentials_and_http(origin):
    with pytest.raises(ValidationError, match="CORS"):
        Settings(_env_file=None, **SUPABASE_SETTINGS, ENVIRONMENT="production",
                 FACE_PROVIDER="insightface", CORS_ORIGINS=origin)


def test_production_cors_rejects_regex():
    with pytest.raises(ValidationError, match="CORS"):
        Settings(_env_file=None, **SUPABASE_SETTINGS, ENVIRONMENT="production",
                 FACE_PROVIDER="insightface", CORS_ORIGIN_REGEX=".*")


def test_configuration_errors_never_print_secret_inputs():
    values = {**SUPABASE_SETTINGS, "FIELD_ENCRYPTION_KEY": "invalid-private-key",
              "PASSWORD_PEPPER": "synthetic-private-pepper" * 3}
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, **values)
    output = str(error.value)
    assert "invalid-private-key" not in output
    assert values["PASSWORD_PEPPER"] not in output


def test_detection_sizes_are_parsed_as_ordered_square_scales() -> None:
    config = Settings(
        _env_file=None,
        **SUPABASE_SETTINGS,
        ENVIRONMENT="test",
        FACE_PROVIDER="fake",
        FACE_DETECTION_SIZES="320, 640,1280",
    )

    assert config.face_detection_sizes == [
        (320, 320),
        (640, 640),
        (1280, 1280),
    ]


def test_detection_sizes_reject_unsafe_values() -> None:
    with pytest.raises(ValidationError, match="FACE_DETECTION_SIZES"):
        Settings(
            _env_file=None,
            **SUPABASE_SETTINGS,
            ENVIRONMENT="test",
            FACE_PROVIDER="fake",
            FACE_DETECTION_SIZES="96,1920",
        )


def test_high_resolution_detection_is_reserved_for_small_or_missing_faces() -> None:
    image = np.zeros((720, 1280, 3), dtype=np.uint8)
    large_face = SimpleNamespace(bbox=np.asarray([300, 160, 620, 520]))
    distant_face = SimpleNamespace(bbox=np.asarray([580, 280, 680, 380]))

    assert InsightFaceArcFaceProvider._needs_high_resolution_pass([], image) is True
    assert InsightFaceArcFaceProvider._needs_high_resolution_pass([distant_face], image) is True
    assert InsightFaceArcFaceProvider._needs_high_resolution_pass([large_face], image) is False


def test_adaptive_detector_escalates_only_until_distant_face_is_resolved() -> None:
    image = np.zeros((720, 1280, 3), dtype=np.uint8)
    distant_face = SimpleNamespace(bbox=np.asarray([580, 280, 680, 380]))
    resolved_face = SimpleNamespace(bbox=np.asarray([420, 180, 760, 560]))
    provider = InsightFaceArcFaceProvider(detection_sizes=[(320, 320), (640, 640), (1280, 1280)])
    provider._faces_for_sizes = MagicMock(side_effect=[[], [distant_face], [resolved_face]])

    faces = provider._adaptive_faces(image)

    assert faces == [resolved_face]
    assert [item.args[1] for item in provider._faces_for_sizes.call_args_list] == [
        [(320, 320)],
        [(640, 640)],
        [(1280, 1280)],
    ]


def test_adaptive_detector_keeps_near_face_on_fastest_pass() -> None:
    image = np.zeros((720, 1280, 3), dtype=np.uint8)
    near_face = SimpleNamespace(bbox=np.asarray([360, 120, 800, 620]))
    provider = InsightFaceArcFaceProvider(detection_sizes=[(320, 320), (640, 640), (1280, 1280)])
    provider._faces_for_sizes = MagicMock(return_value=[near_face])

    faces = provider._adaptive_faces(image)

    assert faces == [near_face]
    provider._faces_for_sizes.assert_called_once_with(image, [(320, 320)])


def _provider_with_detected_faces(faces: list) -> tuple[InsightFaceArcFaceProvider, MagicMock]:
    provider = InsightFaceArcFaceProvider(
        detection_sizes=[(320, 320)],
        expected_embedding_dimension=4,
        minimum_detection_confidence=0.32,
    )
    provider.initialize = MagicMock(  # type: ignore[method-assign]
        return_value=SimpleNamespace(state=FaceProviderState.READY, failure=None)
    )

    def embed(_image, face) -> None:
        face.normed_embedding = np.asarray([1.0, 0.0, 0.0, 0.0], dtype=np.float32)

    recognition = MagicMock()
    recognition.get.side_effect = embed
    provider._app = SimpleNamespace(models={"detection": object(), "recognition": recognition})
    provider._embedding_dimension = 4
    provider._faces_for_sizes = MagicMock(return_value=faces)  # type: ignore[method-assign]
    return provider, recognition


def test_embedding_runs_only_for_the_selected_face() -> None:
    image = np.zeros((384, 384, 3), dtype=np.uint8)
    strong = SimpleNamespace(
        bbox=np.asarray([60, 60, 320, 330], dtype=np.float32),
        kps=np.asarray([[120, 150], [250, 150], [185, 210], [140, 270], [230, 270]]),
        det_score=0.92,
    )
    echo = SimpleNamespace(
        bbox=np.asarray([0, 0, 30, 30], dtype=np.float32),
        kps=None,
        det_score=0.35,
    )
    provider, recognition = _provider_with_detected_faces([strong, echo])

    result = provider.analyze(image)

    assert result.state == FaceProviderState.READY
    assert result.embedding is not None
    recognition.get.assert_called_once_with(image, strong)


def test_multiple_faces_are_rejected_without_computing_embeddings() -> None:
    image = np.zeros((384, 384, 3), dtype=np.uint8)
    faces = [
        SimpleNamespace(bbox=np.asarray([10, 10, 150, 160]), kps=None, det_score=0.9),
        SimpleNamespace(bbox=np.asarray([200, 10, 360, 160]), kps=None, det_score=0.88),
    ]
    provider, recognition = _provider_with_detected_faces(faces)

    result = provider.analyze(image)

    assert result.state == FaceProviderState.MULTIPLE_FACES
    recognition.get.assert_not_called()


def test_locate_detects_without_embedding() -> None:
    image = np.zeros((384, 384, 3), dtype=np.uint8)
    face = SimpleNamespace(
        bbox=np.asarray([60, 60, 320, 330], dtype=np.float32),
        kps=np.asarray([[120, 150], [250, 150], [185, 210], [140, 270], [230, 270]]),
        det_score=0.9,
    )
    provider, recognition = _provider_with_detected_faces([face])

    result = provider.locate(image)

    assert result.state == FaceProviderState.READY
    assert result.bounding_box is not None
    assert result.embedding is None
    recognition.get.assert_not_called()


def test_secondary_face_threshold_cannot_be_lower_than_detector_floor() -> None:
    with pytest.raises(ValidationError, match="Thresholds de deteccao facial"):
        Settings(
            _env_file=None,
            **SUPABASE_SETTINGS,
            ENVIRONMENT="test",
            FACE_PROVIDER="fake",
            FACE_MIN_DETECTION_CONFIDENCE=0.50,
            FACE_SECONDARY_FACE_CONFIDENCE=0.40,
        )


def test_weak_detector_echoes_do_not_count_as_extra_people() -> None:
    candidates = [
        SimpleNamespace(det_score=0.91),
        SimpleNamespace(det_score=0.47),
        SimpleNamespace(det_score=0.38),
    ]

    reliable, threshold = _reliable_face_candidates(candidates, 0.32, 0.25, 0.50)

    assert reliable == [candidates[0]]
    assert threshold == pytest.approx(0.50)


def test_second_credible_face_is_preserved_for_security_rejection() -> None:
    candidates = [
        SimpleNamespace(det_score=0.91),
        SimpleNamespace(det_score=0.84),
        SimpleNamespace(det_score=0.39),
    ]

    reliable, _ = _reliable_face_candidates(candidates, 0.32, 0.25, 0.50)

    assert reliable == candidates[:2]


def test_secondary_face_threshold_never_rises_above_security_cap() -> None:
    candidates = [
        SimpleNamespace(det_score=0.99),
        SimpleNamespace(det_score=0.55),
    ]

    reliable, threshold = _reliable_face_candidates(
        candidates,
        0.32,
        0.25,
        0.50,
    )

    assert threshold == pytest.approx(0.50)
    assert reliable == candidates


def test_missing_real_model_never_falls_back(tmp_path: Path) -> None:
    provider = InsightFaceArcFaceProvider(model_root=tmp_path)

    info = provider.initialize()
    result = provider.analyze(np.zeros((480, 640, 3), dtype=np.uint8))

    assert info.state == FaceProviderState.MODEL_NOT_FOUND
    assert info.is_real_model is True
    assert result.state == FaceProviderState.MODEL_NOT_FOUND
    assert result.embedding is None
    assert result.failure is not None


def test_fake_provider_is_explicitly_marked_as_not_real() -> None:
    provider = FakeFaceProvider()
    info = provider.initialize()

    assert info.state == FaceProviderState.READY
    assert info.is_real_model is False
    assert info.model_name == "fake-test-model"


def test_production_operations_are_blocked_without_calibrated_thresholds() -> None:
    config = Settings(
        _env_file=None,
        **SUPABASE_SETTINGS,
        ENVIRONMENT="production",
        FACE_PROVIDER="insightface",
        FACE_THRESHOLDS_CALIBRATED=False,
    )
    service = FaceEmbeddingService(
        FakeFaceProvider(),
        FaceImageValidator(config),
        config,
    )
    image = Image.new("RGB", (320, 320), color=(128, 128, 128))
    output = BytesIO()
    image.save(output, format="JPEG")
    encoded = base64.b64encode(output.getvalue()).decode()

    with pytest.raises(FaceServiceUnavailableError) as error:
        service.from_image_base64(f"data:image/jpeg;base64,{encoded}")

    assert error.value.code == "THRESHOLDS_NOT_CALIBRATED"


def test_mirrored_retry_reuses_validated_pixels_without_decoding_again() -> None:
    pixels = np.zeros((4, 5, 3), dtype=np.uint8)
    pixels[:, 0] = 10
    pixels[:, -1] = 240
    image = ValidatedFaceImage(
        image_bgr=pixels,
        original_bytes=b"validated",
        sha256="sha",
        mime_type="image/jpeg",
        width=5,
        height=4,
        image_metrics=ImageMetrics(100.0, 120.0, 30.0, 0.0, 0.0),
    )
    inference = SimpleNamespace(state=FaceProviderState.READY)
    quality = SimpleNamespace(reasons=[], accepted=True, quality_score=0.9)
    provider = SimpleNamespace(
        info=MagicMock(return_value=SimpleNamespace(state=FaceProviderState.READY)),
        analyze=MagicMock(return_value=inference),
    )
    validator = SimpleNamespace(
        from_base64=MagicMock(side_effect=AssertionError("não deve decodificar")),
        quality_report=MagicMock(return_value=quality),
    )
    config = SimpleNamespace(ENVIRONMENT="test", FACE_THRESHOLDS_CALIBRATED=True)
    service = FaceEmbeddingService(provider, validator, config)

    processed = service.from_mirrored_image(image)

    analyzed = provider.analyze.call_args.args[0]
    assert np.array_equal(analyzed[:, 0], pixels[:, -1])
    assert np.array_equal(analyzed[:, -1], pixels[:, 0])
    assert processed.image.sha256 == image.sha256
    validator.from_base64.assert_not_called()


@pytest.mark.parametrize("failure_stage", ["original", "enhanced", "canonical"])
@pytest.mark.parametrize(
    "failure_state", [FaceProviderState.INTERNAL_ERROR, FaceProviderState.MULTIPLE_FACES]
)
def test_enhancement_cannot_mask_provider_failure(
    failure_stage: str, failure_state: FaceProviderState
) -> None:
    image = ValidatedFaceImage(
        image_bgr=np.zeros((100, 100, 3), dtype=np.uint8),
        original_bytes=b"validated",
        sha256="sha",
        mime_type="image/jpeg",
        width=100,
        height=100,
        image_metrics=ImageMetrics(100.0, 120.0, 30.0, 0.0, 0.0),
    )
    metadata = dict(
        model_name=None,
        model_version=None,
        detector_name=None,
        normalization_version=None,
        execution_provider=None,
        embedding_dimension=2,
        inference_ms=1.0,
    )
    ready = FaceInferenceResult(
        **metadata,
        state=FaceProviderState.READY,
        face_count=1,
        embedding=[1.0, 0.0],
        bounding_box=FaceBoundingBox(x=20, y=20, width=60, height=60),
    )
    failure = FaceInferenceResult(
        **metadata,
        state=failure_state,
        face_count=2 if failure_state == FaceProviderState.MULTIPLE_FACES else 0,
        failure=FaceFailure(failure_state, "Unavailable"),
    )
    responses = {
        "original": [failure],
        "enhanced": [ready, failure],
        "canonical": [ready, ready, failure],
    }
    provider = SimpleNamespace(
        info=MagicMock(return_value=SimpleNamespace(state=FaceProviderState.READY)),
        analyze=MagicMock(side_effect=responses[failure_stage]),
    )
    quality = SimpleNamespace(
        reasons=[FaceQualityReason.LOW_OVERALL_QUALITY],
        accepted=False,
        quality_score=0.5,
    )
    validator = SimpleNamespace(quality_report=MagicMock(return_value=quality))
    config = SimpleNamespace(ENVIRONMENT="test", FACE_THRESHOLDS_CALIBRATED=True)
    service = FaceEmbeddingService(provider, validator, config)

    if failure_state == FaceProviderState.INTERNAL_ERROR:
        with pytest.raises(FaceServiceUnavailableError) as error:
            service.from_mirrored_image(image)
        assert error.value.code == "INTERNAL_ERROR"
    else:
        result = service.from_mirrored_image(image)
        assert result.inference.state == FaceProviderState.MULTIPLE_FACES
        assert result.inference.embedding is None
    assert provider.analyze.call_count == len(responses[failure_stage])
