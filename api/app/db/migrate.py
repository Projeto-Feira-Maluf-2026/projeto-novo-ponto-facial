import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from app.db.session import engine
from app.models.entities import Base


async def database_state() -> str:
    async with engine.connect() as connection:
        return await connection.run_sync(_database_state_sync)


def _database_state_sync(connection) -> str:
    inspector = inspect(connection)
    existing_tables = set(inspector.get_table_names())
    expected_tables = set(Base.metadata.tables)
    if "alembic_version" in existing_tables:
        return "managed"
    application_tables = existing_tables & expected_tables
    if not application_tables:
        return "empty"
    if application_tables != expected_tables:
        missing = sorted(expected_tables - application_tables)
        raise RuntimeError(f"Schema legado parcial; tabelas ausentes: {missing}")

    for table_name, table in Base.metadata.tables.items():
        expected_columns = set(table.columns.keys())
        existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
        if existing_columns != expected_columns:
            missing = sorted(expected_columns - existing_columns)
            extra = sorted(existing_columns - expected_columns)
            raise RuntimeError(
                f"Schema legado incompativel em {table_name}: missing={missing}, extra={extra}"
            )
    return "legacy-compatible"


def alembic_config() -> Config:
    api_root = Path(__file__).resolve().parents[2]
    return Config(str(api_root / "alembic.ini"))


def main() -> None:
    state = asyncio.run(database_state())
    config = alembic_config()
    if state == "legacy-compatible":
        command.stamp(config, "head")
    command.upgrade(config, "head")


if __name__ == "__main__":
    main()
