import os
from collections.abc import AsyncGenerator
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings


def normalize_database_url(value: str) -> str:
    """Convert a Supabase Postgres URL to SQLAlchemy's asyncpg format."""
    if value.startswith("postgres://"):
        value = "postgresql://" + value[len("postgres://") :]
    if value.startswith("postgresql://"):
        value = "postgresql+asyncpg://" + value[len("postgresql://") :]
    if not value.startswith("postgresql+asyncpg://"):
        raise ValueError("DATABASE_URL deve usar PostgreSQL")

    parts = urlsplit(value)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    ssl_mode = query.pop("sslmode", None)
    query.pop("channel_binding", None)
    if ssl_mode and "ssl" not in query:
        query["ssl"] = ssl_mode
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def is_transaction_pooler_url(value: str) -> bool:
    """Detect Supabase/Supavisor transaction-pooler endpoints."""
    hostname = (urlsplit(value).hostname or "").lower()
    return hostname.endswith(".pooler.supabase.com") or hostname == "pooler.supabase.com"


def uses_persistent_pool() -> bool:
    """Keep warm connections in long-lived processes, including the face container.

    Serverless functions still open one connection per request. The face container
    (FACE_RUNTIME_MODE=full) is a long-running process that handles every terminal
    scan; opening a new TLS + auth handshake to Postgres for each scan was one of the
    largest fixed costs of a punch.
    """
    override = os.getenv("DATABASE_PERSISTENT_POOL", "").strip().lower()
    if override in {"1", "true", "yes"}:
        return True
    if override in {"0", "false", "no"}:
        return False
    if not os.getenv("VERCEL"):
        return True
    return os.getenv("FACE_RUNTIME_MODE", "auto").strip().lower() == "full"


database_url = normalize_database_url(settings.DATABASE_URL)
engine_options = {"pool_pre_ping": True, "pool_recycle": 240}

if is_transaction_pooler_url(database_url) or os.getenv("VERCEL"):
    # O pooler de transacoes do Supabase nao preserva prepared statements entre
    # transacoes; os nomes unicos tambem permitem reaproveitar conexoes.
    engine_options["connect_args"] = {
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
        "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4()}__",
    }

if not uses_persistent_pool():
    engine_options["poolclass"] = NullPool
elif os.getenv("VERCEL") or is_transaction_pooler_url(database_url):
    engine_options.update({"pool_size": 4, "max_overflow": 6})
else:
    engine_options.update({"pool_size": 10, "max_overflow": 20})

engine = create_async_engine(database_url, **engine_options)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
