"""Shared retry-delay calculation for the HTTP transports (BE-RETRY-001).

Only "how long to wait before the next attempt" lives here: each transport
keeps its own retry decisions (which status codes retry, the 401 refresh,
Netskope's control-200 payload). The helper is a pure function so the delay
policy is unit-testable without touching any client.

Jitter: full jitter (AWS Architecture Blog), ``delay = U(0, min(2**attempt,
cap))``. Without it, parallel sources retrying after the same transient 5xx
or service restart would wake up together. ``retry_after``, already parsed
and clamped by the caller, wins over the exponential backoff and is returned
exactly: the server hint is authoritative (waiting less than it invites
another throttle) and each transport keeps its own clamp policy.
"""

from __future__ import annotations

import random
from collections.abc import Callable


def retry_delay(
    attempt: int,
    *,
    cap: float,
    retry_after: float | None = None,
    random_value: Callable[[], float] | None = None,
) -> float:
    """Seconds to sleep before retrying ``attempt`` (0-based).

    ``cap`` bounds the exponential backoff (8 s for CyberArk/OAuth, 60 s for
    Netskope). ``random_value`` is injectable for deterministic tests; it must
    return a float in [0, 1) (values outside the range are clamped).
    """
    if retry_after is not None:
        return max(0.0, retry_after)
    jitter = random_value or random.random
    base = min(2 ** max(0, attempt), max(0.0, cap))
    return base * min(1.0, max(0.0, jitter()))
