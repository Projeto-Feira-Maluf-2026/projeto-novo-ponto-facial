from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

import numpy as np


class FaceProviderState(StrEnum):
    READY = "READY"
    MODEL_NOT_FOUND = "MODEL_NOT_FOUND"
    MODEL_LOAD_FAILED = "MODEL_LOAD_FAILED"
    EXECUTION_PROVIDER_UNAVAILABLE = "EXECUTION_PROVIDER_UNAVAILABLE"
    INVALID_IMAGE = "INVALID_IMAGE"
    NO_FACE = "NO_FACE"
    MULTIPLE_FACES = "MULTIPLE_FACES"
    LOW_DETECTION_CONFIDENCE = "LOW_DETECTION_CONFIDENCE"
    INTERNAL_ERROR = "INTERNAL_ERROR"


@dataclass(frozen=True)
class FaceFailure:
    code: FaceProviderState
    message: str
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class FaceBoundingBox:
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class FaceLandmark:
    x: float
    y: float


@dataclass(frozen=True)
class FacePose:
    yaw: float
    pitch: float
    roll: float
    method: str


@dataclass(frozen=True)
class FaceModelInfo:
    provider_name: str
    state: FaceProviderState
    model_name: str | None
    model_version: str | None
    detector_name: str | None
    normalization_version: str | None
    execution_provider: str | None
    embedding_dimension: int | None
    warmup_ms: float | None
    is_real_model: bool
    failure: FaceFailure | None = None


@dataclass(frozen=True)
class FaceInferenceResult:
    state: FaceProviderState
    face_count: int
    model_name: str | None
    model_version: str | None
    detector_name: str | None
    normalization_version: str | None
    execution_provider: str | None
    embedding_dimension: int | None
    inference_ms: float
    embedding: list[float] | None = None
    bounding_box: FaceBoundingBox | None = None
    landmarks: list[FaceLandmark] = field(default_factory=list)
    detection_score: float | None = None
    pose: FacePose | None = None
    failure: FaceFailure | None = None

    @property
    def ready(self) -> bool:
        return self.state == FaceProviderState.READY and self.embedding is not None


class FaceProvider(ABC):
    @abstractmethod
    def initialize(self) -> FaceModelInfo:
        raise NotImplementedError

    @abstractmethod
    def info(self) -> FaceModelInfo:
        raise NotImplementedError

    @abstractmethod
    def analyze(self, image_bgr: np.ndarray) -> FaceInferenceResult:
        """Detect exactly one face and create its aligned embedding in one provider operation."""
        raise NotImplementedError
