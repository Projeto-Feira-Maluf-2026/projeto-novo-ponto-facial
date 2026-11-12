"""Hermetic test configuration.

Loaded by pytest before any test module imports ``app``. The API settings are a
module-level singleton that would otherwise read the developer's real ``.env``
(DATABASE_URL, SMTP and Blob credentials). Tests must only ever see synthetic
values, matching the CI job, regardless of which machine runs them.
"""
import os

os.environ["PONTO_SKIP_DOTENV"] = "1"

_SYNTHETIC_ENVIRONMENT = {
    "DATABASE_URL": "postgresql://postgres:test@db.example.supabase.co:5432/postgres",
    "SUPABASE_URL": "https://example.supabase.co",
    "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test",
    "PASSWORD_PEPPER": "ci-only-password-pepper-value-1234567890",
    "FIELD_ENCRYPTION_KEY": "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
    "PONTO_LIMIT_REDIS_URL": "",
    "REDIS_URL": "redis://127.0.0.1:1/0",
}
# Overwrite, not setdefault: a real DATABASE_URL exported in the shell must not win.
os.environ.update(_SYNTHETIC_ENVIRONMENT)

# A antifraude real carrega modelos do disco: os testes que precisam dela a
# ligam explicitamente, para nenhum teste depender do que existe na maquina.
os.environ["FACE_PAD_ENABLED"] = "false"

# Never send real notifications from a test run, even if the shell exports it.
os.environ["EMAIL_NOTIFICATIONS_ENABLED"] = "false"
