from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError

from app.models.entities import Worksite
from app.schemas.worksites import WorksiteCreate, WorksiteUpdate


class WorksiteService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list(self, page: int = 1, size: int = 50) -> tuple[list[Worksite], int]:
        total = await self.session.scalar(select(func.count()).select_from(Worksite))
        result = await self.session.scalars(
            select(Worksite).order_by(Worksite.name, Worksite.id).offset((page - 1) * size).limit(size)
        )
        return list(result), int(total or 0)

    async def create(self, payload: WorksiteCreate) -> Worksite:
        worksite = Worksite(**payload.model_dump())
        self.session.add(worksite)
        await self._commit_unique_code()
        await self.session.refresh(worksite)
        return worksite

    async def update(self, worksite_id: str, payload: WorksiteUpdate) -> Worksite:
        worksite = await self.session.get(Worksite, worksite_id)
        if not worksite:
            raise LookupError("Obra nao encontrada")
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(worksite, field, value)
        await self._commit_unique_code()
        await self.session.refresh(worksite)
        return worksite

    async def _commit_unique_code(self) -> None:
        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise ConflictError("WORKSITE_CODE_CONFLICT", "Ja existe uma obra com este codigo") from exc

