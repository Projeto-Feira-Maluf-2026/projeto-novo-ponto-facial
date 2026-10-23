"""Exercise PostgreSQL locks and backup/restore only on a synthetic local database.

No production URL is accepted and no application/biometric data is loaded.
Requires asyncpg plus pg_dump/pg_restore. CI runs against its isolated service.
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from urllib.parse import unquote, urlsplit
from uuid import uuid4

import asyncpg


def local_connection_environment(url: str) -> dict[str, str]:
    parts = urlsplit(url)
    if parts.scheme not in {"postgresql", "postgres"} or parts.hostname not in {
        "127.0.0.1", "localhost", "::1"
    }:
        raise ValueError("Only an isolated loopback PostgreSQL service is allowed")
    if parts.query or parts.fragment:
        raise ValueError("URL options are not accepted by the isolated rehearsal")
    if parts.path != "/postgres":
        raise ValueError("Connect to the local maintenance database /postgres")
    return {
        **{key: value for key, value in os.environ.items() if not key.startswith("PG")},
        "PGHOST": parts.hostname,
        "PGPORT": str(parts.port or 5432),
        "PGUSER": unquote(parts.username or "postgres"),
        "PGPASSWORD": unquote(parts.password or ""),
        "PGCONNECT_TIMEOUT": "5",
    }


def run_tool(name: str, arguments: list[str], env: dict[str, str]) -> None:
    executable = shutil.which(name)
    if not executable:
        raise RuntimeError(f"{name} is required for the local rehearsal")
    # Credentials stay in the child environment. Do not publish subprocess stderr.
    result = subprocess.run([executable, *arguments], env=env, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError(f"{name} failed (exit {result.returncode}); inspect locally")


async def rehearse(url: str) -> None:
    env = local_connection_environment(url)
    for name in ("pg_dump", "pg_restore"):
        if not shutil.which(name):
            raise RuntimeError(f"{name} is required")
    suffix = uuid4().hex
    source_name, restore_name = f"audit_source_{suffix}", f"audit_restore_{suffix}"
    admin = await asyncpg.connect(url, timeout=5)
    source = first = second = restored = None
    created: list[str] = []
    try:
        for name in (source_name, restore_name):
            await admin.execute(f'CREATE DATABASE "{name}"')
            created.append(name)
        source = await asyncpg.connect(url, database=source_name, timeout=5)
        await source.execute("CREATE TABLE canary (id integer PRIMARY KEY, value integer NOT NULL)")
        await source.execute("INSERT INTO canary VALUES (1, 0)")
        first = await asyncpg.connect(url, database=source_name, timeout=5)
        second = await asyncpg.connect(url, database=source_name, timeout=5)
        async with first.transaction():
            await first.fetchval("SELECT value FROM canary WHERE id=1 FOR UPDATE")
            await first.execute("UPDATE canary SET value=1 WHERE id=1")
            async with second.transaction():
                await second.execute("SET LOCAL lock_timeout = '100ms'")
                try:
                    await second.fetchval("SELECT value FROM canary WHERE id=1 FOR UPDATE")
                except asyncpg.LockNotAvailableError:
                    pass
                else:
                    raise AssertionError("Concurrent transaction bypassed the row lock")
        assert await second.fetchval("SELECT value FROM canary WHERE id=1") == 1
        try:
            async with source.transaction():
                await source.execute("UPDATE canary SET value=2 WHERE id=1")
                raise RuntimeError("injected rollback")
        except RuntimeError:
            pass
        assert await source.fetchval("SELECT value FROM canary WHERE id=1") == 1
        with tempfile.TemporaryDirectory(prefix="ponto-restore-") as folder:
            archive = Path(folder) / "synthetic.dump"
            run_tool("pg_dump", ["--dbname", source_name, "--format=custom", "--no-owner",
                                 "--no-acl", "--file", str(archive)], env)
            assert archive.stat().st_size > 0
            run_tool("pg_restore", ["--dbname", restore_name, "--no-owner", "--no-acl",
                                    "--exit-on-error", str(archive)], env)
            restored = await asyncpg.connect(url, database=restore_name, timeout=5)
            assert await restored.fetch("SELECT id, value FROM canary") == await source.fetch(
                "SELECT id, value FROM canary"
            )
        print("PASS: real row lock, rollback, synthetic dump and restored equality")
    finally:
        for connection in (source, first, second, restored):
            if connection is not None:
                await connection.close()
        for name in created:
            await admin.execute(f'DROP DATABASE "{name}"')
        await admin.close()


if __name__ == "__main__":
    try:
        asyncio.run(rehearse(os.environ["ISOLATED_POSTGRES_URL"]))
    except Exception as exc:
        # Library connection errors can contain credentials; publish the type only.
        raise SystemExit(f"Local rehearsal failed ({type(exc).__name__})") from None
