"""Excepción sancionada: vínculo de personas entre herramientas por correo.

Única implementación del predicado aprobado el 2026-09-25: igualdad exacta de
``lower(btrim())`` sobre la dirección completa, 1 a 1, y sólo para usuarios
humanos del lado PAM. Ver "Excepciones sancionadas entre fuentes" (punto 2) en ``docs/architecture/integration-contracts.md``.

Tiene dos capas:

- **primitivas** (``normalize_person_email``, ``person_email_sql``,
  ``resolve_unique``) para cualquier match exacto por correo;
- **elegibilidad de persona** (``PAM_HUMAN_USER_TYPES``,
  ``pam_human_user_sql``, ``is_pam_human_user``) sólo para el vínculo de
  personas entre herramientas.

Sólo lectura: el vínculo nunca se persiste como arista ni alimenta
``/api/cmdb/coverage`` o KPIs existentes. Excepción acotada aprobada para
CONN-001/v1: el nuevo resumen Identity + Netskope usa estas mismas primitivas
de normalización/1-a-1 con conjunción de ambos permisos; no amplía este helper
ni habilita otros consumidores de cobertura.
"""

import re
from collections.abc import Iterable, Mapping
from typing import Any

PAM_HUMAN_USER_TYPES = frozenset({"EPVUser", "ExtUser"})
EXCLUDED_EMAIL_DOMAIN_PATTERNS = ("cyberark.cloud.",)
# Espejo SQL de normalize_person_email: un único @, local y dominio no vacíos
# y al menos un punto con texto a ambos lados.
PERSON_EMAIL_SHAPE_SQL = r"'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'"
# Espejo Python del fragmento SQL: un dominio suelto ("ada@.", "ada@.com") no
# es una dirección utilizable y el gemelo SQL tampoco lo acepta.
_PERSON_EMAIL_SHAPE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


def normalize_person_email(value: str | None) -> str | None:
    """Devuelve ``lower(btrim(value))`` si es una dirección utilizable.

    Exige exactamente un ``@``, parte local y dominio no vacíos y un punto con
    texto a ambos lados (``ada@.`` o ``ada@.com`` no son direcciones).
    Cualquier otra cosa (prefijos, texto libre, dominios sueltos) devuelve
    ``None``: nunca se normaliza "lo más parecido".
    """
    if value is None:
        return None
    normalized = value.strip().lower()
    if _PERSON_EMAIL_SHAPE.fullmatch(normalized) is None:
        return None
    return normalized


def person_email_sql(expression: str) -> str:
    """Expresión SQL normalizada; única forma permitida de comparar correos."""
    return f"lower(btrim({expression}))"


def person_email_domain_exclusion_sql(expression: str) -> str:
    """Fragmento SQL que excluye el dominio técnico del tenant.

    Se aplica al vínculo de personas (y a la vista por persona): un correo
    ``cyberark.cloud.*`` es una identidad de servicio, nunca una persona.
    """
    domain = f"split_part({person_email_sql(expression)}, '@', 2)"
    return " AND ".join(
        f"{domain} <> '{pattern.rstrip('.')}' AND {domain} NOT LIKE '{pattern}%%'"
        for pattern in EXCLUDED_EMAIL_DOMAIN_PATTERNS
    )


def is_excluded_person_email_domain(value: str | None) -> bool:
    """True para el dominio técnico del tenant (``cyberark.cloud.*``)."""
    normalized = normalize_person_email(value)
    if normalized is None:
        return False
    domain = normalized.partition("@")[2]
    return any(
        domain == pattern.rstrip(".") or domain.startswith(pattern)
        for pattern in EXCLUDED_EMAIL_DOMAIN_PATTERNS
    )


def pam_human_user_sql(user_alias: str = "u") -> str:
    """Fragmento SQL de elegibilidad de persona, sólo con las constantes.

    Se aplica únicamente al vínculo de personas entre herramientas. El asiento
    Standard conserva su propio predicado (``standard_seat_sql``).
    """
    allowed = ", ".join(f"'{value}'" for value in sorted(PAM_HUMAN_USER_TYPES))
    email = person_email_sql(f"{user_alias}.source_id")
    # psycopg uses client-side binding, so a literal percent sign in SQL must
    # be written as %% (the same convention the repositories use for ILIKE).
    exclusions = person_email_domain_exclusion_sql(f"{user_alias}.source_id")
    return (
        f"({user_alias}.attributes->>'user_type' IN ({allowed})"
        f" AND coalesce({user_alias}.attributes->>'component_user', 'false') <> 'true'"
        f" AND {email} ~ {PERSON_EMAIL_SHAPE_SQL}"
        f" AND {exclusions})"
    )


def is_pam_human_user(source_id: str | None, attributes: Mapping[str, Any] | None = None) -> bool:
    """Gemelo Python de ``pam_human_user_sql`` para callers en memoria."""
    attrs = attributes or {}
    if str(attrs.get("user_type") or "") not in PAM_HUMAN_USER_TYPES:
        return False
    if str(attrs.get("component_user") or "false").strip().lower() == "true":
        return False
    if normalize_person_email(source_id) is None:
        return False
    return not is_excluded_person_email_domain(source_id)


def resolve_unique(candidates: Iterable[Any]) -> dict[str, Any]:
    """Regla 1 a 1 de un lado; el caller la aplica a los dos lados.

    Devuelve ``{"status": "matched"|"ambiguous"|"unmatched", "match": ...}``.
    Un lado con más de un candidato es ``ambiguous`` y nunca dibuja vínculo.
    """
    items = list(candidates)
    if len(items) == 1:
        return {"status": "matched", "match": items[0]}
    if len(items) > 1:
        return {"status": "ambiguous", "match": None}
    return {"status": "unmatched", "match": None}
