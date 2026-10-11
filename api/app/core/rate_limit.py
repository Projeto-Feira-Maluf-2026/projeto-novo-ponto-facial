"""Bounded fixed-window quotas; shared Redis is mandatory for deployed environments."""
import asyncio
from collections import OrderedDict
from functools import lru_cache
from hashlib import sha256
from time import monotonic, time

from fastapi import HTTPException
from redis.asyncio import Redis

from app.core.config import settings

WINDOW_SECONDS = 60
KEY_TTL_SECONDS = 120
ATOMIC_INCREMENT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
"""
_fallback: OrderedDict[str, tuple[float, int]] = OrderedDict()


@lru_cache(maxsize=4)
def redis_client(url: str, timeout: float):
    return Redis.from_url(url, socket_connect_timeout=timeout, socket_timeout=timeout)


def bucket_for_request(method: str, path: str) -> str | None:
    if method.upper() not in {"POST", "PATCH", "PUT", "DELETE"}:
        return None
    # Buckets never contain resource IDs, paths, query strings or client-supplied labels.
    route = path.removeprefix(settings.API_V1_PREFIX).strip("/").split("/")[0]
    return {"attendance": "attendance", "ai": "ai", "reports": "reports"}.get(route, "mutation")


def bucket_limit(bucket: str) -> int:
    if bucket == "attendance":
        return settings.RATE_LIMIT_ATTENDANCE_PER_MINUTE
    if bucket == "ai":
        return settings.RATE_LIMIT_AI_PER_MINUTE
    if bucket == "reports":
        return settings.RATE_LIMIT_REPORTS_PER_MINUTE
    if bucket == "heartbeat":
        return settings.RATE_LIMIT_HEARTBEAT_PER_MINUTE
    if bucket == "mutation":
        return settings.RATE_LIMIT_MUTATIONS_PER_MINUTE
    raise ValueError("Unknown internal rate-limit bucket")


def rate_limit_key(principal: str, bucket: str, timestamp: float) -> str:
    bucket_limit(bucket)  # Accept only the fixed internal vocabulary.
    digest = sha256(principal.encode("utf-8")).hexdigest()
    window = int(timestamp) // WINDOW_SECONDS
    return f"ponto:limit:v1:{settings.ENVIRONMENT}:{digest}:{bucket}:{window}"


def fallback_increment(key: str) -> int:
    now = monotonic()
    # Insertion-order TTL; active counters are never evicted to reset a user's quota.
    while _fallback:
        oldest, (expires, _) = next(iter(_fallback.items()))
        if expires > now:
            break
        _fallback.pop(oldest)
    existing = _fallback.get(key)
    if existing:
        expires, count = existing
    else:
        if len(_fallback) >= settings.RATE_LIMIT_FALLBACK_MAX_KEYS:
            raise HTTPException(503, "Limitador local temporariamente indisponivel")
        expires, count = now + KEY_TTL_SECONDS, 0
    count += 1
    _fallback[key] = (expires, count)
    return count


async def check_rate_limit(principal: str, bucket: str) -> None:
    timestamp = time()
    key = rate_limit_key(principal, bucket, timestamp)
    timeout = settings.RATE_LIMIT_REDIS_TIMEOUT_SECONDS
    try:
        count = await asyncio.wait_for(
            redis_client(settings.REDIS_URL, timeout).eval(ATOMIC_INCREMENT, 1, key, KEY_TTL_SECONDS),
            timeout=timeout,
        )
        if isinstance(count, bool) or not isinstance(count, int) or count < 1:
            raise ValueError("Malformed rate-limit storage response")
    except Exception:
        if settings.ENVIRONMENT in {"staging", "production"}:
            # No process-local fallback can coordinate quotas across API instances.
            raise HTTPException(503, "Protecao de limite temporariamente indisponivel") from None
        count = fallback_increment(key)
    if count > bucket_limit(bucket):
        retry_after = WINDOW_SECONDS - (int(timestamp) % WINDOW_SECONDS)
        raise HTTPException(429, "Limite de requisicoes atingido. Aguarde e tente novamente.",
                            headers={"Retry-After": str(retry_after)})
