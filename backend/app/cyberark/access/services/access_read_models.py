"""Read/query facade for the routes of this tool (ARCH-LAYERS-002).

Routes (Controller) depend on ``services/``; this module is the single place
where they reach the repositories below. SQL and audit stay in the
repositories; add domain logic here, not in the route.
"""

from __future__ import annotations

from app.cyberark.access.repositories.access_queries import (
    list_access_assets,
)

__all__ = [
    "list_access_assets",
]
