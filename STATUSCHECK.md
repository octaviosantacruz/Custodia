# STATUSCHECK.md — DSHub

_Auditoría: 2026-09-21 — actualizado 2026-09-21_

## ⏸️ Pausado — cambio de rumbo
El objetivo dejó de ser producción. La idea ahora es convertir DSHub en una **demo de portfolio con data falsa/sintética**, para que se pueda mostrar funcionando sin datos reales de ningún tenant. El trabajo en este proyecto queda pausado mientras se avanza en otros; se retoma más adelante con foco en:
- Sembrar datos fake (safes, users, roles, platforms, accounts) en vez de depender de una sincronización real con CyberArk.
- Pulir la presentación para que se vea bien como pieza de portfolio (sin necesariamente perseguir robustez de producción).
- Ir actualizando este documento a medida que se avance, sin mezclar tareas de "producción" con las de demo.

**Nota de tensión a resolver más adelante**: `CLAUDE.md` dice explícitamente "It is not a generic demo, spreadsheet replacement, or graph experiment" — eso quedó desalineado con la nueva dirección. Cuando se retome el proyecto, vale la pena decidir si se actualiza `CLAUDE.md` para reflejar el objetivo real (demo) o si se mantiene la disciplina de datos "como si fuera prod" pero servida como demo hacia afuera.

## Qué es
CMDB operativa para inventario y gobierno de acceso privilegiado (CyberArk PAM, Identity Administration, SIA, Access space). Backend FastAPI + PostgreSQL, frontend React/Vite. (Documentado originalmente como herramienta operativa real — ver nota de tensión arriba.)

## Estado actual
- **Corre localmente**: sí. Backend en `:8000` (uvicorn --reload), frontend en `:5173` (vite). `npm run web` levanta ambos.
- **Base de datos**: PostgreSQL nativo, puerto 5433, base `dshub_local`, rol dedicado `dshub_local` (sin superusuario). Antes vivía dentro de un contenedor Docker compartido (`cmdb-postgres`, puerto 5432) que pertenecía a otro proyecto (`~/cmdb-cyberark`) y exponía un rol superusuario (`cmdb_ingest`) con acceso a todas las bases del servidor — se migró para lograr aislamiento real. Migración de datos vía `pg_dump`/`pg_restore`, verificada: 29 tablas, 49 migraciones aplicadas (coincide con `migrations/049_activate_netskope_dlp.sql`, la última del repo).
- **Datos**: base de dev vacía (0 filas en `safes`); no hay una sincronización real corrida todavía.
- Auth local (`AUTH_MODE=local`), `ALLOW_SELF_REGISTER_SETUP=true` para este entorno.

## Hallazgos
- Ninguna vulnerabilidad de código detectada en esta pasada (no se revisó línea por línea, foco fue infraestructura).
- El viejo contenedor `cmdb-postgres` (apache/age, puerto 5432) sigue corriendo y en uso por otro proyecto (`accessgraph`) — no se tocó, pero vale la pena confirmar que nada más siga apuntando ahí con credenciales viejas.
- `EXPOSE_API_DOCS=false` en local — `/docs` no está disponible; usar `/api/health` y endpoints directos para probar.

## Pendientes / próximos pasos
- No se corrió `npm run verify` ni la suite de tests en esta sesión — recomendable antes de dar por buena la migración de base.
- Si se agregan más entornos que usaban `cmdb-postgres`, revisar si dependen del rol superusuario `cmdb_ingest` antes de deprecar ese contenedor.
- ~~Correr una sincronización real (CyberArk) para validar el pipeline de principio a fin~~ — ya no aplica: el plan es data fake, no ingesta real.
- **Nuevo pendiente (portfolio demo)**: diseñar un seed de datos fake (safes, users, roles, platforms, PSMs, accounts) que reemplace la sincronización real para el entorno de demo.
- **Nuevo pendiente**: decidir cómo se presenta/despliega la demo en el portfolio (¿instancia siempre corriendo? ¿capturas/video? ¿deploy efímero?).
