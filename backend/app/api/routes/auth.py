from fastapi import APIRouter

from .auth_bootstrap import router as bootstrap_router
from .auth_session import router as session_router

router = APIRouter(tags=["Autenticación"])
router.include_router(session_router)
router.include_router(bootstrap_router)
