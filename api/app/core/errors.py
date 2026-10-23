from dataclasses import dataclass, field
from typing import Any


@dataclass(eq=False)
class AppError(Exception):
    code: str
    message: str
    status_code: int = 400
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        super().__init__(self.message)


class FaceServiceUnavailableError(AppError):
    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(code=code, message=message, status_code=503, details=details)


class FaceInputError(AppError):
    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(code=code, message=message, status_code=422, details=details)
