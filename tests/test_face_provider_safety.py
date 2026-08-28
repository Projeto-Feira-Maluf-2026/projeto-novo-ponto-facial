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
from app.services.ai.base import FaceProviderState
from app.services.ai.fake_provider import FakeFaceProvider
from app.services.ai.facial_service import FaceEmbeddingService
from app.services.ai.image_validation import FaceImageValidator
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
    provider = InsightFaceArcFaceProvider(
        detection_sizes=[(320, 320), (640, 640), (1280, 1280)]
    )
    provider._faces_for_sizes = MagicMock(
        side_effect=[[], [distant_face], [resolved_face]]
    )

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
    provider = InsightFaceArcFaceProvider(
        detection_sizes=[(320, 320), (640, 640), (1280, 1280)]
    )
    provider._faces_for_sizes = MagicMock(return_value=[near_face])

    faces = provider._adaptive_faces(image)

    assert faces == [near_face]
    provider._faces_for_sizes.assert_called_once_with(image, [(320, 320)])


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
