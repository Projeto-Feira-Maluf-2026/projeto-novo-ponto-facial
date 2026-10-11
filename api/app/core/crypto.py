from cryptography.fernet import Fernet
from sqlalchemy import LargeBinary
from sqlalchemy.types import TypeDecorator

from app.core.config import settings


class FieldCipher:
    def __init__(self, key: str = settings.FIELD_ENCRYPTION_KEY) -> None:
        self._fernet = Fernet(key.encode())

    def encrypt(self, value: str | None) -> str | None:
        if value is None:
            return None
        return self._fernet.encrypt(value.encode()).decode()

    def decrypt(self, value: str | None) -> str | None:
        if value is None:
            return None
        return self._fernet.decrypt(value.encode()).decode()


field_cipher = FieldCipher()


class EncryptedEmbedding(TypeDecorator):
    """Authenticated, versioned storage; old plaintext rows remain readable during migration.

    Only the database value is encrypted. Matching receives bytes after authenticated decryption.
    An envelope is never treated as plaintext if its key is missing or its MAC is invalid.
    """

    impl = LargeBinary
    cache_ok = True
    prefix = b"CEBIO1:"

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return self.prefix + field_cipher._fernet.encrypt(bytes(value))

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        raw = bytes(value)
        if raw.startswith(self.prefix):
            return field_cipher._fernet.decrypt(raw[len(self.prefix):])
        if settings.ENVIRONMENT in {"staging", "production"}:
            raise ValueError("Legacy biometric storage requires authorized encryption backfill")
        return raw

