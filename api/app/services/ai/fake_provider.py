import hashlib
from time import perf_counter

import numpy as np

from app.services.ai.base import (
    FaceBoundingBox,
    FaceInferenceResult,
    FaceLandmark,
    FaceModelInfo,
    FacePose,
    FaceProvider,
    FaceProviderState,
)


class FakeFaceProvider(FaceProvider):
    """Deterministic test double. The provider factory only permits it in ENVIRONMENT=test."""

    def __init__(self, embedding_dimension: int = 512) -> None:
        self.embedding_dimension = embedding_dimension
        self._initialized = False

    def initialize(self) -> FaceModelInfo:
        self._initialized = True
        return self.info()

    def info(self) -> FaceModelInfo:
        return FaceModelInfo(
            provider_name="fake",
            state=FaceProviderState.READY,
            model_name="fake-test-model",
            model_version="fake-v1",
            detector_name="fake-detector",
            normalization_version="fake-norm-v1",
            execution_provider="FakeExecutionProvider",
            embedding_dimension=self.embedding_dimension,
            warmup_ms=0.0,
            is_real_model=False,
        )

    def analyze(self, image_bgr: np.ndarray) -> FaceInferenceResult:
        self.initialize()
        started_at = perf_counter()
        height, width = image_bgr.shape[:2]
        digest = hashlib.sha512(image_bgr.tobytes()).digest()
        values = np.frombuffer(digest, dtype=np.uint8).astype(np.float32)
        vector = np.resize(values, self.embedding_dimension) - 127.5
        vector /= max(float(np.linalg.norm(vector)), 1e-9)
        box = FaceBoundingBox(
            x=width * 0.25,
            y=height * 0.18,
            width=width * 0.50,
            height=height * 0.64,
        )
        landmarks = [
            FaceLandmark(width * 0.39, height * 0.40),
            FaceLandmark(width * 0.61, height * 0.40),
            FaceLandmark(width * 0.50, height * 0.52),
            FaceLandmark(width * 0.42, height * 0.66),
            FaceLandmark(width * 0.58, height * 0.66),
        ]
        return FaceInferenceResult(
            state=FaceProviderState.READY,
            face_count=1,
            model_name="fake-test-model",
            model_version="fake-v1",
            detector_name="fake-detector",
            normalization_version="fake-norm-v1",
            execution_provider="FakeExecutionProvider",
            embedding_dimension=self.embedding_dimension,
            inference_ms=round((perf_counter() - started_at) * 1000, 3),
            embedding=vector.tolist(),
            bounding_box=box,
            landmarks=landmarks,
            detection_score=0.99,
            pose=FacePose(yaw=0.0, pitch=0.0, roll=0.0, method="fake-test"),
        )
