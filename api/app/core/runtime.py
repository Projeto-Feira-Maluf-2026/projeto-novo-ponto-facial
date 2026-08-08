import os


def is_lightweight_serverless() -> bool:
    """Return whether this process is the dependency-minimized Vercel runtime."""
    return bool(os.getenv("VERCEL"))
