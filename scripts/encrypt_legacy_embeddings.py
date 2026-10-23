"""Explicit, resumable application-side backfill; default is a read-only count.

Run from api with PYTHONPATH=. python ../scripts/encrypt_legacy_embeddings.py.
--apply requires operator authorization. No sample, key, or embedding is printed.
"""
import argparse
import asyncio

from sqlalchemy import bindparam, text

from app.core.crypto import EncryptedEmbedding
from app.db.session import AsyncSessionLocal


async def run(apply: bool, batch_size: int) -> None:
    cipher = EncryptedEmbedding()
    async with AsyncSessionLocal() as session:
        count = await session.scalar(text(
            "select count(*) from face_templates where substring(embedding from 1 for 7) != :prefix"
        ), {"prefix": cipher.prefix})
        print(f"legacy_rows={count}; mode={'apply' if apply else 'dry-run'}")
        if not apply:
            return
        changed = 0
        while True:
            rows = (await session.execute(text(
                "select id, embedding from face_templates "
                "where substring(embedding from 1 for 7) != :prefix "
                "order by id limit :batch_size for update skip locked"
            ), {"prefix": cipher.prefix, "batch_size": batch_size})).all()
            if not rows:
                break
            for row in rows:
                # Bind plain encrypted bytes: raw SQL intentionally bypasses ORM encryption.
                encrypted = cipher.process_bind_param(bytes(row.embedding), None)
                statement = text("update face_templates set embedding=:blob where id=:id").bindparams(
                    bindparam("blob", type_=cipher.impl)
                )
                await session.execute(statement, {"id": row.id, "blob": encrypted})
            await session.commit()
            changed += len(rows)
        print(f"encrypted_rows={changed}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--batch-size", type=int, default=100)
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 1000:
        parser.error("batch-size must be 1..1000")
    asyncio.run(run(args.apply, args.batch_size))
