"""The web app hides actions by role; its scope map must match the server's."""
import re
from pathlib import Path

from app.core.permissions import ROLE_SCOPES, Scope

PERMISSIONS_TS = Path(__file__).resolve().parents[1] / "web" / "src" / "auth" / "permissions.ts"


def _frontend_role_scopes() -> dict[str, set[str]]:
    source = PERMISSIONS_TS.read_text(encoding="utf-8")
    all_scopes = set(re.findall(r"'([a-z]+:[a-z]+)'", source.split("const ALL_SCOPES", 1)[1].split("];", 1)[0]))
    block = source.split("export const ROLE_SCOPES", 1)[1].split("\n};", 1)[0]
    roles: dict[str, set[str]] = {}
    for role, body in re.findall(r"\n  ([A-Z_]+): (\[[^\]]*\]|ALL_SCOPES)", block):
        roles[role] = all_scopes if body == "ALL_SCOPES" else set(re.findall(r"'([a-z]+:[a-z]+)'", body))
    return roles


def test_frontend_scope_map_matches_server_role_scopes() -> None:
    frontend = _frontend_role_scopes()
    server = {role: {scope.value for scope in scopes} for role, scopes in ROLE_SCOPES.items()}

    assert frontend == server


def test_frontend_knows_every_server_scope() -> None:
    assert _frontend_role_scopes()["SUPER_ADMIN"] == {scope.value for scope in Scope}
