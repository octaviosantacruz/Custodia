"""Live read-only catalogs; no new synchronization job or persistence."""

from app.source_contract import ToolRegistration


def register() -> ToolRegistration:
    from app.cyberark.connector_manager.api.routes.catalogs import router

    return ToolRegistration(routers=((25, router),))
