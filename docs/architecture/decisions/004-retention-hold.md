---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-09
---

# ADR 004 — `retention_hold`: única excepción a la intangibilidad del flujo humano

## Contexto

La clasificación humana de un Safe (responsable, unidad, estado del flujo, próxima acción, alcance y
calidad) es independiente de lo que informa CyberArk: una sincronización nunca la sobrescribe. Cuando
una cuenta de un Safe marcado «Dar de baja» desaparece, CyberArk conserva la cuenta eliminada durante
la retención del Safe, y la acción pendiente ya no refleja el estado real.

## Decisión

Cuando una sincronización **completa** retira una cuenta de un Safe cuya próxima acción humana es «Dar
de baja» y cuyo estado sigue en `pending`, `in_progress` o `blocked`, se mueve **sólo**
`workflow_status` a `retention_hold` («Baja retenida»). Lo implementa
`_hold_decommissions_for_deleted_accounts` en `backend/app/cyberark/pam/services/pam_accounts.py` y se
audita como `system:sync` en la misma transacción. Todo otro Safe conserva lo que fijó una persona.

## Aprobación

2026-10-06.

## Límites

- Sólo `workflow_status`; ningún otro campo humano se toca.
- Sólo tras una corrida completa y exitosa: una respuesta parcial o un fallo de red no retira cuentas.
- Nunca se borra físicamente durante la ingesta.

## Cumplimiento

`backend/tests/cyberark/pam/test_account_retirement_postgres_integration.py` (la cuenta retirada fija
`retired_at` y mueve sólo la baja abierta) y `backend/tests/cyberark/pam/test_safe_mutations.py`
(`retention_hold` es un estado válido que conserva la acción; un estado desconocido se rechaza).
