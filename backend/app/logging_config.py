"""Structured process logging for local and hosted observability collectors.

Logs deliberately go to stdout. Container runtimes, systemd and hosted log
collectors can ship that stream without the application managing log files or
credentials. The formatter keeps the source location in every record so an
operator can jump from an alert to the responsible module and line.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone


_request_id: contextvars.ContextVar[str] = contextvars.ContextVar(
    "custodia_request_id", default=""
)
_CONFIGURED = False

# PostgreSQL constraint errors echo row and key values in their DETAIL line
# (observed: a CheckViolation printing a user's e-mail). Keep the constraint
# and column names for diagnosis and drop the values.
_ROW_VALUES = re.compile(r"(Failing row contains )\(.*\)")
_KEY_VALUES = re.compile(r"(Key \(.*?\)=)\(.*\)(?= (?:already exists|is not present))")


def redact_database_values(text: str) -> str:
    return _KEY_VALUES.sub(r"\1(<redactado>)", _ROW_VALUES.sub(r"\1(<redactado>)", text))


def _log_level(value: str | None) -> int:
    level = logging.getLevelNamesMapping().get((value or "INFO").strip().upper())
    return level if level is not None else logging.INFO


def set_request_id(value: str) -> contextvars.Token[str]:
    """Attach a request identifier to logs emitted in the current context."""
    return _request_id.set(value[:128])


def reset_request_id(token: contextvars.Token[str]) -> None:
    """Restore the previous request context after an ASGI request finishes."""
    _request_id.reset(token)


class JsonLogFormatter(logging.Formatter):
    """Serialize standard LogRecords into stable, ingestion-friendly JSON."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "file": record.pathname,
            "line": record.lineno,
            "function": record.funcName,
            "message": redact_database_values(record.getMessage()),
        }
        request_id = _request_id.get()
        if request_id:
            payload["request_id"] = request_id
        if record.exc_info:
            payload["exception"] = redact_database_values(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_logging() -> None:
    """Install the application logger once, without exposing sensitive data."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    level = _log_level(os.environ.get("LOG_LEVEL"))
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonLogFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # Let Uvicorn records use the same schema instead of emitting a second
    # plain-text format. `disable_existing_loggers` is intentionally avoided:
    # libraries must remain usable and their records should be observable.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
    # HTTP client request lines are useful while debugging, but too noisy for
    # the default production stream. Individual failures still remain visible
    # at WARNING/ERROR and can be enabled with LOG_LEVEL=DEBUG when needed.
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)

    _CONFIGURED = True
