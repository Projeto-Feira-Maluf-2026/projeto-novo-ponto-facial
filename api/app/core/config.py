from functools import cached_property
import os
from pathlib import Path

from cryptography.fernet import Fernet
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    PROJECT_NAME: str = "Curitiba Empreiteira - Ponto Facial"
    APP_VERSION: str = "1.2.0-sprint2"
    BUILD_ID: str = "local"
    ENVIRONMENT: str = "development"
    API_V1_PREFIX: str = "/api/v1"
    FRONTEND_URL: str = "https://curitiba-gestao.vercel.app"
    DATABASE_URL: str
    SUPABASE_URL: str
    SUPABASE_PUBLISHABLE_KEY: str
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_REQUIRED: bool = False
    HEALTHCHECK_TIMEOUT_SECONDS: float = 1.5
    FACE_EAGER_INITIALIZE: bool = True

    PASSWORD_PEPPER: str = Field(min_length=32)
    FIELD_ENCRYPTION_KEY: str = Field(min_length=44, max_length=44)

    CORS_ORIGINS: str = "http://localhost:5174,http://localhost:5173,http://localhost:8080"
    CORS_ORIGIN_REGEX: str | None = None
    BLOB_READ_WRITE_TOKEN: str | None = None
    FACE_PROVIDER: str = "insightface"
    FACE_MODEL_NAME: str = "buffalo_l"
    FACE_MODEL_ROOT: str = "~/.insightface"
    FACE_MODEL_VERSION: str | None = None
    FACE_MODEL_SHA256: str | None = None
    FACE_EXECUTION_PROVIDERS: str = "CPUExecutionProvider"
    FACE_EXPECTED_EMBEDDING_DIMENSION: int = 512
    FACE_DETECTION_SIZE: int = 960
    FACE_DETECTION_SIZES: str = "320,640,1280"
    FACE_MIN_DETECTION_CONFIDENCE: float = 0.32
    FACE_SECONDARY_FACE_SCORE_GAP: float = 0.25
    FACE_SECONDARY_FACE_CONFIDENCE: float = 0.50
    FACE_MIN_SIMILARITY: float = 0.62
    FACE_STRONG_SIMILARITY: float = 0.78
    FACE_MATCH_MARGIN: float = 0.06
    FACE_ENROLLMENT_MIN_IMAGES: int = 1
    FACE_ENROLLMENT_MIN_FACE_AREA_RATIO: float = 0.012
    FACE_ENROLLMENT_MIN_QUALITY: float = 0.55
    FACE_ENROLLMENT_MIN_FRAMES_PER_POSE: int = 3
    FACE_ENROLLMENT_MAX_FRAMES_PER_POSE: int = 5
    FACE_ENROLLMENT_SESSION_TTL_SECONDS: int = 900
    FACE_ENROLLMENT_MIN_BURST_SPAN_MS: int = 220
    FACE_ENROLLMENT_MIN_SESSION_SPAN_SECONDS: float = 2.0
    FACE_ENROLLMENT_MIN_BURST_SIMILARITY: float = 0.70
    FACE_ENROLLMENT_MIN_PAIR_SIMILARITY: float = 0.45
    FACE_ENROLLMENT_MIN_MEDIAN_SIMILARITY: float = 0.58
    FACE_ENROLLMENT_MAX_SIMILARITY_STDDEV: float = 0.16
    FACE_ENROLLMENT_MIN_PERCEPTUAL_DISTANCE: int = 5
    FACE_ENROLLMENT_FRONTAL_MAX_YAW: float = 12.0
    FACE_ENROLLMENT_FRONTAL_MAX_PITCH: float = 14.0
    FACE_ENROLLMENT_TURN_MIN_YAW: float = 12.0
    FACE_ENROLLMENT_TURN_MAX_YAW: float = 42.0
    FACE_ENROLLMENT_LOOK_UP_MIN_PITCH: float = 8.0
    FACE_ENROLLMENT_LOOK_UP_MAX_PITCH: float = 32.0
    FACE_TEMPORAL_MIN_FRAMES: int = 3
    FACE_TEMPORAL_MIN_EMBEDDING_SIMILARITY: float = 0.58
    FACE_MATCH_MIN_TEMPLATE_QUALITY: float = 0.45
    FACE_IDENTITY_MAX_TEMPLATES: int = 5
    FACE_IDENTITY_TOP_K: int = 3
    FACE_MIN_LIVENESS: float = 0.70
    FACE_MIN_QUALITY: float = 0.50
    FACE_MAX_FACES: int = 1
    FACE_MAX_IMAGE_BYTES: int = 8 * 1024 * 1024
    FACE_MAX_IMAGE_PIXELS: int = 16_000_000
    FACE_MIN_IMAGE_WIDTH: int = 320
    FACE_MIN_IMAGE_HEIGHT: int = 320
    FACE_MIN_FACE_AREA_RATIO: float = 0.015
    FACE_MAX_CENTER_OFFSET: float = 0.38
    FACE_MIN_BLUR_VARIANCE: float = 34.0
    FACE_MIN_LUMINANCE: float = 32.0
    FACE_MAX_LUMINANCE: float = 225.0
    FACE_MIN_CONTRAST: float = 17.0
    FACE_MAX_YAW_DEGREES: float = 28.0
    FACE_MAX_PITCH_DEGREES: float = 24.0
    FACE_MAX_ROLL_DEGREES: float = 20.0
    FACE_THRESHOLD_PROFILE: str = "development-uncalibrated"
    FACE_THRESHOLDS_CALIBRATED: bool = False

    SUSPICIOUS_SCORE_THRESHOLD: float = 0.55

    @cached_property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @cached_property
    def face_execution_providers(self) -> list[str]:
        return [
            provider.strip()
            for provider in self.FACE_EXECUTION_PROVIDERS.split(",")
            if provider.strip()
        ]

    @cached_property
    def face_detection_sizes(self) -> list[tuple[int, int]]:
        sizes = [
            int(value.strip())
            for value in self.FACE_DETECTION_SIZES.split(",")
            if value.strip()
        ]
        return [(size, size) for size in sizes]

    @cached_property
    def face_model_root(self) -> Path:
        if os.getenv("VERCEL") and self.FACE_MODEL_ROOT == "~/.insightface":
            return Path("/tmp/.insightface")
        return Path(self.FACE_MODEL_ROOT).expanduser().resolve()

    @model_validator(mode="after")
    def validate_environment_safety(self) -> "Settings":
        environment = self.ENVIRONMENT.strip().lower()
        provider = self.FACE_PROVIDER.strip().lower()
        allowed_environments = {"development", "test", "staging", "production"}
        if environment not in allowed_environments:
            raise ValueError(f"ENVIRONMENT deve ser um de {sorted(allowed_environments)}")
        self.ENVIRONMENT = environment
        self.FACE_PROVIDER = provider

        if not self.DATABASE_URL.startswith(("postgres://", "postgresql://", "postgresql+asyncpg://")):
            raise ValueError("DATABASE_URL deve apontar para o PostgreSQL do Supabase")
        if not self.SUPABASE_URL.startswith("https://") or ".supabase.co" not in self.SUPABASE_URL:
            raise ValueError("SUPABASE_URL invalida")
        if not self.SUPABASE_PUBLISHABLE_KEY.startswith("sb_publishable_"):
            raise ValueError("SUPABASE_PUBLISHABLE_KEY invalida")
        try:
            Fernet(self.FIELD_ENCRYPTION_KEY.encode("ascii"))
        except (UnicodeError, ValueError, TypeError) as exc:
            raise ValueError("FIELD_ENCRYPTION_KEY deve ser uma chave Fernet valida") from exc
        if provider == "fake" and environment != "test":
            raise ValueError("FACE_PROVIDER=fake so pode ser usado com ENVIRONMENT=test")
        if environment in {"staging", "production"} and provider != "insightface":
            raise ValueError("Staging e production exigem FACE_PROVIDER=insightface")
        if not self.face_execution_providers:
            raise ValueError("FACE_EXECUTION_PROVIDERS deve conter ao menos um provider")
        detection_sizes = self.face_detection_sizes
        if (
            not detection_sizes
            or len(detection_sizes) > 4
            or any(width < 128 or width > 1600 for width, _ in detection_sizes)
        ):
            raise ValueError(
                "FACE_DETECTION_SIZES deve conter de 1 a 4 valores entre 128 e 1600"
            )
        if not (
            0.0 < self.FACE_MIN_DETECTION_CONFIDENCE <= 1.0
            and self.FACE_MIN_DETECTION_CONFIDENCE
            <= self.FACE_SECONDARY_FACE_CONFIDENCE
            <= 1.0
            and 0.0 <= self.FACE_SECONDARY_FACE_SCORE_GAP <= 1.0
        ):
            raise ValueError("Thresholds de deteccao facial invalidos")
        if not (
            2 <= self.FACE_TEMPORAL_MIN_FRAMES <= 5
            and 0.0 < self.FACE_TEMPORAL_MIN_EMBEDDING_SIMILARITY <= 1.0
            and self.FACE_IDENTITY_MAX_TEMPLATES >= self.FACE_ENROLLMENT_MIN_IMAGES
            and 1 <= self.FACE_IDENTITY_TOP_K <= self.FACE_IDENTITY_MAX_TEMPLATES
        ):
            raise ValueError("Configuracao temporal ou de templates faciais invalida")
        return self


settings = Settings()
