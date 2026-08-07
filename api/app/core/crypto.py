from cryptography.fernet import Fernet

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

