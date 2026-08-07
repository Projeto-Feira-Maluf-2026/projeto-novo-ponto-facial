from enum import StrEnum


class Scope(StrEnum):
    DASHBOARD_READ = "dashboard:read"
    EMPLOYEES_WRITE = "employees:write"
    EMPLOYEES_READ = "employees:read"
    ATTENDANCE_WRITE = "attendance:write"
    ATTENDANCE_READ = "attendance:read"
    WORKSITES_WRITE = "worksites:write"
    WORKSITES_READ = "worksites:read"
    DEVICES_WRITE = "devices:write"
    DEVICES_READ = "devices:read"
    REPORTS_EXPORT = "reports:export"
    ALERTS_READ = "alerts:read"
    AUDIT_READ = "audit:read"


ROLE_SCOPES: dict[str, set[Scope]] = {
    "SUPER_ADMIN": set(Scope),
    "RH": {
        Scope.DASHBOARD_READ,
        Scope.EMPLOYEES_READ,
        Scope.EMPLOYEES_WRITE,
        Scope.ATTENDANCE_READ,
        Scope.ATTENDANCE_WRITE,
        Scope.WORKSITES_READ,
        Scope.REPORTS_EXPORT,
        Scope.ALERTS_READ,
        Scope.AUDIT_READ,
    },
    "GESTOR_OBRA": {
        Scope.DASHBOARD_READ,
        Scope.EMPLOYEES_READ,
        Scope.ATTENDANCE_READ,
        Scope.ATTENDANCE_WRITE,
        Scope.WORKSITES_READ,
        Scope.DEVICES_READ,
        Scope.REPORTS_EXPORT,
        Scope.ALERTS_READ,
    },
    "SUPERVISOR": {
        Scope.DASHBOARD_READ,
        Scope.EMPLOYEES_READ,
        Scope.ATTENDANCE_READ,
        Scope.ATTENDANCE_WRITE,
        Scope.WORKSITES_READ,
    },
    "FUNCIONARIO": {
        Scope.ATTENDANCE_WRITE,
        Scope.ATTENDANCE_READ,
    },
}


def scopes_for_role(role: str) -> list[str]:
    return sorted(scope.value for scope in ROLE_SCOPES.get(role, set()))

