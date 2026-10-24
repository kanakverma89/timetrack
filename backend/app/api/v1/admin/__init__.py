"""Administration API. Every route here requires the ADMIN role; there are no exceptions."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.v1.admin import catalog, policy, teams, users
from app.models import Role
from app.security.dependencies import require_roles

router = APIRouter(prefix="/admin", dependencies=[Depends(require_roles(Role.ADMIN))])
router.include_router(users.router)
router.include_router(teams.router)
router.include_router(catalog.router)
router.include_router(policy.router)
