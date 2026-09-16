from fastapi import APIRouter

from .safe_lifecycle import router as lifecycle_router
from .safe_read import _safes_csv, router as read_router
from .safe_write import router as write_router

# PENTEST-005: this used to apply require_read_access (session only) to
# every nested route, including safe_write.py's classification/decommission
# endpoints whose own dependency (require_permission -> require_write_access)
# is meant to also accept X-Access-Token for automation. That blanket
# dependency ran first and 401'd token-only callers before the route-level
# check ever got a chance to authorize them. Each read route in safe_read.py
# / safe_lifecycle.py now declares its own read dependency explicitly.
router = APIRouter(tags=["Safes"])
router.include_router(read_router)
router.include_router(write_router)
router.include_router(lifecycle_router)

__all__ = ["router", "_safes_csv"]
