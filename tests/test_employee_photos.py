from io import BytesIO

import pytest
from PIL import Image

from app.services.employee_photos import (
    EmployeePhotoError,
    delete_employee_photo,
    normalize_employee_photo,
)


def test_employee_photo_is_resized_and_encoded_as_webp() -> None:
    source = BytesIO()
    Image.new("RGB", (2200, 1400), "#6f8274").save(source, format="PNG")

    normalized = normalize_employee_photo(source.getvalue())

    with Image.open(BytesIO(normalized)) as image:
        assert image.format == "WEBP"
        assert max(image.size) == 960
    assert len(normalized) < len(source.getvalue())


def test_employee_photo_rejects_non_image_payload() -> None:
    with pytest.raises(EmployeePhotoError, match="imagem valida"):
        normalize_employee_photo(b"not-an-image")


@pytest.mark.asyncio
async def test_local_employee_photo_is_permanently_deleted(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    employee_id = "employee-photo-delete"
    photo_dir = tmp_path / "uploads" / "employees"
    photo_dir.mkdir(parents=True)
    photo = photo_dir / f"{employee_id}.webp"
    photo.write_bytes(b"photo")

    await delete_employee_photo(employee_id, f"/uploads/employees/{employee_id}.webp")

    assert not photo.exists()
