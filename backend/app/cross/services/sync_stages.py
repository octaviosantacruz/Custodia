"""Stage-level outcome tracking shared by every source synchronizer.

A source declares its layers by running them through ``StageRecorder.run``.
A required stage that fails aborts the run (the exception propagates, nothing
is reconciled). An optional stage that fails is recorded and yields ``None``;
the caller must then keep out of reconciliation whatever that stage governs.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, TypeVar

from app.cross.repositories.operational_errors import safe_error_kind

T = TypeVar("T")


@dataclass(frozen=True)
class StageOutcome:
    stage: str
    required: bool
    status: str  # completed | failed | skipped
    duration_ms: int
    item_count: int | None = None
    error_kind: str | None = None
    detail: str | None = None


class StageRecorder:
    def __init__(self) -> None:
        self.outcomes: list[StageOutcome] = []

    async def run(
        self,
        stage: str,
        action: Callable[[], Awaitable[T]],
        *,
        required: bool = True,
        count: Callable[[T], int] | None = None,
    ) -> T | None:
        started = time.monotonic()
        try:
            value = await action()
        except Exception as error:
            self.outcomes.append(StageOutcome(
                stage, required, "failed", _elapsed_ms(started), error_kind=safe_error_kind(error),
            ))
            if required:
                raise
            return None
        self.outcomes.append(StageOutcome(
            stage, required, "completed", _elapsed_ms(started),
            item_count=count(value) if count else None,
        ))
        return value

    def skip(self, stage: str, detail: str, *, required: bool = False) -> None:
        """Record a stage that does not apply (e.g. optional contract unconfigured)."""
        self.outcomes.append(StageOutcome(stage, required, "skipped", 0, detail=detail[:200]))

    def failed(self, stage: str) -> bool:
        return any(item.stage == stage and item.status == "failed" for item in self.outcomes)

    @property
    def degraded(self) -> bool:
        return any(item.status == "failed" and not item.required for item in self.outcomes)


def _elapsed_ms(started: float) -> int:
    return max(int((time.monotonic() - started) * 1000), 0)


def degraded_stage_errors(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Run-level error entries for failed optional stages (no exception text)."""
    return [
        {
            "source": row["source_system"],
            "stage": row["stage"],
            "error_kind": row["error_kind"],
            "error": "Una capa opcional falló; la corrida terminó con avisos y no retiró lo que esa capa gobierna.",
        }
        for row in rows
        if row["status"] == "failed" and not row["required"]
    ]
