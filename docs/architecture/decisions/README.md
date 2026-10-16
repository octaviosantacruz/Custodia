---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-09
---

# Decisiones sancionadas (ADR)

Decisiones de producto o de datos que **limitan** lo que el código puede hacer y que se
aprobaron de forma explícita. Cada ADR dice qué se decidió, cuándo se aprobó, hasta dónde
llega y qué test la hace cumplir. Un cambio de comportamiento que las contradiga necesita
una aprobación nueva, registrada aquí, y no sólo un cambio de código.

| ADR | Decisión | Aprobada | Test que la hace cumplir |
|---|---|---|---|
| [001](001-identity-pam-source-id.md) | Puente Identity → cadena PAM por `source_id` exacto | 2026-08-29 | `backend/tests/cross/test_identity_admin_isolation.py` |
| [002](002-person-email-link.md) | Vínculo de personas por correo exacto 1 a 1 | 2026-09-25 | `backend/tests/cross/test_person_email_matching.py` |
| [003](003-person-role-name-access.md) | Acceso por rol Identity ↔ PAM por nombre exacto único | 2026-10-05 | `backend/tests/cross/test_person_role_access_isolation.py` |
| [004](004-retention-hold.md) | `retention_hold`: única excepción a la intangibilidad del flujo humano | 2026-10-06 | `backend/tests/cyberark/pam/test_account_retirement_postgres_integration.py` |
| [005](005-no-rotation-kpis.md) | No deducir KPIs de rotación de credenciales | 2026-10-03 (lista mínima, `CPM-001`) | `backend/tests/cyberark/pam/test_pam_account_mapping.py` |

Formato: contexto, decisión, aprobación, límites y cumplimiento. Numerar en orden y no reescribir
una decisión vigente: reemplazarla con un ADR nuevo que la referencie.
