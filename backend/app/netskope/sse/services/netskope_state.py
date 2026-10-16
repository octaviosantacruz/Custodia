"""Read/query facade for the routes of this tool (ARCH-LAYERS-002).

Routes (Controller) depend on ``services/``; this module is the single place
where they reach the repositories below. SQL and audit stay in the
repositories; add domain logic here, not in the route.
"""

from __future__ import annotations

from app.netskope.sse.repositories.netskope_baselines import (
    get_netskope_baselines,
    save_netskope_baseline,
)
from app.netskope.sse.repositories.netskope_dashboard_preferences import (
    get_netskope_dashboard_preferences,
    save_netskope_dashboard_preferences,
)
from app.netskope.sse.repositories.netskope_device_reviews import (
    get_device_review_summary,
)

__all__ = [
    "get_device_review_summary",
    "get_netskope_baselines",
    "get_netskope_dashboard_preferences",
    "save_netskope_baseline",
    "save_netskope_dashboard_preferences",
]
