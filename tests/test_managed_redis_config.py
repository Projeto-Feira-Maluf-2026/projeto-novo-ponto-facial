"""Managed Redis credentials stay provider-owned, not copied into source or logs."""

from pydantic import ValidationError
import pytest

from app.core.config import Settings, settings


MANAGED_URL = "rediss://default:synthetic-test-only@redis.example.invalid:6379"
LEGACY_URL = "redis://localhost:6379/0"


def configured(managed):
    return Settings.model_validate({
        **settings.model_dump(),
        "REDIS_URL": LEGACY_URL,
        "PONTO_LIMIT_REDIS_URL": managed,
    })


def test_managed_connection_wins_over_legacy_localhost():
    assert configured(MANAGED_URL).REDIS_URL == MANAGED_URL


@pytest.mark.parametrize("managed", [None, "", "   "])
def test_missing_managed_connection_preserves_local_and_existing_configuration(managed):
    assert configured(managed).REDIS_URL == LEGACY_URL


def test_managed_connection_trims_accidental_surrounding_whitespace():
    assert configured(f" {MANAGED_URL} ").REDIS_URL == MANAGED_URL


@pytest.mark.parametrize("url", ["redis://redis.example.invalid:6379", "https://example.invalid", "rediss://"])
def test_managed_connection_requires_a_tls_redis_endpoint_without_echoing_secrets(url):
    with pytest.raises(ValidationError, match="PONTO_LIMIT_REDIS_URL") as error:
        configured(url)
    assert "synthetic-test-only" not in str(error.value)


def test_provider_environment_variable_is_used_directly(monkeypatch):
    monkeypatch.setenv("PONTO_LIMIT_REDIS_URL", MANAGED_URL)
    values = settings.model_dump(exclude={"PONTO_LIMIT_REDIS_URL"})
    values["REDIS_URL"] = LEGACY_URL
    config = Settings(_env_file=None, **values)
    assert config.REDIS_URL == MANAGED_URL
