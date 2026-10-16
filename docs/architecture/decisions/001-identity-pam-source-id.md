---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-09
---

# ADR 001 — Puente Identity → cadena PAM por `source_id` exacto

## Contexto

Identity Administration, SIA y PAM son herramientas aisladas por `source_system`: ninguna infiere
objetos o relaciones de otra. Aun así, el operador necesita ver a qué Safes llega una persona de
Identity, que es el mismo usuario de CyberArk Identity detrás de una cuenta PAM.

## Decisión

`backend/app/cross/repositories/identity_pam_bridge.py` vincula un usuario `identity_administration`
con uno `cyberark` **sólo** cuando `source_id` es exactamente igual (el UUID de CyberArk Identity).
Nunca por `display_name`, `user_name`, prefijos ni similitud. Luego delega en el recorrido
single-source de `pam_chain_queries.py` (`user_has_role`, `role_grants_access`, `safe_uses_platform`,
`platform_uses_psm`) y se expone en `GET /api/cmdb/identity-users/{object_id}/pam-chain`.

## Aprobación

2026-08-29. El vínculo adicional por correo exacto tiene su propia decisión: [ADR 002](002-person-email-link.md).

## Límites

- Sólo lectura: nunca persiste aristas entre fuentes y no alimenta `/api/cmdb/coverage` ni KPIs.
- `identity_admin_queries.py` permanece estrictamente single-source; SIA queda excluido del puente.
- Los roles de Identity no comparten `source_id` con los de PAM y SIA no expone el UUID de sus
  grantees: para ellos no hay puente (ver [ADR 003](003-person-role-name-access.md)).
- Medición del 2026-09-25: 0 de 77 usuarios de Identity coinciden por UUID (los `source_id` de PAM
  son usernames), por eso en la práctica el vínculo se resuelve por correo. La UI dice «sin
  equivalencia en la cadena PAM» cuando no hay match.

## Cumplimiento

`backend/tests/cross/test_identity_admin_isolation.py` (las consultas de Identity no consultan el
`source_system` PAM ni tablas de la cadena, el recorrido empareja sólo por igualdad exacta de `source_id` y
sólo recorre las aristas verificadas) y `backend/tests/cross/test_tool_module_boundaries.py`
(los imports entre herramientas se limitan a los puentes sancionados). Detalle del contrato en
[Contratos de integración](../integration-contracts.md#excepciones-sancionadas-entre-fuentes).
