from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.v1 import (
    admin,
    approvals,
    auth,
    health,
    meta,
    reference,
    reports,
    time_entries,
    timesheets,
)
from app.security.dependencies import csrf_guard

api_router = APIRouter(dependencies=[Depends(csrf_guard)])
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(meta.router)
api_router.include_router(reference.router)
api_router.include_router(timesheets.router)
api_router.include_router(time_entries.router)
api_router.include_router(approvals.router)
api_router.include_router(admin.router)
api_router.include_router(reports.router)
