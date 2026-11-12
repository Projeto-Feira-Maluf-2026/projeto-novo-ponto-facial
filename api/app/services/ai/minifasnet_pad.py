"""Passive presentation attack detection with MiniFASNet (ONNX).

Two small models from Silent-Face-Anti-Spoofing (MiniVision, Apache-2.0),
exported to ONNX by github.com/yakhyo/face-anti-spoofing. Each one sees the face
with surrounding context (2.7x and 4x the face box, limited to what the crop
holds) at 80x80 and returns logits for (fake, live, fake). The decision uses the
average live probability of both, as the original project does.

A photo or video shown to the camera (phone, tablet, paper) loses skin texture,
gains screen pixels, moire, glare and a frame around the face; these models were
trained on exactly those cues. They run on the original (not brightened) pixels.
"""
from __future__ import annotations

import hashlib
import logging
import threading
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import cv2
import numpy as np

logger = logging.getLogger(__name__)

MODEL_VERSION = "minifasnet-v2+v1se-onnx"


@dataclass(frozen=True)
class PadModelSpec:
    file_name: str
    scale: float
    sha256: str
    url: str


MODEL_SPECS = (
    PadModelSpec(
        "MiniFASNetV2.onnx",
        2.7,
        "b32929adc2d9c34b9486f8c4c7bc97c1b69bc0ea9befefc380e4faae4e463907",
        "https://github.com/yakhyo/face-anti-spoofing/releases/download/weights/MiniFASNetV2.onnx",
    ),
    PadModelSpec(
        "MiniFASNetV1SE.onnx",
        4.0,
        "ebab7f90c7833fbccd46d3a555410e78d969db5438e169b6524be444862b3676",
        "https://github.com/yakhyo/face-anti-spoofing/releases/download/weights/MiniFASNetV1SE.onnx",
    ),
)


@dataclass(frozen=True)
class PadFrame:
    """Original pixels and the face box (x, y, width, height) found in them."""

    image_bgr: np.ndarray
    face_box: tuple[float, float, float, float]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_model_files(model_dir: Path, *, download: bool) -> list[Path] | None:
    """Return verified model paths, downloading missing ones when allowed."""
    paths = []
    for spec in MODEL_SPECS:
        path = model_dir / spec.file_name
        if not path.exists() and download:
            try:
                model_dir.mkdir(parents=True, exist_ok=True)
                temporary = path.with_suffix(".part")
                # Tempo limite curto: sem internet, o ponto segue sem antifraude
                # (fora de staging/producao) em vez de travar a leitura.
                with urllib.request.urlopen(spec.url, timeout=20) as response:  # noqa: S310
                    temporary.write_bytes(response.read())
                temporary.replace(path)
            except Exception:
                logger.warning("Nao foi possivel baixar %s", spec.file_name, exc_info=True)
                return None
        if not path.exists() or _sha256(path) != spec.sha256:
            return None
        paths.append(path)
    return paths


def crop_for_model(image_bgr: np.ndarray, face_box, scale: float, size: int) -> np.ndarray:
    """Face-centered crop with ``scale`` x the box, clamped to the image (as trained)."""
    height, width = image_bgr.shape[:2]
    x, y, box_width, box_height = (float(value) for value in face_box)
    box_width = max(box_width, 1.0)
    box_height = max(box_height, 1.0)
    scale = min((height - 1) / box_height, (width - 1) / box_width, scale)
    new_width, new_height = box_width * scale, box_height * scale
    center_x, center_y = x + box_width / 2, y + box_height / 2
    left = max(0, int(center_x - new_width / 2))
    top = max(0, int(center_y - new_height / 2))
    right = min(width - 1, int(center_x + new_width / 2))
    bottom = min(height - 1, int(center_y + new_height / 2))
    crop = image_bgr[top:bottom + 1, left:right + 1]
    return cv2.resize(crop, (size, size))


def live_probability(logits: np.ndarray) -> float:
    values = np.asarray(logits, dtype=np.float64).reshape(-1)
    values = np.exp(values - values.max())
    values /= values.sum()
    return float(values[1])


class MiniFasNetPadProvider:
    def __init__(self, model_paths: Sequence[Path], providers: list[str], min_live_score: float):
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.add_session_config_entry("session.intra_op.allow_spinning", "0")
        options.intra_op_num_threads = 1
        self.sessions = []
        for spec, path in zip(MODEL_SPECS, model_paths, strict=True):
            session = ort.InferenceSession(str(path), sess_options=options, providers=providers)
            model_input = session.get_inputs()[0]
            self.sessions.append((spec, session, model_input.name, int(model_input.shape[2])))
        self.min_live_score = float(min_live_score)

    def live_score(self, frame: PadFrame) -> float:
        scores = []
        for spec, session, input_name, size in self.sessions:
            crop = crop_for_model(frame.image_bgr, frame.face_box, spec.scale, size)
            tensor = crop.astype(np.float32).transpose(2, 0, 1)[None]
            scores.append(live_probability(session.run(None, {input_name: tensor})[0]))
        return float(np.mean(scores))

    def evaluate(self, frames):
        from app.services.ai.presentation_attack import PresentationAttackDecision

        pad_frames = [frame for frame in frames if isinstance(frame, PadFrame)]
        if not pad_frames:
            return PresentationAttackDecision(False, False, None, "pad_no_frames")
        # Varias fotos da mesma batida: vale a mais suspeita.
        score = min(self.live_score(frame) for frame in pad_frames)
        accepted = score >= self.min_live_score
        return PresentationAttackDecision(
            accepted=accepted,
            evaluated=True,
            score=round(score, 4),
            reason="pad_live" if accepted else "presentation_attack_suspected",
            model_version=MODEL_VERSION,
        )


_provider_lock = threading.Lock()
_provider: MiniFasNetPadProvider | None = None
_provider_failed = False


def get_minifasnet_provider() -> MiniFasNetPadProvider | None:
    """Load once; ``None`` when disabled or the model files are unavailable."""
    global _provider, _provider_failed
    from app.core.config import settings

    if not settings.FACE_PAD_ENABLED:
        return None
    if _provider is not None or _provider_failed:
        return _provider
    with _provider_lock:
        if _provider is not None or _provider_failed:
            return _provider
        try:
            paths = ensure_model_files(
                settings.face_pad_model_dir,
                download=settings.FACE_PAD_AUTO_DOWNLOAD and settings.ENVIRONMENT != "test",
            )
            if paths is None:
                logger.warning("Modelos de antifraude ausentes em %s", settings.face_pad_model_dir)
                _provider_failed = True
                return None
            providers = [
                provider for provider in settings.face_execution_providers
                if provider == "CPUExecutionProvider"
            ] or ["CPUExecutionProvider"]
            _provider = MiniFasNetPadProvider(paths, providers, settings.FACE_PAD_MIN_LIVE_SCORE)
        except Exception:
            logger.exception("Falha ao carregar a antifraude MiniFASNet")
            _provider_failed = True
        return _provider
