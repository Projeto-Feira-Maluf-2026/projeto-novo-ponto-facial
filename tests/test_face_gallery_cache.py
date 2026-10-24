from types import SimpleNamespace
from unittest.mock import AsyncMock

import numpy as np
import pytest

from app.core.config import settings
from app.services import attendance
from app.services.access import ResourceAccess
from app.services.attendance import AttendanceService, invalidate_face_template_cache


@pytest.fixture
def gallery_runtime(monkeypatch):
    monkeypatch.setattr(settings, 'ENVIRONMENT', 'development')
    clock = [100.0]
    monkeypatch.setattr(attendance, 'monotonic', lambda: clock[0])
    invalidate_face_template_cache()
    info = SimpleNamespace(model_name='model', model_version='1', embedding_dimension=2,
                           detector_name='detector', normalization_version='v1')
    face = SimpleNamespace(provider=SimpleNamespace(info=lambda: info))
    template = SimpleNamespace(id='t', employee_id='a',
                               embedding=np.array([1, 0], dtype=np.float32).tobytes(),
                               quality_score=.9)

    def service(scope=None):
        session = SimpleNamespace(info={'resource_access': scope},
                                  scalars=AsyncMock(return_value=[template]),
                                  get=AsyncMock(return_value=SimpleNamespace(id='a')))
        return AttendanceService(session, face)

    yield clock, service
    invalidate_face_template_cache()


async def match(service, worksite='w'):
    return await service._match_employee([([1.0, 0.0], .9)], None, worksite)


@pytest.mark.asyncio
async def test_gallery_reused_between_requests_but_winning_employee_checked_each_time(gallery_runtime):
    _, factory = gallery_runtime
    first, second = factory(), factory()
    assert (await match(first))[-1] is None
    assert (await match(second))[-1] is None
    assert first.session.scalars.await_count == 1
    second.session.scalars.assert_not_awaited()
    second.session.get.assert_awaited_once()
    first_gallery = first._template_cache[(None, 'w')]
    assert second._template_cache[(None, 'w')] is first_gallery


@pytest.mark.asyncio
async def test_cache_isolated_by_resource_scope_and_worksite(gallery_runtime):
    _, factory = gallery_runtime
    admin = factory()
    manager = factory(ResourceAccess(('w',), ('a',)))
    other = factory(ResourceAccess(('w',), ('a', 'b')))
    for service in (admin, manager, other):
        await match(service)
        service.session.scalars.assert_awaited_once()
    await match(manager, 'other-worksite')
    assert manager.session.scalars.await_count == 2


@pytest.mark.asyncio
async def test_ttl_and_enrollment_invalidation_reload_prepared_gallery(gallery_runtime):
    clock, factory = gallery_runtime
    await match(factory())
    clock[0] += attendance.TEMPLATE_CACHE_TTL_SECONDS + .01
    expired = factory()
    await match(expired)
    expired.session.scalars.assert_awaited_once()
    invalidate_face_template_cache()
    reenrolled = factory()
    await match(reenrolled)
    reenrolled.session.scalars.assert_awaited_once()


@pytest.mark.asyncio
async def test_shared_gallery_count_is_bounded(gallery_runtime):
    _, factory = gallery_runtime
    for index in range(attendance.TEMPLATE_CACHE_MAX_GALLERIES + 3):
        await match(factory(), str(index))
    assert len(attendance._shared_template_cache) == attendance.TEMPLATE_CACHE_MAX_GALLERIES


@pytest.mark.asyncio
async def test_quality_rejection_preserves_reason_when_templates_exist(gallery_runtime):
    _, factory = gallery_runtime
    service = factory()
    service.session.scalars.return_value[0].quality_score = 0.0
    assert (await match(service))[-1] == 'low_similarity'
