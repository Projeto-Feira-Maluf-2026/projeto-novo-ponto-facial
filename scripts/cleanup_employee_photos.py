"""Remove unreferenced employee photos from the connected Vercel Blob store."""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select

PROJECT_ROOT = Path(__file__).resolve().parents[1]
API_ROOT = PROJECT_ROOT / "api"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.db.session import AsyncSessionLocal, engine  # noqa: E402
from app.models.entities import Employee  # noqa: E402


async def cleanup(*, apply: bool, minimum_age_hours: float) -> int:
    from vercel.blob import AsyncBlobClient

    token = os.getenv("BLOB_READ_WRITE_TOKEN", "").strip()
    if not token:
        raise RuntimeError("BLOB_READ_WRITE_TOKEN nao esta configurado")

    async with AsyncSessionLocal() as session:
        rows = await session.execute(select(Employee.photo_url).where(Employee.photo_url.is_not(None)))
        active_urls = {str(value) for value in rows.scalars() if value}

    blobs = []
    async with AsyncBlobClient(token=token) as client:
        objects = await client.iter_objects(prefix="employees/")
        async for blob in objects:
            blobs.append(blob)

        if blobs and not active_urls:
            raise RuntimeError(
                "A loja possui fotos, mas o banco conectado nao referencia nenhuma; limpeza cancelada"
            )

        cutoff = datetime.now(UTC) - timedelta(hours=max(minimum_age_hours, 0))
        stale = [
            blob
            for blob in blobs
            if blob.url not in active_urls and blob.uploaded_at <= cutoff
        ]
        stale_bytes = sum(blob.size for blob in stale)

        print(f"Fotos na loja: {len(blobs)}")
        print(f"Fotos referenciadas no banco: {len(active_urls)}")
        print(f"Fotos orfas elegiveis: {len(stale)}")
        print(f"Espaco recuperavel: {stale_bytes / (1024 * 1024):.2f} MiB")

        if apply and stale:
            await client.delete([blob.url for blob in stale])
            print(f"Fotos removidas: {len(stale)}")
        elif not apply:
            print("Simulacao concluida; use --apply para remover somente as fotos orfas listadas.")

    await engine.dispose()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--minimum-age-hours", type=float, default=1.0)
    args = parser.parse_args()
    return asyncio.run(cleanup(apply=args.apply, minimum_age_hours=args.minimum_age_hours))


if __name__ == "__main__":
    raise SystemExit(main())
