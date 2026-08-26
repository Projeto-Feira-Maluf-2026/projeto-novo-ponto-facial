"""Timezone helpers for the UTC-at-rest, Sao Paulo-at-the-edge convention."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

SAO_PAULO = ZoneInfo("America/Sao_Paulo")


def as_utc_naive(value: datetime) -> datetime:
    """Normalize an instant for storage in the project's naive UTC columns."""
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def as_local(value: datetime) -> datetime:
    """Interpret database-naive datetimes as UTC and display them in Sao Paulo."""
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value
    return aware.astimezone(SAO_PAULO)


def local_day_utc_bounds(day: date) -> tuple[datetime, datetime]:
    start_local = datetime.combine(day, time.min, tzinfo=SAO_PAULO)
    end_local = start_local + timedelta(days=1)
    return as_utc_naive(start_local), as_utc_naive(end_local)


def utc_isoformat(value: datetime) -> str:
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return aware.isoformat().replace("+00:00", "Z")
