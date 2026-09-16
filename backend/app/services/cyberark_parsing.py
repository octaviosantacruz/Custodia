"""Pure validation helpers for CyberArk collection responses."""

from typing import Any


def parse_paged_payload(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], int | None, str]:
    values = payload.get("value")
    if not isinstance(values, list) or not all(isinstance(item, dict) for item in values):
        raise ValueError("La respuesta paginada de CyberArk no contiene value[] válido")

    raw_count = payload.get("count")
    expected_count: int | None = None
    if raw_count is not None:
        try:
            expected_count = int(raw_count)
        except (TypeError, ValueError) as exc:
            raise ValueError("CyberArk devolvió un count no numérico") from exc

    next_link = payload.get("nextLink")
    return values, expected_count, str(next_link) if next_link else ""


def parse_total_collection(
    payload: dict[str, Any],
    *,
    key: str,
    invalid_message: str,
    invalid_total_message: str,
    incomplete_message: str,
) -> tuple[list[dict[str, Any]], int | None]:
    values = payload.get(key)
    if not isinstance(values, list) or not all(isinstance(item, dict) for item in values):
        raise ValueError(invalid_message)

    raw_total = payload.get("Total")
    try:
        expected_count = int(raw_total) if raw_total is not None else None
    except (TypeError, ValueError) as exc:
        raise ValueError(invalid_total_message) from exc
    if expected_count is not None and len(values) != expected_count:
        raise ValueError(incomplete_message.format(expected=expected_count, actual=len(values)))
    return values, expected_count
