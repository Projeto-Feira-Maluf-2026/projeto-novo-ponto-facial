from collections.abc import AsyncGenerator
import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings


def normalize_database_url(value: str) -> str:
    """Convert provider-style Postgres URLs to SQLAlchemy's asyncpg format."""
    if value.startswith("postgres://"):
        value = "postgresql://" + value[len("postgres://") :]
    if value.startswith("postgresql://"):
        value = "postgresql+asyncpg://" + value[len("postgresql://") :]
    if not value.startswith("postgresql+asyncpg://"):
        return value

    parts = urlsplit(value)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    ssl_mode = query.pop("sslmode", None)
    query.pop("channel_binding", None)
    if ssl_mode and "ssl" not in query:
        query["ssl"] = ssl_mode
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


database_url = normalize_database_url(settings.DATABASE_URL)
engine_options = {"pool_pre_ping": True, "pool_recycle": 300}
if not database_url.startswith("sqlite"):
    if os.getenv("VERCEL"):
        engine_options.update({"pool_size": 1, "max_overflow": 2})
    else:
        engine_options.update({"pool_size": 10, "max_overflow": 20})

engine = create_async_engine(database_url, **engine_options)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
