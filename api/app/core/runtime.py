import os


def is_lightweight_serverless() -> bool:
    """Return whether native facial dependencies are unavailable in this process."""
    mode = os.getenv("FACE_RUNTIME_MODE", "auto").strip().lower()
    if mode == "lightweight":
        return True
    if mode == "full":
        return False
    return bool(os.getenv("VERCEL"))
