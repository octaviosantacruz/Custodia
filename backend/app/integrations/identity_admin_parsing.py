"""Pure validation helpers for Identity Administration collection payloads.

The confirmed contract is SCIM 2.0 (RFC 7644): a ListResponse with
Resources[], totalResults and startIndex-based pagination — not the
value[]/nextLink shape this module assumed before the contract was verified.
"""

from typing import Any


def parse_collection_page(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], int | None]:
    page = payload.get("Resources", [])
    if not isinstance(page, list) or not all(isinstance(item, dict) for item in page):
        raise ValueError("La respuesta no contiene Resources[] de objetos")

    total_results: int | None = None
    if payload.get("totalResults") is not None:
        try:
            total_results = int(payload["totalResults"])
        except (TypeError, ValueError) as exc:
            raise ValueError("La respuesta contiene un totalResults inválido") from exc

    return page, total_results
