---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-09
---

# ADR 002 — Vínculo de personas por correo exacto 1 a 1

## Contexto

La vista de personas necesita reunir los registros de una misma persona en Identity, PAM y Netskope.
No existe un identificador común entre herramientas, y vincular por nombre o por parecido produciría
falsos positivos que el operador leería como identidad confirmada.

## Decisión

Se permite vincular personas entre herramientas por **igualdad exacta de la dirección completa de
correo**, normalizada con `lower(btrim(valor))`, y **sólo 1 a 1**. La única implementación es
`backend/app/cross/services/person_email_matching.py`; ninguna otra consulta reimplementa el
predicado. Si el correo resuelve a más de un objeto activo en cualquier lado, el estado es
`ambiguous` y no se dibuja el vínculo. Del lado PAM sólo cuentan usuarios humanos (allowlist
`user_type IN ('EPVUser', 'ExtUser')`, sin `component_user` y fuera del dominio técnico
`cyberark.cloud.*`).

## Aprobación

2026-09-25.

## Límites

- Nunca por dominio solo, prefijos, similitud ni `ILIKE`.
- La UI lo rotula siempre «vinculado por correo», nunca como identidad confirmada.
- Sólo lectura: no persiste aristas entre fuentes ni alimenta `/api/cmdb/coverage` o KPIs.
- El asiento Standard conserva su propia elegibilidad y sólo reutiliza las primitivas de normalización.

## Cumplimiento

`backend/tests/cross/test_person_email_matching.py` y
`backend/tests/cross/test_person_email_matching_postgres_integration.py` (normalización exacta, rechazo de
correos inválidos, exclusión del dominio técnico y de usuarios no humanos) más
`backend/tests/cross/test_person_view_isolation.py` (la resolución pasa por el helper sancionado, nunca
persiste aristas ni alimenta cobertura o KPIs). Detalle en
[Contratos de integración](../integration-contracts.md#excepciones-sancionadas-entre-fuentes).
