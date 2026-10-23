"""Opt-in real PostgreSQL regression. Never uses DATABASE_URL or production credentials.

PONTO_TEST_DATABASE_URL must point to loopback and a database ending in _test.
Each run uses only a random disposable schema, cleaned up in finally.
"""
import asyncio
import os
from types import SimpleNamespace
from urllib.parse import urlsplit
from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.entities import AttendanceRecord, Base, Employee, Worksite
from app.models.enums import PunchType
from app.schemas.attendance import PunchCreate
from app.services.attendance import AttendanceService


TEST_URL = os.getenv("PONTO_TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not TEST_URL, reason="isolated local PostgreSQL test URL not supplied")


def isolated_test_url(value):
    parts = urlsplit(value)
    if parts.hostname not in {"localhost", "127.0.0.1", "::1"} or not parts.path.endswith("_test"):
        raise ValueError("PostgreSQL integration requires loopback and database suffix _test")
    if not value.startswith("postgresql+asyncpg://"):
        raise ValueError("Use postgresql+asyncpg:// test URL")
    return value


@pytest.mark.asyncio
async def test_real_postgres_concurrent_punches_persist_one_record():
    url = isolated_test_url(TEST_URL)
    schema = "ponto_test_" + uuid4().hex
    admin_engine = create_async_engine(url)
    engine = None
    try:
        async with admin_engine.begin() as connection:
            await connection.execute(text(f'create schema "{schema}"'))
        engine = create_async_engine(url, connect_args={"server_settings": {"search_path": schema}})
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            session.add(Worksite(id="w", name="Test", code="test", address="Test"))
            session.add(Employee(id="e", name="Test", registration="test"))
            await session.commit()
        ready = asyncio.Event()
        arrivals = 0
        processed = SimpleNamespace(
            quality=SimpleNamespace(accepted=True, quality_score=.9, reasons=[]),
            inference=SimpleNamespace(embedding=[1., 0.]),
        )

        async def capture(identifier):
            nonlocal arrivals
            async with factory() as session:
                employee = await session.get(Employee, "e")
                service = AttendanceService(session, SimpleNamespace(
                    from_image_base64=MagicMock(return_value=processed)
                ))
                async def match(*args):
                    nonlocal arrivals
                    arrivals += 1
                    if arrivals == 2:
                        ready.set()
                    await asyncio.wait_for(ready.wait(), 5)
                    return employee, .9, None, .95, None
                service._match_employee = AsyncMock(side_effect=match)
                return await service.register_punch(PunchCreate(
                    worksite_id="w", offline_batch_id=identifier,
                    face={"image_base64": "server-test-double"},
                ))
        first, second = await asyncio.wait_for(asyncio.gather(
            capture("arbitrary-a"), capture("arbitrary-b")
        ), 15)
        assert first.record.id == second.record.id
        assert first.punch_type == second.punch_type == PunchType.ENTRY
        async with factory() as session:
            assert await session.scalar(select(func.count(AttendanceRecord.id))) == 1
    finally:
        if engine is not None:
            await engine.dispose()
        async with admin_engine.begin() as connection:
            # schema is generated locally above, never a caller-provided identifier.
            await connection.execute(text(f'drop schema if exists "{schema}" cascade'))
        await admin_engine.dispose()
