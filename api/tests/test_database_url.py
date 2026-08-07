from app.db.session import normalize_database_url


def test_neon_url_is_normalized_for_asyncpg() -> None:
    value = normalize_database_url(
        "postgresql://user:pass@host/db?sslmode=require&channel_binding=require"
    )

    assert value == "postgresql+asyncpg://user:pass@host/db?ssl=require"


def test_sqlite_url_is_unchanged() -> None:
    value = "sqlite+aiosqlite:///./ponto_facial.db"

    assert normalize_database_url(value) == value
