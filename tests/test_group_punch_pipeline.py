"""Group punches: inference pipelining and ONNX session options."""
import asyncio
import threading
import time
from types import SimpleNamespace

import pytest

from app.schemas.attendance import PunchCreate
from app.services.ai import insightface_provider
from app.services.attendance import AttendanceService, submitted_face_images


def _punch(image: str | None) -> PunchCreate:
    face = {"image_base64": image} if image else {"image_base64": None}
    return PunchCreate(employee_id=None, worksite_id="worksite-1", face=face)


class _RecordingEmbeddings:
    def __init__(self) -> None:
        self.order: list[str] = []
        self.active = 0
        self.max_active = 0
        self._lock = threading.Lock()

    def from_image_base64(self, image: str):
        with self._lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        time.sleep(0.02)
        with self._lock:
            self.order.append(image)
            self.active -= 1
        return f"processed:{image}"


@pytest.mark.asyncio
async def test_group_inference_runs_in_order_one_face_at_a_time() -> None:
    embeddings = _RecordingEmbeddings()
    service = AttendanceService(SimpleNamespace(), embeddings)
    punches = [_punch("face-a"), _punch(None), _punch("face-b"), _punch("face-c")]

    tasks = service.start_face_inference(punches)

    assert tasks[1] is None
    results = [await task if task is not None else None for task in tasks]
    assert results == [["processed:face-a"], None, ["processed:face-b"], ["processed:face-c"]]
    assert embeddings.order == ["face-a", "face-b", "face-c"]
    assert embeddings.max_active == 1


@pytest.mark.asyncio
async def test_discarded_group_inference_does_not_run_the_remaining_faces() -> None:
    embeddings = _RecordingEmbeddings()
    service = AttendanceService(SimpleNamespace(), embeddings)
    tasks = service.start_face_inference([_punch("face-a"), _punch("face-b"), _punch("face-c")])
    await tasks[0]

    service.discard_face_inference(tasks)
    await asyncio.sleep(0.1)

    assert "face-c" not in embeddings.order


def test_submitted_face_images_keeps_order_and_drops_repeats() -> None:
    payload = PunchCreate(
        employee_id=None,
        worksite_id="worksite-1",
        face={"image_base64": "b", "images_base64": ["a", "b", "a"]},
    )
    assert submitted_face_images(payload) == ["a", "b"]


class _FakeSessionOptions:
    def __init__(self) -> None:
        self.config: dict[str, str] = {}

    def add_session_config_entry(self, key: str, value: str) -> None:
        self.config[key] = value


def _fake_onnxruntime(monkeypatch, session_factory):
    """The CI test env has no onnxruntime (it is in the ``ai`` extra)."""
    import sys

    module = SimpleNamespace(SessionOptions=_FakeSessionOptions, InferenceSession=session_factory)
    monkeypatch.setitem(sys.modules, "onnxruntime", module)


def test_cpu_sessions_are_recreated_without_thread_spinning(monkeypatch) -> None:
    created = []

    class FakeSession:
        def __init__(self, model_file, sess_options=None, providers=None) -> None:
            created.append((model_file, sess_options, providers))

    _fake_onnxruntime(monkeypatch, FakeSession)
    detection = SimpleNamespace(session=object(), model_file="det.onnx")
    recognition = SimpleNamespace(session=object(), model_file="rec.onnx")

    insightface_provider._without_thread_spinning(
        [detection, recognition],
        ["CPUExecutionProvider"],
    )

    assert [entry[0] for entry in created] == ["det.onnx", "rec.onnx"]
    assert all(entry[2] == ["CPUExecutionProvider"] for entry in created)
    assert all(
        entry[1].config == {"session.intra_op.allow_spinning": "0"} for entry in created
    )
    assert isinstance(detection.session, FakeSession)
    assert isinstance(recognition.session, FakeSession)


def test_gpu_sessions_are_left_untouched(monkeypatch) -> None:
    _fake_onnxruntime(monkeypatch, lambda *args, **kwargs: pytest.fail("recreated"))
    original = object()
    model = SimpleNamespace(session=original, model_file="rec.onnx")

    insightface_provider._without_thread_spinning(
        [model],
        ["CUDAExecutionProvider", "CPUExecutionProvider"],
    )

    assert model.session is original


@pytest.mark.asyncio
async def test_batch_route_hands_each_punch_its_own_inference(monkeypatch) -> None:
    from unittest.mock import AsyncMock

    from fastapi import BackgroundTasks

    from app.api.v1.routes.attendance import punch_batch
    from app.models.enums import AttendanceStatus
    from app.schemas.attendance import AttendanceDecision, PunchBatchCreate

    received = []

    async def fake_register(self, payload, processed_frames=None):
        received.append((payload.face.image_base64, processed_frames))
        return AttendanceDecision(
            accepted=False, status=AttendanceStatus.REJECTED, employee_id=None,
            punch_type=None, confidence_score=0.0, similarity_score=None,
            liveness_score=None, quality_score=None, reasons=["low_similarity"],
        )

    monkeypatch.setattr(AttendanceService, "register_punch", fake_register)
    monkeypatch.setattr(
        AttendanceService, "_face_embeddings", lambda self: _RecordingEmbeddings(),
    )
    monkeypatch.setattr(
        AttendanceService,
        "process_face_images",
        lambda self, images: [f"processed:{image}" for image in images],
    )
    monkeypatch.setattr(
        "app.api.v1.routes.attendance.is_lightweight_serverless", lambda: False,
    )

    session = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())
    result = await punch_batch(
        PunchBatchCreate(punches=[_punch("face-a"), _punch("face-b")]),
        BackgroundTasks(),
        SimpleNamespace(id="user-1"),
        session,
    )

    assert result.processed == 2
    assert received == [
        ("face-a", ["processed:face-a"]),
        ("face-b", ["processed:face-b"]),
    ]
    session.commit.assert_awaited_once()
