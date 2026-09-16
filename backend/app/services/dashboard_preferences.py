DEFAULT_DASHBOARD_WIDGETS = (
    {"widget_id": "safes-by-company", "title": "Safes por empresa", "kind": "chart", "measure": "safes", "chart": {"style": "pie", "group_by": "business_unit"}, "filters": {}, "target_value": None, "target_direction": None, "period_label": None, "baseline_value": None, "size": "sm", "position": 0},
    {"widget_id": "accounts-by-company", "title": "Cuentas por empresa", "kind": "chart", "measure": "accounts", "chart": {"style": "bars", "group_by": "business_unit"}, "filters": {}, "target_value": None, "target_direction": None, "period_label": None, "baseline_value": None, "size": "sm", "position": 1},
    {"widget_id": "safes-by-status", "title": "Safes por estado", "kind": "chart", "measure": "safes", "chart": {"style": "pie", "group_by": "workflow_status"}, "filters": {}, "target_value": None, "target_direction": None, "period_label": None, "baseline_value": None, "size": "sm", "position": 2},
)
