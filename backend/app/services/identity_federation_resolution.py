"""Business-owned resolution of the expected Okta federation.

This is deliberately separate from CyberArk's inventory relationships: the
tenant contract does not provide a user-to-federation edge. The product rule
maps a normalized email domain to an expected federation and reports the
basis explicitly in the response.
"""

import re
from typing import Any, Literal, TypedDict


FederationStatus = Literal[
    "matched", "missing_federation", "unsupported_domain", "missing_email", "ambiguous"
]


class FederationResolution(TypedDict):
    status: FederationStatus
    match_basis: Literal["email_domain_rule"]
    email_domain: str | None
    federation_code: str | None
    expected_name: str | None
    object_id: int | None
    source_id: str | None
    display_name: str | None
    active: bool | None


_DOMAIN_RULES: dict[str, tuple[str, str, frozenset[str]]] = {
    "ueno.com.py": ("okta_ueno", "Okta Ueno", frozenset({"okta ueno", "ueno"})),
    "itti.digital": ("okta_itti", "Okta ITTI", frozenset({"okta itti", "itti"})),
    "upay.com.py": ("okta_upay", "Okta UPAY", frozenset({"okta upay", "upay"})),
}
_EMAIL_RE = re.compile(r"^[^@\s]+@([^@\s]+)$")


def _normalize_name(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").strip().lower()).strip()


def _empty(status: FederationStatus, domain: str | None = None, *, code: str | None = None, expected: str | None = None) -> FederationResolution:
    return {
        "status": status,
        "match_basis": "email_domain_rule",
        "email_domain": domain,
        "federation_code": code,
        "expected_name": expected,
        "object_id": None,
        "source_id": None,
        "display_name": None,
        "active": None,
    }


def resolve_expected_federation(email: str | None, federations: list[dict[str, Any]]) -> FederationResolution:
    """Resolve the approved exact-domain rule against active catalog rows."""
    match = _EMAIL_RE.fullmatch((email or "").strip().lower())
    if not match:
        return _empty("missing_email") if not (email or "").strip() else _empty("unsupported_domain")
    domain = match.group(1)
    rule = _DOMAIN_RULES.get(domain)
    if rule is None:
        return _empty("unsupported_domain", domain)

    code, expected_name, aliases = rule
    candidates = [
        federation for federation in federations
        if federation.get("active") is True
        and _normalize_name(federation.get("display_name")) in aliases
    ]
    if len(candidates) != 1:
        return _empty("ambiguous" if len(candidates) > 1 else "missing_federation", domain, code=code, expected=expected_name)

    federation = candidates[0]
    return {
        "status": "matched",
        "match_basis": "email_domain_rule",
        "email_domain": domain,
        "federation_code": code,
        "expected_name": expected_name,
        "object_id": federation.get("object_id"),
        "source_id": federation.get("source_id"),
        "display_name": federation.get("display_name"),
        "active": True,
    }


def resolve_users_federations(users: list[dict[str, Any]], federations: list[dict[str, Any]]) -> None:
    """Enrich rows in place using one already-loaded federation catalog."""
    for user in users:
        attributes = user.get("attributes") or {}
        user["federation_resolution"] = resolve_expected_federation(attributes.get("email"), federations)
