"""Validation, normalization and bounded storage for employee profile photos."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import settings

PROFILE_PHOTO_MAX_SIDE = 960
PROFILE_PHOTO_QUALITY = 82
PROFILE_PHOTO_PATH = "employees/{employee_id}/profile.webp"
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}


class EmployeePhotoError(ValueError):
    pass


def normalize_employee_photo(contents: bytes) -> bytes:
    """Return a display-sized WebP and reject disguised or unsafe image payloads."""
    if not contents:
        raise EmployeePhotoError("A imagem esta vazia")
    if len(contents) > settings.FACE_MAX_IMAGE_BYTES:
        raise EmployeePhotoError("A imagem excede o limite permitido")

    try:
        with Image.open(BytesIO(contents)) as source:
            if (source.format or "").upper() not in ALLOWED_IMAGE_FORMATS:
                raise EmployeePhotoError("Formato de imagem nao permitido")
            if source.width * source.height > settings.FACE_MAX_IMAGE_PIXELS:
                raise EmployeePhotoError("A imagem excede o limite seguro de pixels")

            image = ImageOps.exif_transpose(source)
            image.thumbnail(
                (PROFILE_PHOTO_MAX_SIDE, PROFILE_PHOTO_MAX_SIDE),
                Image.Resampling.LANCZOS,
            )
            if image.mode != "RGB":
                if "A" in image.getbands():
                    background = Image.new("RGB", image.size, "white")
                    background.paste(image, mask=image.getchannel("A"))
                    image = background
                else:
                    image = image.convert("RGB")

            output = BytesIO()
            image.save(
                output,
                format="WEBP",
                quality=PROFILE_PHOTO_QUALITY,
                method=5,
                optimize=True,
            )
            return output.getvalue()
    except (UnidentifiedImageError, OSError) as exc:
        raise EmployeePhotoError("O arquivo nao contem uma imagem valida") from exc


async def put_employee_photo(employee_id: str, normalized_contents: bytes) -> str:
    """Store one predictable object per employee, overwriting instead of accumulating."""
    from vercel.blob import AsyncBlobClient

    async with AsyncBlobClient(token=settings.BLOB_READ_WRITE_TOKEN) as client:
        uploaded = await client.put(
            PROFILE_PHOTO_PATH.format(employee_id=employee_id),
            normalized_contents,
            access="private",
            content_type="image/webp",
            add_random_suffix=False,
            overwrite=True,
            cache_control_max_age=300,
        )
    return uploaded.url


async def prune_employee_photo_versions(employee_id: str, keep_url: str) -> tuple[int, int]:
    """Delete legacy random-suffix versions only after the database points to the new photo."""
    from vercel.blob import AsyncBlobClient

    stale_urls: list[str] = []
    reclaimed_bytes = 0
    async with AsyncBlobClient(token=settings.BLOB_READ_WRITE_TOKEN) as client:
        objects = await client.iter_objects(prefix=f"employees/{employee_id}")
        async for blob in objects:
            if blob.url != keep_url:
                stale_urls.append(blob.url)
                reclaimed_bytes += blob.size
        if stale_urls:
            await client.delete(stale_urls)
    return len(stale_urls), reclaimed_bytes


async def delete_employee_photo(employee_id: str, photo_url: str) -> None:
    """Delete the employee photo from the configured private storage."""
    if photo_url.startswith("https://"):
        if not settings.BLOB_READ_WRITE_TOKEN:
            raise EmployeePhotoError("Vercel Blob nao configurado para excluir a foto")
        from vercel.blob import AsyncBlobClient

        async with AsyncBlobClient(token=settings.BLOB_READ_WRITE_TOKEN) as client:
            urls = {photo_url}
            objects = await client.iter_objects(prefix=f"employees/{employee_id}")
            async for blob in objects:
                urls.add(blob.url)
            await client.delete(list(urls))
        return

    upload_dir = Path("uploads/employees").resolve()
    local_path = (upload_dir / f"{employee_id}.webp").resolve()
    if local_path.parent != upload_dir:
        raise EmployeePhotoError("Caminho de foto invalido")
    local_path.unlink(missing_ok=True)
