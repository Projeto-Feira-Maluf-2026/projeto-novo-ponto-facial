"""Vercel ASGI entrypoint."""

import os
import sys
from pathlib import Path

api_root = Path(__file__).resolve().parent
if str(api_root) not in sys.path:
    sys.path.insert(0, str(api_root))

# This entrypoint intentionally uses the dependency-minimized serverless runtime.
# Containers import app.application directly and therefore keep the full AI runtime.
os.environ.setdefault("FACE_RUNTIME_MODE", "lightweight")

from app.application import create_application  # noqa: E402

app = create_application()

__all__ = ["app"]
