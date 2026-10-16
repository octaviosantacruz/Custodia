---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-09
---

# ADR 003 — Acceso por rol Identity ↔ PAM por nombre exacto único

## Contexto

Cuando una persona no tiene usuario PAM propio, sus roles de Identity pueden darle acceso a Safes
a través de un rol PAM del mismo nombre. No hay un identificador común (Identity usa UUID y PAM ids
numéricos) y SIA nombra a quién da acceso por `granted_users` y `granted_roles` porque no tiene
objeto de usuario.

## Decisión

La vista de personas cuenta los Safes alcanzados por esa vía cuando el `display_name` del rol
Identity es **exactamente igual y único en ambos lados**; un nombre repetido en cualquiera cuenta
como ambiguo y nunca suma. Se implementa sólo en `backend/app/cross/repositories/person_role_access.py`,
usado únicamente por la vista de personas. La extensión a SIA aplica la misma regla: una política
alcanza a la persona cuando una entrada de `granted_users` es exactamente su `user_name` de Identity
(único entre usuarios activos) o el de su usuario PAM vinculado por correo, o cuando una entrada de
`granted_roles` es exactamente uno de sus roles de Identity con nombre único; `granted_groups` no
participa (`sia_access_for_person`).

## Aprobación

2026-10-05 (`CONN-SPACE-001`), con la extensión a SIA aprobada el mismo día.

## Límites

- Es una referencia por nombre, no un vínculo confirmado: la UI lo rotula como acceso por rol.
- Requiere poder leer PAM e Identity (y `sia:catalogs_read` para SIA); no corre para un usuario PAM ambiguo.
- No persiste aristas ni alimenta KPIs. No hay dato de ZSP por persona.

## Cumplimiento

`backend/tests/cross/test_person_role_access_isolation.py` y
`backend/tests/cross/test_person_role_access_postgres_integration.py`. Detalle en
[Contratos de integración](../integration-contracts.md#excepciones-sancionadas-entre-fuentes).
