# To Claude: revisión cruzada de la auditoría DS Hub

Fecha: 2026-09-12

## Objetivo

Realizar una segunda revisión independiente y de solo lectura del repositorio DS Hub. No corregir código, no editar migraciones, no ejecutar sincronizaciones contra tenants y no exponer secretos. El entregable esperado es una lista de hallazgos verificables que Codex pueda contrastar e incorporar al informe final `Issues Found`.

## Contexto obligatorio

Antes de revisar, leer completos:

1. `AGENTS.md`.
2. `CLAUDE.md`.
3. `docs/architecture/modularity.md`.
4. `docs/architecture/integration-contracts.md`.
5. `docs/product/ux-decisions.md`.
6. `docs/product/metrics-dictionary.md`.

No leer ni imprimir `.env.local`, `.ca_secret`, `.env.docker`, tokens o configuraciones privadas.

## Estado del intercambio

Claude entregó `TO_CODEX.md` el 2026-09-12 y Codex lo leyó completo. La revisión
cruzada quedó incorporada en `docs/ISSUES_FOUND_2026-09-12.md`.

- Se confirmaron los 17 diagnósticos TypeScript, la falta de lock Python,
  ESLint y los desajustes de `CLAUDE.md`.
- Se aceptó la corrección de Claude sobre los imports Python: son reexports
  deliberados y no se reportan como código muerto.
- La diferencia en `npm run verify` se reprodujo nuevamente en el virtualenv
  de Codex con Python 3.14.4, mientras Claude obtuvo la suite limpia. Con
  `uvloop` explícito, Codex ejecutó 494 tests en 5,683 s. El informe lo trata
  como falta de contrato/fijación del runtime, no como una regresión funcional
  general.
- `TO_CODEX.md` se conserva intacto como evidencia de la segunda revisión.

## Alcance solicitado

Revisar de forma independiente:

- backend FastAPI: autorización, validación, manejo de errores, concurrencia, transacciones, auditoría, rendimiento y límites entre rutas/servicios/repositorios;
- PostgreSQL y migraciones: consistencia del esquema, índices, constraints, queries potencialmente costosas y compatibilidad entre baseline y migraciones numeradas;
- integraciones CyberArk: HTTPS, OAuth, retries, paginación, aislamiento por `source_system`, allowlists y prevención de retiros falsos, sin inventar contratos;
- frontend React/Vite: waterfalls, solicitudes duplicadas, renders innecesarios, código muerto, tipado, bundle y estados loading/empty/error;
- UI/UX: navegación, densidad, consistencia visual, responsive, dark/light mode, microcopy y flujos operativos;
- accesibilidad: teclado, foco, diálogos/popovers, semántica, contraste, targets y live regions;
- seguridad y supply chain: sesiones, CSRF/origin, rate limiting, headers, exportaciones CSV, dependencias y reproducibilidad;
- pruebas y operaciones: cobertura faltante, confiabilidad/tiempo del pipeline, E2E, observabilidad, despliegue y documentación divergente.

## Reglas de producto que no deben confundirse con bugs

- `safe_members` no son usuarios licenciados.
- Frescura de inventario no es rotación de credenciales.
- Las decisiones humanas de workflow no se sobrescriben en una sincronización.
- Sólo una corrida completa y exitosa puede retirar ausentes.
- PAM, Identity Administration, SIA y Access quedan aislados por fuente salvo las excepciones exactas ya sancionadas y documentadas.
- No proponer endpoints, scopes, campos o relaciones CyberArk no confirmados.
- No recomendar refactors sólo por tamaño de archivo.

## Evidencia preliminar que conviene confirmar o refutar

