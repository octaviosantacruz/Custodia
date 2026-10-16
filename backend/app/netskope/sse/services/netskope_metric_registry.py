"""Resolve tenant-dependent AA availability for the static SSE metric contracts."""

from dataclasses import asdict

from app.netskope.sse.metric_contracts import CHART_WIDGETS, DATA_WIDGETS, METRIC_CONTRACTS


def metric_contracts() -> list[dict]:
    """Safe metadata without credentials, tenant IDs or discovery labels."""
    from app.netskope.sse.services.netskope_aa_metrics import (
        AnalyticsContractError, SeverityApproval, SeverityContract,
    )

    result = []
    for contract in METRIC_CONTRACTS.values():
        value = asdict(contract)
        value["contract_state"] = "verified"
        if contract.adapter.source == "advanced_analytics":
            try:
                binding = SeverityContract.from_environment()
                approval = SeverityApproval.from_environment(binding) if binding else None
            except AnalyticsContractError:
                value["contract_state"] = "invalid"
            else:
                value["contract_state"] = "not_configured" if binding is None else "pending_validation" if approval is None else "verified"
                if binding and approval:
                    value.update(scope=binding.scope, unit=binding.unit, windows_days=(binding.window_days,),
                                 timezone=binding.timezone, version=approval.version)
        result.append(value)
    return result


def is_chart_widget(widget_id: str) -> bool:
    """Static chart contracts plus the tenant-declared AA charts (`aa_<key>`)."""
    from app.netskope.sse.services.netskope_aa_charts import aa_chart_for_widget
    return widget_id in CHART_WIDGETS or aa_chart_for_widget(widget_id) is not None


def is_known_widget(widget_id: str) -> bool:
    return widget_id in DATA_WIDGETS or is_chart_widget(widget_id)
