from fastapi import APIRouter

from app.cross.api.routes.auth_api_tokens import router as api_tokens_router
from app.cross.api.routes.auth_bootstrap import router as bootstrap_router
from app.cross.api.routes.auth_session import router as session_router

router = APIRouter(tags=["Autenticación"])
router.include_router(session_router)
router.include_router(bootstrap_router)
router.include_router(api_tokens_router)
