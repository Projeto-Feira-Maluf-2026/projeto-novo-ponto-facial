import logging
import os
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_scopes
from app.core.config import settings
from app.core.errors import AppError
from app.core.permissions import Scope
from app.core.runtime import is_lightweight_serverless
from app.db.session import get_session
from app.models.entities import Employee
from app.schemas.auth import UserRead
from app.schemas.common import Page
from app.schemas.employees import (
    EmployeeCreate,
    EmployeeRead,
    EmployeeUpdate,
    FaceEnrollmentRequest,
)
from app.schemas.enrollment import (
    EnrollmentCancelResponse,
    EnrollmentCaptureRequest,
    EnrollmentCaptureResponse,
    EnrollmentFinalizeRequest,
    EnrollmentFinalizeResponse,
    EnrollmentSampleRequest,
    EnrollmentSampleResponse,
    EnrollmentSessionResponse,
)
from app.services.employees import EmployeeService
from app.services.employee_photos import (
    EmployeePhotoError,
    normalize_employee_photo,
    prune_employee_photo_versions,
    put_employee_photo,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _face_enrollment_service(session: AsyncSession):
    if is_lightweight_serverless():
        raise AppError(
            "FACE_RUNTIME_NOT_INSTALLED",
            "Matricula facial exige o backend de IA em container",
            503,
            {
                "remediation": (
                    "Configure VITE_FACE_API_URL com a URL HTTPS do backend facial "
                    "ou execute este backend com FACE_RUNTIME_MODE=full"
                )
            },
        )
    from app.services.enrollment import FaceEnrollmentService

    return FaceEnrollmentService(session)


@router.get("", response_model=Page[EmployeeRead])
async def list_employees(
    search: str | None = None,
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    _: UserRead = Depends(require_scopes(Scope.EMPLOYEES_READ)),
    session: AsyncSession = Depends(get_session),
) -> Page[EmployeeRead]:
    items, total = await EmployeeService(session).list(search=search, page=page, size=size)
    return Page(items=[EmployeeRead.model_validate(item) for item in items], total=total, page=page, size=size)


@router.post("", response_model=EmployeeRead, status_code=status.HTTP_201_CREATED)
async def create_employee(
    payload: EmployeeCreate,
    _: UserRead = Depends(require_scopes(Scope.EMPLOYEES_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> EmployeeRead:
    try:
        employee = await EmployeeService(session).create(payload)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return EmployeeRead.model_validate(employee)


@router.get("/{employee_id}", response_model=EmployeeRead)
async def get_employee(
    employee_id: str,
    _: UserRead = Depends(require_scopes(Scope.EMPLOYEES_READ)),
    session: AsyncSession = Depends(get_session),
) -> EmployeeRead:
    employee = await session.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Funcionario nao encontrado")
    return EmployeeRead.model_validate(employee)


@router.patch("/{employee_id}", response_model=EmployeeRead)
async def update_employee(
    employee_id: str,
    payload: EmployeeUpdate,
    _: UserRead = Depends(require_scopes(Scope.EMPLOYEES_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> EmployeeRead:
    try:
        employee = await EmployeeService(session).update(employee_id, payload)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return EmployeeRead.model_validate(employee)


@router.delete("/{employee_id}", status_code=204)
async def delete_employee(
    employee_id: str,
    _: UserRead = Depends(require_scopes(Scope.EMPLOYEES_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await EmployeeService(session).delete(employee_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{employee_id}/face-templates", deprecated=True)
async def deprecated_enroll_faces(
    employee_id: str,
    _: FaceEnrollmentRequest,
    __: UserRead = Depends(require_scopes(Scope.EMPLOYEES_WRITE)),
) -> None:
    raise AppError(
        "ENROLLMENT_SESSION_REQUIRED",
        "Use o fluxo guiado de sessao para cadastrar a biometria facial",
        409,
        {"employee_id": employee_id},
    )


@router.post(
    "/{employee_id}/face-enrollment-sessions",
    response_model=EnrollmentSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def start_face_enrollment(
    employee_id: str,
    _: UserRead = Depends(require_scopes(Scope.EMPLOYEES_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> EnrollmentSessionResponse:
    return await _face_enrollment_service(session).start(employee_id)


@router.post(
    "/{employee_id}/face-enrollment-sessions/{enrollment_id}/captures",
    response_model=EnrollmentCaptureResponse,
)
async def validate_face_enrollment_capture(
    employee_id: str,
    enrollment_id: str,
    payload: EnrollmentCaptureRequest,
    _: UserRead = Depends(require_scopes(Scope.EMPLOYEES_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> EnrollmentCaptureResponse:
    return await _face_enrollment_service(session).validate_capture(
        employee_id,
        enrollment_id,
        payload,
    )


@router.post(
    "/{employee_id}/face-enrollment-sessions/{enrollment_id}/samples",
    response_model=EnrollmentSampleResponse,
)
async def collect_face_enrollment_sample(
    employee_id: str,
    enrollment_id: str,
    payload: EnrollmentSampleRequest,
    _: UserRead = Depends(require_scopes(Scope.EMPLOYEES_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> EnrollmentSampleResponse:
    return await _face_enrollment_service(session).collect_sample(
        employee_id,
        enrollment_id,
        payload,
    )


@router.post(
    "/{employee_id}/face-enrollment-sessions/{enrollment_id}/finalize",
    response_model=EnrollmentFinalizeResponse,
)
async def finalize_face_enrollment(
    employee_id: str,
    enrollment_id: str,
    payload: EnrollmentFinalizeRequest,
    _: UserRead = Depends(require_scopes(Scope.EMPLOYEES_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> EnrollmentFinalizeResponse:
    return await _face_enrollment_service(session).finalize(
        employee_id,
        enrollment_id,
        payload,
    )


@router.delete(
    "/{employee_id}/face-enrollment-sessions/{enrollment_id}",
    response_model=EnrollmentCancelResponse,
)
async def cancel_face_enrollment(
    employee_id: str,
    enrollment_id: str,
    _: UserRead = Depends(require_scopes(Scope.EMPLOYEES_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> EnrollmentCancelResponse:
    return await _face_enrollment_service(session).cancel(employee_id, enrollment_id)


@router.post("/{employee_id}/photo", response_model=EmployeeRead)
async def upload_employee_photo(
    employee_id: str,
    file: UploadFile = File(...),
    _: UserRead = Depends(require_scopes(Scope.EMPLOYEES_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> EmployeeRead:
    if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Formato de imagem nao permitido")
    employee = await session.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Funcionario nao encontrado")
    contents = await file.read()
    try:
        normalized = normalize_employee_photo(contents)
    except EmployeePhotoError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    if settings.BLOB_READ_WRITE_TOKEN:
        employee.photo_url = await put_employee_photo(employee_id, normalized)
    elif os.getenv("VERCEL"):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Vercel Blob nao configurado",
        )
    else:
        upload_dir = Path("uploads/employees")
        upload_dir.mkdir(parents=True, exist_ok=True)
        target = upload_dir / f"{employee_id}.webp"
        target.write_bytes(normalized)
        employee.photo_url = f"/uploads/employees/{target.name}"
    await session.commit()
    await session.refresh(employee)

    if settings.BLOB_READ_WRITE_TOKEN and employee.photo_url:
        try:
            removed, reclaimed = await prune_employee_photo_versions(employee_id, employee.photo_url)
            if removed:
                logger.info(
                    "Fotos antigas removidas employee_id=%s count=%s bytes=%s",
                    employee_id,
                    removed,
                    reclaimed,
                )
        except Exception:
            logger.warning(
                "Nao foi possivel limpar versoes antigas employee_id=%s",
                employee_id,
                exc_info=True,
            )
    return EmployeeRead.model_validate(employee)


@router.get("/{employee_id}/photo/content")
async def employee_photo_content(
    employee_id: str,
    _: UserRead = Depends(require_scopes(Scope.EMPLOYEES_READ)),
    session: AsyncSession = Depends(get_session),
) -> Response:
    employee = await session.get(Employee, employee_id)
    if not employee or not employee.photo_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Foto nao encontrada")

    if employee.photo_url.startswith("https://"):
        if not settings.BLOB_READ_WRITE_TOKEN:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Vercel Blob nao configurado",
            )
        from vercel.blob import AsyncBlobClient

        async with AsyncBlobClient(token=settings.BLOB_READ_WRITE_TOKEN) as client:
            stored = await client.get(employee.photo_url, access="private", use_cache=True)
        contents = stored.content
        content_type = stored.content_type or "image/webp"
    else:
        local_path = Path("uploads/employees") / Path(employee.photo_url).name
        if not local_path.is_file():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Foto nao encontrada")
        contents = local_path.read_bytes()
        content_type = "image/webp"

    return Response(
        content=contents,
        media_type=content_type,
        headers={"Cache-Control": "private, max-age=300"},
    )
