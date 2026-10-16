"""Risk Management exposes routes; no unapproved sync source is created."""

from app.source_contract import ToolRegistration


def register() -> ToolRegistration:
    from app.cyberark.risk_management.api.routes.cyberark_risk import router

    return ToolRegistration(routers=((24, router),))
