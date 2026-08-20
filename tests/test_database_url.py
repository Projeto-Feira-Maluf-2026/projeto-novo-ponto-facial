import pytest

from app.db.session import is_transaction_pooler_url, normalize_database_url


def test_supabase_url_is_normalized_for_asyncpg() -> None:
    value = normalize_database_url(
        "postgresql://user:pass@host/db?sslmode=require&channel_binding=require"
    )

    assert value == "postgresql+asyncpg://user:pass@host/db?ssl=require"


def test_non_postgres_url_is_rejected() -> None:
    with pytest.raises(ValueError, match="PostgreSQL"):
        normalize_database_url("mysql://user:pass@host/db")


def test_supabase_pooler_is_detected() -> None:
    assert is_transaction_pooler_url(
        "postgresql+asyncpg://user:pass@aws-0-sa-east-1.pooler.supabase.com:6543/postgres"
    )
    assert not is_transaction_pooler_url(
        "postgresql+asyncpg://user:pass@db.example.com:5432/postgres"
    )