- `npm run verify` no finaliza dentro de 240 segundos en este entorno. La ejecución verbose queda detenida en `BootstrapTokenTests.test_creates_the_administrator`, donde la prueba recorre `hash_password_async`/scrypt real aun con persistencia mockeada.
- TypeScript con `--noUnusedLocals --noUnusedParameters` detecta 17 símbolos/parámetros sin uso, concentrados en `App.tsx`, `safe-table.tsx` y varios componentes/hooks.
- `pyflakes` detecta imports sin uso; algunos pueden ser reexports de compatibilidad, por lo que deben clasificarse con cuidado y no contarse automáticamente como código muerto.
- `requirements.txt` usa rangos amplios y no hay lock/hash de Python visible; evaluar reproducibilidad de builds.
- `CLAUDE.md` todavía describe dos modos de auth (`local`/`oidc`), pero el código y pruebas incluyen `hybrid`; confirmar el alcance del drift documental.
- `frontend/src/styles.css` concentra aproximadamente 4.791 líneas; evaluar duplicación y deuda de tokens/componentes, no proponer split sólo por tamaño.
- No hay configuración visible de ESLint ni regla equivalente en el `verify` actual; evaluar qué defectos deja fuera.
- Auditorías ejecutadas el 2026-09-12: npm raíz y frontend sin vulnerabilidades conocidas; `pip-audit --local` sin vulnerabilidades conocidas; `pip check` sin dependencias rotas.

## Formato de respuesta esperado

Crear o actualizar `TO_CODEX.md` con:

- ID estable por hallazgo (`CLAUDE-001`, etc.);
- severidad (`critical`, `high`, `medium`, `low`);
- confianza (`alta`, `media`, `baja`);
- categoría y capa propietaria;
- archivo y línea exacta;
- evidencia o pasos de reproducción;
- impacto concreto;
- recomendación de parcheo, sin implementar;
- falsos positivos o supuestos descartados;
- verificaciones ejecutadas y sus resultados.

Separar hechos confirmados de recomendaciones y de bloqueos externos. No modificar ningún archivo distinto de `TO_CODEX.md`.

---

## Nueva tarea: consolidación Identidades/SIA

Esta sección reemplaza para la nueva feature la restricción anterior de
auditoría de sólo lectura y habilita únicamente los cambios frontend y tests
enumerados abajo.

El plan senior aprobado para la siguiente feature está en
[`docs/IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md`](docs/IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md).

Antes de implementar, leer el documento completo. El agente tiene asignada la
Fase 1 frontend: integrar Federaciones como cuarta pestaña de Identidades,
reducir switcher/command center a un solo destino Identidades, consumir el
contrato de resolución preparado por Codex y añadir tests unitarios/E2E.

No tocar ingesta, mapping CyberArk, migraciones ni el Hub SIA todavía. No
duplicar componentes existentes. Coordinar archivos y progreso mediante
`TO_CODEX.md` y no hacer commit mientras haya integración concurrente.

## Nueva tarea aprobada: Fase 2 — Hub SIA

La Fase 1 de Identidades/Federaciones ya fue revisada por Codex: `npm run
verify` pasa, los 10 E2E de Identidades pasan y el build es limpio.

Implementar ahora únicamente la Fase 2 del plan senior:

- crear o ampliar el wrapper `SiaHubWorkspace`;
- exponer las pestañas Políticas, Recursos y Cobertura;
- mover Strong Accounts, SIA Resources y Access Assets como secciones
  internas, reutilizando sus componentes existentes;
- incorporar Activos y conexiones como sección Cobertura;
- ocultar esos destinos del selector principal y command center, conservando
  sus rutas y deep links actuales;
- canonicalizar recientes de cualquier subvista SIA a `sia`;
- respetar los permisos estrechos de cada fuente, sin elevar acceso por abrir
  el contenedor SIA;
- añadir pruebas unitarias, E2E, permisos, rutas, navegación y Axe.

No tocar backend, ingesta ni migraciones. No crear relaciones nuevas entre
Access y SIA; reutilizar únicamente las claves ya confirmadas.

Al terminar, ejecutar `npm run verify` y la suite E2E completa. Si ambos gates
pasan, crear el commit de la Fase 2 e informar en `TO_CODEX.md` el hash,
archivos, tests y warnings. No mezclar cambios ajenos a SIA en ese commit.
