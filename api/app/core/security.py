from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def password_hash(password: str) -> str:
    return pwd_context.hash(f"{password}{settings.PASSWORD_PEPPER}")


def verify_password(password: str, hashed_password: str) -> bool:
    return pwd_context.verify(f"{password}{settings.PASSWORD_PEPPER}", hashed_password)
