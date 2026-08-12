from app.models.enums import UserRole
from app.services.auth import AuthService


def user_payload(**overrides) -> dict:
    payload = {
        "id": "e1078324-745a-4f31-9397-813f7312aa47",
        "email": "admin@example.com",
        "created_at": "2026-08-07T12:00:00Z",
        "app_metadata": {"role": "SUPER_ADMIN"},
        "user_metadata": {"name": "Administrador"},
    }
    payload.update(overrides)
    return payload


def test_authenticated_user_receives_full_access() -> None:
    user = AuthService._to_read_model(user_payload())

    assert user.role == UserRole.SUPER_ADMIN
    assert user.name == "Administrador"
    assert "audit:read" in user.scopes


def test_user_without_role_metadata_receives_full_access() -> None:
    payload = user_payload(
        app_metadata={},
        user_metadata={"name": "Usuario", "role": "SUPER_ADMIN"},
    )

    user = AuthService._to_read_model(payload)

    assert user.role == UserRole.SUPER_ADMIN
    assert "audit:read" in user.scopes
    assert "employees:write" in user.scopes
