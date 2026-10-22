"""Read/query facade for the routes of this tool (ARCH-LAYERS-002).

Routes (Controller) depend on ``services/``; this module is the single place
where they reach the repositories below. SQL and audit stay in the
repositories; add domain logic here, not in the route.
"""

from __future__ import annotations

from app.cross.repositories.dashboard_templates import (
    list_actor_dashboard_templates,
    publish_dashboard_template,
)
from app.cross.repositories.workspace_preferences import (
    MAX_RECENT,
    MAX_VISIBLE,
    get_workspace_preferences,
    save_workspace_preferences,
)

__all__ = [
    "MAX_RECENT",
    "MAX_VISIBLE",
    "get_workspace_preferences",
    "list_actor_dashboard_templates",
    "publish_dashboard_template",
    "save_workspace_preferences",
]
