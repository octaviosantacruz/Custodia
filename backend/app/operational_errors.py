"""HTTP boundary for safe, referenceable internal-server errors."""

import logging

from fastapi import Request
from starlette.responses import JSONResponse

from app.cross.repositories.operational_errors import record_operational_error

LOGGER = logging.getLogger(__name__)


def request_reference(request: Request) -> str:
    state = getattr(request, "state", None)
    request_id = getattr(state, "request_id", "") if state is not None else ""
    return str(request_id)[:128] or "sin-referencia"


async def internal_server_error(request: Request, error: Exception) -> JSONResponse:
    """Return an opaque reference, while retaining a safe admin record.

    Exception text, request bodies, authentication headers, SQL and stack
    traces can contain credentials or PII. They remain in the process logger
    for host operators and are never written to this durable, browser-facing
    operational log.
    """
    reference = request_reference(request)
    path = request.url.path
    trace = (type(error), error, error.__traceback__) if error.__traceback__ is not None else None
    LOGGER.error(
        "Error interno request_id=%s method=%s path=%s error_kind=%s",
        reference,
        request.method,
        path,
        type(error).__name__,
        exc_info=trace,
    )
    pool = getattr(getattr(request.app, "state", None), "db", None)
    if pool is not None:
        await record_operational_error(
            pool,
            request_id=reference,
            method=request.method,
            path=path,
            error=error,
        )
    return JSONResponse(
        {"detail": f"Error interno del servidor. Referencia: {reference}"},
        status_code=500,
    )
