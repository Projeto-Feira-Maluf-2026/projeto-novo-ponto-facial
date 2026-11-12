from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import numpy as np
import pytest

from app.core.config import settings
from app.models.enums import AttendanceStatus, PunchType
from app.schemas.attendance import PunchCreate
from app.services.ai import minifasnet_pad
from app.services.ai.minifasnet_pad import (
    MiniFasNetPadProvider,
    PadFrame,
    crop_for_model,
    ensure_model_files,
    live_probability,
)
from app.services.ai.presentation_attack import PresentationAttackDecision
from app.services.attendance import AttendanceService, presentation_attack_frames


def test_crop_is_clamped_to_the_image_and_resized() -> None:
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    image[40:60, 40:60] = 255
    crop = crop_for_model(image, (40, 40, 20, 20), 2.7, 80)
    assert crop.shape == (80, 80, 3)
    # Rosto no centro do recorte, com contexto em volta.
    assert crop[40, 40].tolist() == [255, 255, 255]
    assert crop[2, 2].tolist() == [0, 0, 0]
    assert crop_for_model(image, (0, 0, 100, 100), 4.0, 80).shape == (80, 80, 3)


def test_crop_near_the_border_is_shifted_not_stretched() -> None:
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    image[:, :50] = 255
    # Rosto encostado na borda esquerda: a janela de 2,7x volta para dentro da
    # imagem inteira (54 px), em vez de ser cortada e esticada no redimensionamento.
    crop = crop_for_model(image, (0, 40, 20, 20), 2.7, 54)
    assert crop.shape == (54, 54, 3)
    assert crop[27, :48].min() == 255
    assert crop[27, 51:].max() == 0


def test_live_probability_is_the_second_class() -> None:
    assert live_probability(np.array([[0.0, 10.0, 0.0]])) > 0.99
    assert live_probability(np.array([[10.0, 0.0, 10.0]])) < 0.01


class _Session:
    def __init__(self, live_logit: float) -> None:
        self.live_logit = live_logit

    def run(self, _outputs, _inputs):
        return [np.array([[0.0, self.live_logit, 0.0]])]


def _provider(*live_logits: float) -> MiniFasNetPadProvider:
    provider = object.__new__(MiniFasNetPadProvider)
    provider.sessions = [
        (spec, _Session(logit), "input", 80)
        for spec, logit in zip(minifasnet_pad.MODEL_SPECS, live_logits, strict=True)
    ]
    provider.min_live_score = 0.30
    return provider


def _frame() -> PadFrame:
    return PadFrame(np.zeros((120, 120, 3), dtype=np.uint8), (40, 40, 40, 40))


def test_live_face_is_accepted_and_photo_is_rejected() -> None:
    live = _provider(6.0, 6.0).evaluate([_frame()])
    assert live.accepted and live.evaluated and live.model_version
    photo = _provider(-6.0, -6.0).evaluate([_frame()])
    assert photo.evaluated and not photo.accepted
    assert photo.reason == "presentation_attack_suspected"


def test_without_face_frames_pad_is_not_evaluated() -> None:
    assert not _provider(6.0, 6.0).evaluate([np.zeros((8, 8, 3))]).evaluated


def test_tampered_model_file_is_refused(tmp_path: Path) -> None:
    for spec in minifasnet_pad.MODEL_SPECS:
        (tmp_path / spec.file_name).write_bytes(b"not the model")
    assert ensure_model_files(tmp_path, download=False) is None


def test_frames_without_face_box_are_skipped() -> None:
    image = np.zeros((10, 10, 3), dtype=np.uint8)
    with_box = SimpleNamespace(
        image=SimpleNamespace(image_bgr=image),
        inference=SimpleNamespace(bounding_box=SimpleNamespace(x=1, y=2, width=3, height=4)),
    )
    without_box = SimpleNamespace(
        image=SimpleNamespace(image_bgr=image), inference=SimpleNamespace(bounding_box=None),
    )
    frames = presentation_attack_frames([with_box, without_box])
    assert [frame.face_box for frame in frames] == [(1, 2, 3, 4)]


