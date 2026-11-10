"""Mede o reconhecimento facial nesta maquina: CPU x GPU (DirectML).

Uso (na pasta do projeto):
    api/.venv/Scripts/python.exe scripts/benchmark_face_runtime.py

Recorta 5 rostos da foto de exemplo do InsightFace do mesmo jeito que o
terminal faz (quadrado de 384 px, JPEG 88) e passa cada um pelo pipeline real
da API. Imprime o tempo por rosto de cada opcao e, na ultima linha,
``MELHOR=<providers>``, que o scripts/feira-local.ps1 usa.
"""
from __future__ import annotations

import base64
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
os.chdir(ROOT / "api")


def _crops(provider) -> list[str]:
    import cv2
    import insightface

    image = cv2.imread(str(Path(insightface.__file__).parent / "data/images/t1.jpg"))
    boxes, _ = provider._app.det_model.detect(image, input_size=(640, 640), max_num=0)
    crops = []
    for box in boxes[:5]:
        x1, y1, x2, y2 = box[:4]
        side = int(max(x2 - x1, y2 - y1) * 2.0)
        cx, cy = int((x1 + x2) / 2), int((y1 + y2) / 2)
        padded = cv2.copyMakeBorder(
            image, side, side, side, side, cv2.BORDER_CONSTANT, value=(118, 118, 118),
        )
        top, left = cy - side // 2 + side, cx - side // 2 + side
        crop = cv2.resize(padded[top:top + side, left:left + side], (384, 384))
        ok, jpeg = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 88])
        if ok:
            crops.append(base64.b64encode(jpeg.tobytes()).decode())
    return crops


def _measure(providers: list[str], crops: list[str] | None):
    from app.services.ai.facial_service import FaceEmbeddingService
    from app.services.ai.insightface_provider import InsightFaceArcFaceProvider

    provider = InsightFaceArcFaceProvider(execution_providers=providers)
    info = provider.initialize()
    if info.state.value != "READY":
        return None, info.execution_provider, crops
    crops = crops or _crops(provider)
    service = FaceEmbeddingService(provider=provider)
    for crop in crops:  # aquecimento
        service.from_image_base64(crop)
    rounds = []
    for _ in range(5):
        started = time.perf_counter()
        for crop in crops:
            service.from_image_base64(crop)
        rounds.append((time.perf_counter() - started) * 1000 / len(crops))
    return sorted(rounds)[len(rounds) // 2], info.execution_provider, crops


def main() -> None:
    import onnxruntime as ort

    available = ort.get_available_providers()
    print(f"onnxruntime {ort.__version__}; providers disponiveis: {', '.join(available)}")
    options = [["CPUExecutionProvider"]]
    if "DmlExecutionProvider" in available:
        options.append(["DmlExecutionProvider", "CPUExecutionProvider"])

    crops = None
    results = []
    for providers in options:
        per_face, active, crops = _measure(providers, crops)
        label = ",".join(providers)
        if per_face is None:
            print(f"{label}: nao carregou")
            continue
        print(f"{label}: {per_face:.0f} ms por rosto (ativo: {active})")
        results.append((per_face, label))
    best = min(results)[1] if results else "CPUExecutionProvider"
    print(f"MELHOR={best}")


if __name__ == "__main__":
    main()