@pytest.mark.asyncio
async def test_photo_on_screen_does_not_register_the_punch_in_block_mode(monkeypatch) -> None:
    monkeypatch.setattr(settings, "FACE_PAD_ENABLED", True)
    monkeypatch.setattr(settings, "FACE_PAD_ACTION", "block")
    rejected = PresentationAttackDecision(
        False, True, 0.02, "presentation_attack_suspected", "test-only",
    )
    monkeypatch.setattr(
        "app.services.ai.presentation_attack.evaluate_presentation_attack",
        MagicMock(return_value=rejected),
    )
    processed = SimpleNamespace(
        image=SimpleNamespace(image_bgr=np.zeros((10, 10, 3), dtype=np.uint8)),
        quality=SimpleNamespace(accepted=True, quality_score=0.9, reasons=[]),
        inference=SimpleNamespace(
            embedding=[1.0, 0.0],
            bounding_box=SimpleNamespace(x=2, y=2, width=5, height=5),
        ),
    )
    session = SimpleNamespace(
        get=AsyncMock(return_value=SimpleNamespace(id="worksite-1", active=True)),
        execute=AsyncMock(), scalar=AsyncMock(return_value=None), add=MagicMock(),
        commit=AsyncMock(), refresh=AsyncMock(),
    )
    service = AttendanceService(
        session, SimpleNamespace(from_image_base64=MagicMock(return_value=processed)),
    )
    service._flag_attempt = AsyncMock()
    service._match_employee = AsyncMock()

    decision = await service.register_punch(PunchCreate(
        employee_id=None, worksite_id="worksite-1", punch_type=PunchType.ENTRY,
        face={"image_base64": "data:image/jpeg;base64,foto-na-tela"},
    ))

    assert decision.accepted is False
    assert decision.status == AttendanceStatus.REJECTED
    assert decision.reasons == ["presentation_attack_suspected"]
    service._match_employee.assert_not_awaited()
    service._flag_attempt.assert_awaited_once()


@pytest.mark.asyncio
async def test_photo_suspicion_sends_the_punch_to_review_by_default(monkeypatch) -> None:
    from app.models.enums import EmployeeStatus

    monkeypatch.setattr(settings, "FACE_PAD_ENABLED", True)
    assert settings.FACE_PAD_ACTION == "review"
    suspected = PresentationAttackDecision(
        False, True, 0.12, "presentation_attack_suspected", "test-only",
    )
    monkeypatch.setattr(
        "app.services.ai.presentation_attack.evaluate_presentation_attack",
        MagicMock(return_value=suspected),
    )
    processed = SimpleNamespace(
        image=SimpleNamespace(image_bgr=np.zeros((10, 10, 3), dtype=np.uint8)),
        quality=SimpleNamespace(accepted=True, quality_score=0.9, reasons=[]),
        inference=SimpleNamespace(
            embedding=[1.0, 0.0],
            bounding_box=SimpleNamespace(x=2, y=2, width=5, height=5),
        ),
    )
    employee = SimpleNamespace(id="e", name="Employee", registration="r", photo_url=None,
                               email=None, status=EmployeeStatus.ACTIVE)
    session = SimpleNamespace(
        get=AsyncMock(return_value=SimpleNamespace(id="worksite-1", active=True, name="Obra")),
        execute=AsyncMock(), scalar=AsyncMock(return_value=None), add=MagicMock(),
        commit=AsyncMock(), refresh=AsyncMock(),
    )
    service = AttendanceService(
        session, SimpleNamespace(from_image_base64=MagicMock(return_value=processed)),
    )
    service._flag_attempt = AsyncMock()
    service._match_employee = AsyncMock(return_value=(employee, 0.9, None, 0.95, None))
    service._infer_next_punch = AsyncMock(return_value=PunchType.ENTRY)

    decision = await service.register_punch(PunchCreate(
        worksite_id="worksite-1", face={"image_base64": "data:image/jpeg;base64,rosto"},
    ))

    # Ninguem e barrado: o ponto entra em conferencia, com a suspeita registrada.
    assert decision.status == AttendanceStatus.MANUAL_REVIEW
    assert decision.employee_id == "e"
    assert "presentation_attack_suspected" in decision.reasons
    record = session.add.call_args.args[0]
    assert record.status == AttendanceStatus.MANUAL_REVIEW
    assert record.metadata_json["pad_suspected"] is True
    service._flag_attempt.assert_awaited_once()
