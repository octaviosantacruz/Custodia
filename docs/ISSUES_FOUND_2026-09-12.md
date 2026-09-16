# Issues Found — auditoría integral de DS Hub

**Fecha:** 2026-09-12

**Commit auditado:** `ad6aff1bf25d776a20b2bad2b27fefe6855e9d5f` (`main`)

**Modalidad:** revisión y reporte solamente; no se modificó código ni se ejecutaron sincronizaciones contra tenants.

**Revisión cruzada:** Codex + Claude mediante `TO_CLAUDE.md` y `TO_CODEX.md`.

## Resumen ejecutivo

La base del producto es sólida: el aislamiento entre fuentes está explícito, la ingesta usa una cola durable con leases, los permisos se controlan en backend, las exportaciones CSV neutralizan fórmulas, las integraciones limitan hosts y usan HTTPS, y las suites existentes tienen buena amplitud. Las auditorías de dependencias no encontraron vulnerabilidades conocidas.

Antes de cualquier parche existe además una acción operativa crítica: Claude
reportó en `TO_CODEX.md` que un secreto OIDC fue expuesto accidentalmente en el
chat durante una sesión anterior. Este informe no leyó ni reproduce el valor.
Hasta confirmar su revocación/rotación debe tratarse como una credencial
comprometida.

Después de contener ese incidente, conviene resolver dos riesgos altos:

1. el rate limiter puede acumular filas y direcciones de email indefinidamente a partir de tráfico público de alta cardinalidad;
2. el modelo de administración no preserva de forma atómica la existencia de al menos un usuario activo con `access:manage`, por lo que operaciones concurrentes o cambios de roles custom pueden bloquear toda la administración.

Se registran **22 hallazgos**: **1 crítico operativo, 2 altos, 12 medios y 7 bajos**. No se confirmó ninguna vulnerabilidad conocida en paquetes instalados.

| ID | Prioridad | Área | Resumen |
|---|---|---|---|
| IF-000 | Crítica | Incidente / secretos | Rotación de secreto OIDC expuesto sin confirmar |
| IF-001 | Alta | Seguridad / backend / DB | Rate limiter con cardinalidad y retención ilimitadas |
| IF-002 | Alta | Autorización / backend / DB | No se preserva el último administrador efectivo |
| IF-003 | Media | Backend / transacciones | `PATCH` de usuario no es atómico y acepta un parche vacío |
| IF-004 | Media | Seguridad / auditoría | Auditoría de roles no conserva permisos o niveles anteriores |
| IF-005 | Media | Backend / pruebas | Runtime Python no fijado; bloqueo reproducible con 3.14.4 |
| IF-006 | Media | DB / pruebas | No hay pruebas contra PostgreSQL real en el repositorio |
| IF-007 | Media | Calidad / CI | El gate local omite E2E, lint y auditorías; no hay CI versionado |
| IF-008 | Media | UI / accesibilidad | Contraste insuficiente en el selector de login híbrido |
| IF-009 | Media | UX / autenticación | Timeout visual de inactividad desacoplado del backend |
| IF-010 | Media | Backend / rendimiento | Filtro SIA calcula y pagina todo el conjunto en memoria |
| IF-011 | Media | Frontend / rendimiento | CSS global grande y chunk de gráficos por encima del umbral |
| IF-012 | Media | Operaciones | Runbook de despliegue contiene comandos para archivos inexistentes |
| IF-013 | Media | Documentación / auth | `CLAUDE.md` no refleja `hybrid` ni el RBAC actual |
| IF-014 | Media | Supply chain | Dependencias Python sin lockfile ni hashes |
| IF-015 | Baja | Código muerto / frontend | 17 símbolos sin uso y ausencia de ESLint |
| IF-016 | Baja | UX / accesibilidad | Errores y avisos desaparecen sin control del usuario |
| IF-017 | Baja | Operaciones | Un solo health check mezcla liveness y readiness |
| IF-018 | Baja | API / UX | `Retry-After` no representa el tiempo restante real |
| IF-019 | Baja | React / rendimiento | Valores de contexto y comandos se recrean en cada render |
| IF-020 | Baja | Pruebas UI | Matriz E2E limitada en navegador, tema y cobertura Axe |
| IF-021 | Baja | Backend / mantenibilidad | Detección de duplicados depende del texto de la excepción |

## Hallazgos detallados

### IF-000 — Rotación de secreto OIDC expuesto sin confirmar

- **Severidad:** crítica mientras no se confirme la rotación
- **Confianza:** alta sobre el reporte de exposición; no se inspeccionó el secreto ni su estado actual
- **Capa propietaria:** operación de identidad, gestión de secretos e incident response
- **Evidencia:** `TO_CODEX.md` declara que dos comandos de una sesión anterior expusieron accidentalmente `OIDC_CLIENT_SECRET` en el chat y que ya se recomendó rotarlo. El valor no aparece en este documento y Codex no abrió `.env.local`.
- **Impacto:** si la credencial sigue activa, debe considerarse comprometida aunque el repositorio esté limpio. Un parche de código no revoca una credencial ya observada.
- **Acción requerida:** rotar/revocar el secreto en el proveedor, actualizar el secret store autorizado, invalidar el valor anterior, revisar logs de uso desde el momento de exposición y registrar la evidencia de cierre. No pegar el nuevo valor en chat, commits o documentos.
- **Criterio de aceptación:** el proveedor confirma que el secreto anterior ya no autentica y el nuevo valor está sólo en el almacén autorizado. Esta acción es externa al código y no fue ejecutada durante la auditoría.

### IF-001 — Rate limiter con cardinalidad y retención ilimitadas

- **Severidad:** alta
- **Confianza:** alta
- **Capa propietaria:** backend, seguridad y PostgreSQL
- **Evidencia:**
  - `backend/app/api/routes/auth_session.py:70-75` crea buckets por IP y por el email suministrado en cada login.
  - `backend/app/api/routes/auth_models.py:8-14` limita longitud, pero `LocalLogin.email` no exige un email válido; cualquier cadena distinta de hasta 320 caracteres sirve como bucket.
  - `backend/app/services/rate_limit_enforcement.py:31-39` reserva todos los buckets en paralelo antes de decidir el `429`. Incluso si la IP ya está bloqueada, un email nuevo genera otra reserva.
  - `backend/app/repositories/rate_limiting.py:22-49` sólo hace `UPSERT`; `:52-56` borra la fila únicamente después de un acceso exitoso.
  - `migrations/046_rate_limit_attempts.sql:10-14` no define expiración ni mecanismo de purga.
- **Impacto:** un cliente no autenticado puede enviar intentos con emails siempre distintos y hacer crecer `rate_limit_attempts` sin límite. Además, los emails intentados quedan almacenados en texto claro indefinidamente si nunca hay un login exitoso, creando retención de PII no documentada.
- **Recomendación de parcheo:** usar claves opacas/HMAC para la dimensión email, agregar retención de filas vencidas con una política comprobable y evitar crear buckets secundarios cuando el bucket primario ya está bloqueado. Mantener la reserva atómica por bucket y agregar una prueba de alta cardinalidad.
- **Criterio de aceptación:** después de tráfico con emails únicos, el tamaño de la tabla queda acotado; no se persisten emails en claro; la prueba concurrente existente sigue permitiendo exactamente el máximo configurado.

### IF-002 — No se preserva el último administrador efectivo

- **Severidad:** alta
- **Confianza:** alta
- **Capa propietaria:** backend, autorización y PostgreSQL
- **Evidencia:**
  - `backend/app/api/routes/users.py:59-62` sólo impide que el actor se quite a sí mismo `access:manage`.
  - `backend/app/repositories/user_admin.py:194-202` reemplaza roles sin comprobar cuántos usuarios activos conservarán el permiso efectivo.
  - `backend/app/repositories/user_admin.py:206-237` comprueba el último administrador al borrar, pero no serializa esa cuenta con un advisory lock; dos administradores pueden operar sobre filas objetivo distintas usando snapshots concurrentes.
  - `backend/app/repositories/access_control.py:197-251` y `:348-391` permiten cambiar permisos/niveles de roles custom sin comprobar si ese cambio elimina el último `access:manage` efectivo.
- **Impacto:** dos administradores podrían degradarse o eliminarse mutuamente, o el último administrador con un rol custom podría editar ese rol y dejar el sistema sin ninguna identidad capaz de administrar accesos.
- **Recomendación de parcheo:** definir una sola invariante transaccional: debe existir al menos un `access_user` activo cuyo conjunto efectivo incluya `access:manage`. Serializar todas las mutaciones que puedan afectarla —usuario, asignación y definición de rol— con el mismo advisory lock y validarla antes del commit.
- **Criterio de aceptación:** pruebas PostgreSQL concurrentes demuestran que no pueden confirmar dos operaciones cuyo resultado combinado deja cero administradores efectivos.

### IF-003 — Actualización de usuario no atómica y parche vacío ambiguo

- **Severidad:** media
- **Confianza:** alta
- **Capa propietaria:** backend y contrato API
- **Evidencia:**
  - `backend/app/repositories/user_admin.py:171-193` confirma nombre/estado/password en una transacción.
  - `backend/app/repositories/user_admin.py:194-202` abre una segunda conexión y transacción para el rol.
  - `backend/app/api/routes/users.py:22-26` deja todos los campos opcionales; `UserUpdate.model_validate({})` produce cuatro valores `None`.
  - `backend/app/repositories/user_admin.py:203` devuelve `True` aunque no haya ejecutado ninguna consulta. Por ello, `{}` puede responder `updated: true` incluso para un ID inexistente.
- **Impacto:** un fallo al asignar el rol puede dejar confirmada la primera mitad de la petición aunque la respuesta sea error. Un parche vacío reporta éxito falso y debilita el contrato de idempotencia/auditoría.
- **Recomendación de parcheo:** ejecutar toda la mutación y sus eventos de auditoría en una única transacción/conexión, bloquear el usuario una sola vez y rechazar payloads sin campos con `422` o `400`.
- **Criterio de aceptación:** una falla inducida en el cambio de rol revierte también los cambios de perfil; `{}` nunca devuelve éxito; el `404` funciona con y sin cambio de rol.

### IF-004 — Auditoría incompleta de cambios de roles

- **Severidad:** media
- **Confianza:** alta
- **Capa propietaria:** backend, auditoría y seguridad
- **Evidencia:**
  - `backend/app/repositories/access_control.py:210-212` captura `to_jsonb(access_roles)` antes de cambiar un rol directo, pero esa fila no contiene `access_role_permissions`.
  - `backend/app/repositories/access_control.py:242-250` incluye los permisos nuevos sólo en `after_data`.
  - `backend/app/repositories/access_control.py:360-362` tiene el mismo patrón para un rol compuesto: el JSON anterior no contiene sus filas de `access_custom_role_levels`.
  - `backend/app/repositories/access_control.py:382-390` incluye `level_refs` únicamente después del cambio.
- **Impacto:** el log no permite reconstruir qué permisos o niveles fueron removidos. En un producto de gobierno de accesos, la trazabilidad del “antes” es parte del control, no sólo observabilidad.
- **Recomendación de parcheo:** leer permisos/niveles anteriores dentro del mismo lock y agregarlos a `before_data`; verificar por test que un cambio deja before/after simétricos y que el audit comparte la transacción.

### IF-005 — Runtime Python no fijado e incompatibilidad reproducible en 3.14.4

- **Severidad:** media
- **Confianza:** alta sobre la discrepancia; media sobre el alcance fuera de este host
- **Capa propietaria:** backend, plataforma y verificación
- **Evidencia:**
  - No existe `.python-version`, `runtime.txt` ni restricción `requires-python`.
  - En el virtualenv de este workspace (`Python 3.14.4`), `BootstrapTokenTests.test_creates_the_administrator` no terminó dentro de 45 segundos. El bloqueo ocurre al ejecutar `hashlib.scrypt` mediante el `ThreadPoolExecutor` dedicado de `backend/app/services/password_hashing.py:56-71` sobre el event loop por defecto.
  - La suite completa, instalando explícitamente `uvloop`, pasó: **494 tests en 5,683 s**.
  - Claude ejecutó la misma suite en su contexto y obtuvo **494 tests en ~7 s** y `npm run verify` completo en **19,27 s**.
- **Impacto:** `npm run verify` no es reproducible entre runtimes admitidos implícitamente. Una plataforma sin `uvloop` o un upgrade accidental de Python puede bloquear bootstrap/password hashing y el gate local.
- **Recomendación de parcheo:** declarar y probar versiones Python soportadas, fijar el runtime de desarrollo/CI y añadir una prueba con timeout para `hash_password_async`/`verify_password_async` usando el loop soportado. Investigar 3.14 antes de declararlo compatible; no ocultar el problema instalando `uvloop` sólo en tests.
- **Criterio de aceptación:** `npm run verify` termina con el runtime documentado y una matriz mínima evita aceptar versiones incompatibles.

### IF-006 — No hay pruebas contra PostgreSQL real

- **Severidad:** media
- **Confianza:** alta
- **Capa propietaria:** backend, DB y pruebas
- **Evidencia:** 62 archivos de tests backend usan dobles, `AsyncMock`, inspección de strings SQL o transporte ASGI simulado. No se encontró apertura de `AsyncConnectionPool`/`psycopg.connect` hacia una base de prueba. Los `DATABASE_URL` presentes son valores ficticios y no se conectan.
- **Impacto:** 46 migraciones y queries con CTE, JSONB, locks, `SKIP LOCKED`, constraints y concurrencia pueden pasar la suite aunque PostgreSQL rechace su sintaxis o su semántica sea distinta a la del fake. IF-002 necesita precisamente una prueba de concurrencia real.
- **Recomendación de parcheo:** agregar una suite de integración efímera que aplique todas las migraciones desde cero y pruebe al menos auth/RBAC, auditoría transaccional, cola/leases, reconciliación y rate limiting concurrente.
- **Criterio de aceptación:** creación limpia desde las 46 migraciones, rollback real ante errores y pruebas concurrentes ejecutadas por el gate automatizado.

### IF-007 — Gate incompleto y ausencia de CI versionado

- **Severidad:** media
- **Confianza:** alta para el repositorio; puede existir CI externo no versionado
- **Capa propietaria:** calidad y entrega
- **Evidencia:**
  - `scripts/verify.sh:12-39` compila Python, corre unit tests backend/frontend, hace build y `git diff --check`.
  - No ejecuta los 76 E2E, `pip-audit`, `npm audit`, unused checks ni un linter.
  - No se encontró `.github/workflows`, `.gitlab-ci.yml`, `Jenkinsfile` ni `azure-pipelines.yml`.
- **Impacto:** los checks de mayor valor pueden depender de una ejecución manual. El contraste de IF-008 pasó por esta brecha: la prueba Axe existente no cubría el modo híbrido.
- **Recomendación de parcheo:** crear un pipeline versionado por etapas: unit/build rápido; PostgreSQL integration; E2E/Axe; supply chain. Mantener tiempos y artefactos visibles y fijar versiones de Node/Python.

### IF-008 — Contraste insuficiente en el selector de login híbrido

- **Severidad:** media
- **Confianza:** alta
- **Capa propietaria:** frontend, UI y accesibilidad
- **Evidencia reproducible:** prueba Axe WCAG 2A/2AA/21AA con `/api/auth/status` simulado en modo `hybrid`, tanto a `1440x900` como a `390x844`: **1 regla, 3 nodos**.
  - texto pequeño activo “Email y contraseña”: ratio **3,97:1** (`#6f7479` sobre `#111214`), mínimo 4,5:1;
  - “Okta corporativo” y “Inicio con OIDC”: ratio **3,61:1** (`#6f7479` sobre `#1b1c1e`), mínimo 4,5:1.
  - Fuente: `frontend/src/styles.css:22` y `:1851-1859`.
- **Impacto:** el método de autenticación es menos legible para usuarios con baja visión y falla WCAG AA para texto normal.
- **Recomendación de parcheo:** introducir un token muted que alcance AA en esas superficies o usar `--text-secondary`; añadir Axe para login `hybrid` en desktop y mobile, activo e inactivo.

### IF-009 — Timeout visual de inactividad desacoplado del backend

- **Severidad:** media
- **Confianza:** alta
- **Capa propietaria:** frontend, backend y UX de sesión
- **Evidencia:**
  - `frontend/src/hooks/use-auth.ts:6` fija 15 minutos en código.
  - `backend/app/config.py:51-58` hace configurable `SESSION_IDLE_TIMEOUT_SECONDS`, acepta valores desde 5 minutos y exige que sean menores al máximo.
  - `backend/app/main.py:89-90` entrega ese valor sólo al backend; el status de auth no lo devuelve al cliente.
- **Impacto:** con una configuración distinta de 900 s, el frontend puede mostrar una sesión activa que el servidor ya venció, o cerrar localmente antes de la política real. La experiencia y el mensaje de seguridad dejan de corresponder al control efectivo.
- **Recomendación de parcheo:** exponer metadatos no sensibles de expiración en el status/session y derivar el temporizador del contrato del servidor; probar valores no predeterminados.

### IF-010 — Filtro de vinculación SIA no escala con el inventario

- **Severidad:** media
- **Confianza:** alta
- **Capa propietaria:** backend y PostgreSQL
- **Evidencia:** `backend/app/repositories/sia_queries.py:81-93` elimina `LIMIT/OFFSET` cuando existe `linkage_status`, trae todas las políticas y todos sus IPs; `:94-115` arma links en Python, filtra y recién después pagina.
- **Impacto:** tiempo, memoria y tamaño de parámetros crecen con todo el inventario aunque el usuario solicite una página de 50 elementos. Las búsquedas con vínculo son el peor caso y pueden degradar simultáneamente API y DB.
- **Recomendación de parcheo:** materializar/normalizar IPs vinculables o expresar la existencia/cantidad de matches en SQL para filtrar y paginar antes de traer detalle. Mantener la regla de match exacto y no inventar relaciones.
- **Criterio de aceptación:** el trabajo por request queda acotado por página y un plan `EXPLAIN (ANALYZE, BUFFERS)` confirma índices útiles con un volumen representativo.

### IF-011 — Peso global de CSS y chunk de gráficos

- **Severidad:** media
- **Confianza:** alta sobre tamaños; media sobre impacto real sin red de producción
- **Capa propietaria:** frontend y rendimiento
- **Evidencia de build:**
  - JS principal: **417,52 kB** minificado / **118,99 kB gzip**.
  - CSS principal: **206,54 kB** minificado / **33,85 kB gzip**.
  - motor avanzado de gráficos: **587,92 kB** / **197,21 kB gzip**; Vite avisa que supera 500 kB.
  - `frontend/src/styles.css` tiene 4.791 líneas y se carga también en login.
- **Impacto:** parseo/evaluación y CSS global innecesarios en la ruta de autenticación y en dispositivos modestos. El motor ECharts está correctamente lazy-loaded, por lo que su costo afecta principalmente al flujo que lo usa, no al primer paint.
- **Recomendación de parcheo:** medir cobertura CSS por ruta, retirar reglas huérfanas demostradas, separar estilos críticos de auth/shell sólo si la medición lo justifica y revisar qué módulos de ECharts incluye el chunk. No dividir por cantidad de líneas ni degradar la coherencia del sistema visual.

### IF-012 — Runbook de despliegue ejecuta artefactos inexistentes

- **Severidad:** media
- **Confianza:** alta
- **Capa propietaria:** operaciones y documentación
- **Evidencia:** `docs/operations/deployment.md:3-8` dice que ambos Dockerfiles fueron eliminados y Docker está pospuesto; `:25-36` inmediatamente ordena construir `backend/Dockerfile` y `frontend/Dockerfile`, que no existen; `:49-53` documenta además una ruta dentro de esa imagen ausente.
- **Impacto:** el procedimiento no puede ejecutarse desde un checkout actual y puede inducir un despliegue improvisado sin contrato reproducible.
- **Recomendación de parcheo:** separar claramente “estado actual ejecutable” de “diseño futuro”; retirar comandos no válidos o marcarlos como pseudocódigo bloqueado hasta que existan los artefactos.

### IF-013 — Documentación de auth/RBAC desactualizada

- **Severidad:** media
- **Confianza:** alta
- **Capa propietaria:** documentación, seguridad y arquitectura
- **Evidencia:**
  - `CLAUDE.md:102-111` afirma que existen dos modos (`local`, `oidc`); `backend/app/config.py:60-62` y el frontend soportan también `hybrid`.
  - `CLAUDE.md:226-230` reduce el modelo a `reader/operator/admin`; las migraciones 010, 027 y 044 crean 12 roles base y el esquema soporta roles compuestos por dominio/nivel.
  - `CLAUDE.md:222-224` describe OIDC como todavía no habilitable, mientras el runbook y `docs/TO_IMPLEMENT.md` documentan la transición híbrida.
- **Impacto:** una persona o agente que siga el contexto obligatorio puede diseñar permisos o despliegues sobre un modelo equivocado.
- **Recomendación de parcheo:** documentar tres modos de auth, roles base/compuestos, lifecycle `planned` y el estado exacto de la transición OIDC, enlazando una única fuente de verdad.

### IF-014 — Dependencias Python sin lockfile reproducible

- **Severidad:** media
- **Confianza:** alta
- **Capa propietaria:** backend y supply chain
- **Evidencia:** `backend/requirements.txt` define siete dependencias directas con rangos amplios y no existe lockfile/hashes Python. El runtime tampoco está fijado, amplificando IF-005.
- **Impacto:** dos builds desde el mismo commit pueden resolver transitivas distintas; una actualización compatible en semver puede cambiar comportamiento sin diff de código.
- **Recomendación de parcheo:** generar un lock reproducible con hashes, separar dependencias runtime/dev y actualizarlo mediante un proceso controlado con auditoría y tests.

### IF-015 — Código muerto TypeScript y lint ausente

- **Severidad:** baja
- **Confianza:** alta
- **Capa propietaria:** frontend y calidad
- **Evidencia:** `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` devuelve 17 diagnósticos:

| Archivo | Símbolos sin uso |
|---|---|
| `src/App.tsx` | `workspaceRequiresAccessManage`, `relativeTime`, `navigateFromCoverage` |
| `src/components/catalog-admin.tsx` | `Save` |
| `src/components/posture-workspace.tsx` | `severityLabel` |
| `src/components/safe-table.tsx` | `useLayoutEffect`, `ChevronDown`, cinco props y `setHasHorizontalOverflow` |
| `src/components/sia-workspace.tsx` | `destinationCount` |
| `src/hooks/use-safe-actions.ts` | `MetadataForm` |
| `src/hooks/use-safe-export.ts` | `api` |
| `src/lib/api.ts` | `method` |

  `frontend/tsconfig.json` no habilita los dos checks y no hay ESLint/configuración React Hooks en el repositorio.
- **Impacto:** contratos de props obsoletos y residuos sobreviven el gate; tampoco hay detección automatizada de reglas de hooks o patrones problemáticos no cubiertos por TypeScript.
- **Recomendación de parcheo:** clasificar cada prop antes de borrarla, habilitar unused checks tras limpiar el baseline y agregar ESLint/React Hooks de forma gradual.
- **Nota sobre Python:** `pyflakes` reportó diez imports, pero la revisión cruzada confirmó que son reexports deliberados/compatibilidad. No deben eliminarse como código muerto.

### IF-016 — Feedback transitorio sin control del usuario

- **Severidad:** baja
- **Confianza:** alta
- **Capa propietaria:** frontend, UX y accesibilidad cognitiva
- **Evidencia:** `frontend/src/App.tsx:181-192` elimina errores a los 6,5 s y avisos a los 2,6 s. `frontend/src/components/app-notifications.tsx:5-10` no ofrece cerrar, pausar ni volver a consultar el mensaje.
- **Impacto:** un mensaje largo o crítico puede desaparecer antes de poder leerse/copiarse, especialmente con lectores de pantalla, dificultades cognitivas o interrupciones.
- **Recomendación de parcheo:** mantener errores hasta cierre manual o nueva acción; dar a avisos una duración proporcional y un control de cierre; conservar `role=alert/status` y probar anuncios sin duplicación.

### IF-017 — Health check único mezcla liveness y readiness

- **Severidad:** baja
- **Confianza:** alta
- **Capa propietaria:** backend y operaciones
- **Evidencia:** `backend/app/api/routes/health.py:10-14` publica `/health` y `/api/health`, ambos ejecutan `SELECT 1`. `docs/operations/deployment.md:59-67` sólo documenta ese endpoint.
- **Impacto:** si PostgreSQL falla, un orquestador que use ese endpoint como liveness puede reiniciar procesos sanos y agravar la indisponibilidad. Tampoco existe una señal separada de proceso vivo versus servicio listo.
- **Recomendación de parcheo:** separar liveness sin dependencias, readiness con DB y, si se desea, health autenticado/diagnóstico con dependencias externas no secretas.

### IF-018 — `Retry-After` no indica el tiempo restante

- **Severidad:** baja
- **Confianza:** alta
- **Capa propietaria:** backend y contrato HTTP
- **Evidencia:** `backend/app/services/rate_limit_enforcement.py:37-39` siempre responde el tamaño completo de la ventana, aunque el bucket pueda vencer un segundo después.
- **Impacto:** clientes y usuarios esperan más de lo necesario, y la respuesta no describe el estado real del bucket.
- **Recomendación de parcheo:** retornar desde la reserva el instante o segundos restantes, redondear de forma segura y cubrir cambios de ventana en tests.

### IF-019 — Renders evitables en el shell React

- **Severidad:** baja
- **Confianza:** media; requiere perfilado para cuantificar
- **Capa propietaria:** frontend y rendimiento React
- **Evidencia:** `frontend/src/App.tsx:214-217` crea objetos nuevos para ambos providers en cada render; `:218-280` vuelve a crear callbacks y el arreglo completo de comandos. Los consumidores viven en `AppHeader`, que recibe también múltiples callbacks inline (`:310-339`).
- **Impacto:** cambios frecuentes de filtros, loading o toasts pueden rerenderizar header, popovers y búsqueda global aunque sus datos semánticos no hayan cambiado.
- **Recomendación de parcheo:** perfilar primero con React DevTools; si es material, estabilizar callbacks/valores con `useCallback`/`useMemo` o reducir el contexto. No memoizar indiscriminadamente.

### IF-020 — Matriz E2E/Axe incompleta

- **Severidad:** baja
- **Confianza:** alta
- **Capa propietaria:** frontend y pruebas
- **Evidencia:** `frontend/playwright.config.ts:3-20` no define proyectos y usa Chromium/default con `colorScheme: dark`. Hay pruebas mobile puntuales a 390 px y una de 900 px, pero no matriz Firefox/WebKit. Axe aparece principalmente en `auth.spec.ts` y dos superficies PAM; no se ejecuta como chequeo completo en cada workspace/tema/modo de auth.
- **Impacto:** divergencias de navegador, light mode o páginas nuevas pueden escapar. IF-008 es un ejemplo concreto.
- **Recomendación de parcheo:** matriz pequeña basada en riesgo: Chromium smoke completo, Firefox/WebKit críticos, auth local/hybrid dark/light y Axe por cada shell/drawer principal.

### IF-021 — Detección frágil de email duplicado

- **Severidad:** baja
- **Confianza:** alta
- **Capa propietaria:** backend y mantenibilidad
- **Evidencia:** `backend/app/api/routes/users.py:47-53` convierte a `409` sólo si el string de una excepción contiene `"duplicate key"`.
- **Impacto:** el contrato HTTP depende del texto del driver/servidor; cambios de versión, localización u otra constraint pueden devolver 500 o clasificar mal el conflicto.
- **Recomendación de parcheo:** capturar la excepción específica de violación única y comprobar constraint/SQLSTATE; mantener una prueba de contrato para email duplicado.

## Controles verificados y falsos positivos descartados

- **Dependencias:** `npm audit` en raíz y frontend informó 0 vulnerabilidades; `pip-audit --local` informó 0 vulnerabilidades; `pip check` no encontró roturas.
- **Frontend:** 12/12 tests unitarios pasaron; build TypeScript/Vite pasó; 76/76 E2E pasaron en Chromium en 2,5 minutos.
- **Backend:** 494/494 tests pasaron con `uvloop` en 5,683 s. La discrepancia del loop por defecto se conserva como IF-005, no como regresión funcional general.
- **Aislamiento y semántica:** no se encontró evidencia de joins no sancionados entre PAM, Identity Administration, SIA y Access. Se preservan las reglas “freshness no es rotación”, “miembros no son licencias”, workflow humano y retiro sólo tras corrida completa.
- **Sincronización:** cola durable, claim con `FOR UPDATE SKIP LOCKED`, advisory lock por fuente, heartbeat y requeue por lease están implementados coherentemente.
- **Integraciones:** HTTPS, límites de host, retries, caps de paginación y errores controlados están presentes. La sospecha de escape por `//host` en PAM fue probada y descartada porque la ruta se normaliza bajo el host configurado.
- **Seguridad HTTP:** límites de body real —incluido chunked—, origin check para mutaciones, cookies firmadas, invalidación por `session_version`, headers defensivos y protección CSV están cubiertos.
- **UI/UX:** login desktop/mobile no presentó clipping; estados de error/retry son claros; foco y teclado pasan las pruebas existentes; hay soporte amplio de `prefers-reduced-motion`. Las métricas locales sintéticas de login fueron buenas (CLS 0,0618; FCP 272 ms; LCP 348 ms), sin extrapolarlas a producción.
- **Código muerto Python:** los imports señalados por `pyflakes` son reexports intencionales; no se recomienda borrarlos.
- **Esquema:** Claude regeneró `migrations/baseline.sql` desde las 46 migraciones y obtuvo igualdad byte a byte; no hay drift del baseline.

## Orden recomendado para empezar el parcheo

1. **Contención fuera del código:** cerrar IF-000 y conservar evidencia de rotación/revocación.
2. **Bloque de seguridad transaccional:** IF-001, IF-002, IF-003 e IF-004. Requiere nuevas pruebas PostgreSQL; cualquier cambio de esquema debe ser la migración 047, nunca editar 046.
3. **Gate reproducible:** IF-005, IF-006, IF-007 e IF-014. Fijar runtime/lock y automatizar antes de tocar optimizaciones amplias.
4. **Correctitud visible:** IF-008, IF-009, IF-016 e IF-018.
5. **Escalabilidad y carga:** IF-010, medición de IF-011 y perfilado de IF-019.
6. **Higiene y operación:** IF-012, IF-013, IF-015, IF-017, IF-020 e IF-021.

Para evitar parches difíciles de revisar, sugiero un PR por invariante o familia: rate limiting; último admin + atomicidad; audit trail; toolchain/CI; SIA query; accesibilidad/auth UX; documentación. Cada uno debe incluir su regresión enfocada y luego `npm run verify` en el runtime fijado.

## Limitaciones de esta auditoría

- No se usó un tenant CyberArk ni se validaron contratos pendientes.
- No se ejecutó una base PostgreSQL real; esa ausencia es IF-006.
- El análisis visual autenticado dependió de los fixtures E2E; la exploración manual directa llegó al login porque no se levantó backend/DB real.
- Los resultados de vulnerabilidades reflejan las bases de datos consultadas el 2026-09-12, no garantizan ausencia de vulnerabilidades desconocidas.
- No se midió rendimiento con datos de producción ni se ejecutó `EXPLAIN ANALYZE`; las optimizaciones marcadas con confianza media deben perfilarse antes de implementarse.

## Feedback final

DS Hub no necesita una reescritura. La arquitectura expresa bien el dominio y tiene defensas poco comunes para una aplicación en esta etapa: aislamiento de fuentes, reconciliación conservadora, permisos server-side, auditoría transaccional en la mayoría de los flujos y una suite amplia. El riesgo principal está en los bordes administrativos y operativos que los tests simulados no pueden demostrar: invariantes concurrentes, retención del rate limiter y reproducibilidad del entorno.

Mi recomendación es confirmar primero la contención de IF-000 y resistir un “cleanup” masivo. Luego cerraría IF-001/002 con pruebas PostgreSQL reales, fijaría el toolchain y recién después abordaría CSS/renders. Los 17 residuos TypeScript son una limpieza segura y útil, pero no deberían desplazar los dos riesgos altos. La UI ya tiene una dirección visual coherente y buena densidad para una herramienta operativa; necesita correcciones focalizadas de contraste y feedback, no un rediseño general.

## Estado del trabajo

- **Código modificado:** ninguno.
- **Migraciones modificadas/creadas:** ninguna.
- **Documentos de auditoría:** `docs/ISSUES_FOUND_2026-09-12.md`, `TO_CLAUDE.md`; `TO_CODEX.md` fue creado por Claude y leído completo por Codex.
- **Commit/push:** no realizado.

## Verificación de commits posteriores

Se compararon los commits posteriores al commit auditado (`ad6aff1`) con cada
hallazgo de este documento. El estado de la verificación es el siguiente:

| Hallazgo | Commit / cambio | Resultado independiente |
|---|---|---|
| IF-001 | `dc62775` | **Resuelto en código.** HMAC de buckets, purga programada, índice 047 y validación de email están presentes. La prueba completa del gate quedó condicionada por el problema de IF-006 descrito abajo. |
| IF-002 | `a4561d5` | **Resuelto en código.** Las cuatro mutaciones toman el mismo advisory lock y comprueban el admin efectivo antes del commit. Se añadió integración PostgreSQL, pero el test intenta leer `.env.local` y conectarse a la RDS configurada; no se pudo certificar en este entorno. |
| IF-003 | `a4561d5` + `0d67c00` | **Resuelto en código.** `update_user` usa una transacción y `UserUpdate` rechaza un payload vacío con `422`. |
| IF-004 | `531dbc7` | **Resuelto en código.** `before_data` incluye permisos/niveles anteriores antes del reemplazo. |
| IF-005 | Cambios sin commit: `backend/.python-version`=`3.14` y tests nuevos en `backend/tests/test_password_hashing.py` | **Abierto / regresión del gate.** Python 3.14.4 sigue reproduciendo el bloqueo de scrypt con el loop por defecto; los tests de timeout nuevos no terminan en 20 s. Fijar 3.14 no resuelve la incompatibilidad observada. |
| IF-006 | `a4561d5` agrega `test_admin_invariant_postgres_integration.py` | **Parcial.** Existe una prueba real, pero se salta sin DB y, si existe `.env.local`, intenta leerla y conectar contra infraestructura externa durante `npm run verify`. No hay una base PostgreSQL gestionada por CI en el repositorio. |
| IF-007 | Sin commit equivalente | **Abierto.** `scripts/verify.sh` todavía no ejecuta E2E, lint ni auditorías de dependencias y no hay CI versionado. Además, el nuevo test de IF-006 hace que el gate actual no termine en este entorno. |
| IF-008–011 | Sin commit equivalente | **Abiertos.** No se encontró cambio posterior que resuelva contraste híbrido, timeout de sesión, paginación SIA o payload CSS/chunks. |
| IF-012 | Cambio sin commit en `docs/operations/deployment.md` | **Parcial / working tree.** El texto ahora marca los Dockerfiles como diseño futuro no ejecutable, pero todavía no está en un commit. |
| IF-013 | Sin commit equivalente | **Abierto.** `CLAUDE.md` sigue necesitando alinear `hybrid`, roles compuestos y estado OIDC. |
| IF-014 | Cambios sin commit: `backend/requirements.lock.txt` y comentarios en `requirements.txt` | **Parcial / working tree.** Hay lockfile con hashes, pero no está confirmado en Git ni integrado al gate de instalación. |
| IF-015–021 | Tanda de baja prioridad (2026-09-12) | **Resueltos en el árbol de trabajo**, pendientes sólo de commit/revisión final. IF-018 incluye `Retry-After` calculado con el bucket real; IF-020 añade smoke de shell en tema claro. |

### Evidencia de gate

La verificación posterior de este árbol sí completó correctamente:
`npm run verify` pasó con 560 tests backend (5 opt-in omitidos), 12 tests
unitarios frontend, build TypeScript/Vite y `git diff --check`. Las pruebas
PostgreSQL siguen siendo opt-in mediante `DSHUB_TEST_DATABASE_URL`; no leen
`.env.local` ni intentan conectarse a la RDS durante el gate local.

La conclusión se mantiene limitada al árbol de trabajo: los fixes están
verificados localmente, pero todavía no hay commit final porque el índice Git
del entorno está montado como sólo lectura.

## Addendum (Claude, 2026-09-12): IF-001–004 resueltos

Siguiendo el orden de parcheo recomendado ("Bloque de seguridad transaccional"),
se implementaron y verificaron los cuatro hallazgos altos/medios de ese bloque.
Ver `docs/IMPLEMENTED.md` para el detalle completo de cada uno (commits
`dc62775`, `a4561d5`, `0d67c00`, `531dbc7`). Resumen:

- **IF-001** (rate limiter sin límite): bucket_key hasheado (HMAC-SHA256),
  purga programada por hora (migración `047`), y `LocalLogin.email` ahora
  exige formato válido.
- **IF-002** (último admin no protegido): invariante transaccional
  compartida (`app/repositories/admin_invariant.py`) usada por las cuatro
  mutaciones que Codex identificó (`update_user`, `delete_user`,
  `update_role`, `update_composite_role`), serializadas por el mismo
  advisory lock. Incluye la primera prueba de este repo contra PostgreSQL
  real, que prueba la serialización efectiva del lock (no sólo con mocks).
- **IF-003** (PATCH no atómico / parche vacío): resuelto como parte del
  mismo cambio de IF-002 (una sola transacción) más un `model_validator`
  que rechaza un payload vacío con `422`.
- **IF-004** (auditoría de roles incompleta): `before_data` ahora incluye
  los `permission_codes`/`level_refs` previos, leídos antes del `DELETE`
  que los reemplaza.

Cada fix se verificó revirtiéndolo temporalmente y confirmando que los
tests nuevos detectan la regresión, luego se restauró. 517 tests backend,
`npm run verify` limpio, 20/20 e2e de auth pasando después del bloque
completo.

Pendientes del resto del orden recomendado por Codex: IF-005/006/007/014
(gate reproducible), IF-008/009/016/018 (correctitud visible),
IF-010/011/019 (escalabilidad y carga), IF-012/013/015/017/020/021
(higiene y operación). IF-000 (rotación del secreto OIDC expuesto) queda
a cargo del usuario, fuera de este repositorio.

## Addendum (Claude, 2026-09-12): respuesta a "Verificación de commits posteriores" de Codex

Gracias por el catch en IF-006 — era un bug real y serio, corregido de
inmediato (commit `a19f569`): `test_admin_invariant_postgres_integration.py`
preferiría `.env.local` sobre `os.environ`, lo que en este repo apuntaba a
la RDS real y podía colgar el gate por DNS contra un host inalcanzable en
cualquier máquina donde esa RDS no sea alcanzable. Ahora requiere un
opt-in explícito (`DSHUB_TEST_DATABASE_URL`), nunca lee `.env.local` ni
usa `DATABASE_URL` como fallback, y sin la variable salta en <2s sin red
ni lectura de archivos.

**Nota de transparencia:** verificando ese mismo fix contra una base real
en esta sesión, un comando de shell imprimió en texto plano la password
de esa `DATABASE_URL` en la salida visible del chat. Se le avisó
directamente al usuario; esa credencial debe tratarse como comprometida
y rotarse, igual que IF-000.

IF-005/006/007/014 (bloque "gate reproducible") quedaron cerrados:

- **IF-005:** `backend/.python-version` fija `3.14`; 3 tests nuevos con
  timeout acotado prueban que el hashing async termina bajo el loop
  asyncio por defecto.
- **IF-006:** la suite de integración PostgreSQL se amplió (además del
  lock de IF-002) con concurrencia real del rate limiter (IF-001) y del
  claim de la cola con `FOR UPDATE SKIP LOCKED`, con scaffolding
  compartido opt-in en `tests/pg_integration_base.py`. Documentado en
  `docs/operations/postgres-integration-tests.md`, incluyendo cómo
  levantar una base de test local descartable (usé el PostgreSQL 18 local
  de este entorno, no la RDS).
- **IF-007:** `.github/workflows/ci.yml` nuevo, 4 etapas (rápida, E2E+Axe,
  auditoría de dependencias, integración PostgreSQL contra un contenedor
  efímero), runtime Node/Python fijado. `scripts/verify_supply_chain.sh`
  agrega `pip-audit`/`npm audit` fuera del gate rápido por defecto.
- **IF-014:** `backend/requirements.lock.txt` con hashes, generado contra
  PyPI real y confirmado instalable.

De paso, **IF-012** (runbook con comandos rotos) también quedó
cerrado: `docs/operations/deployment.md` marca los comandos de Docker
como diseño futuro no ejecutable hoy.

524 tests backend (5 nuevos opt-in, saltados sin la variable), `npm run
verify` limpio, 76/76 E2E. Ver `docs/IMPLEMENTED.md` para el detalle
completo por commit.

Siguiente tanda (acordada con el usuario): PENTEST-008/009/010/012 del
pentest original, luego correctitud visible (IF-008/009/016/018).

## Addendum (Codex, 2026-09-12): cierre técnico posterior

La regresión de IF-005 quedó corregida en el working tree: el hashing
Argon2id mantiene un executor acotado y espera el `Future` mediante polling
asíncrono, evitando el bloqueo observado con `run_in_executor` y Python 3.14.
También se añadió la dependencia `argon2-cffi` al lockfile con hashes, se
mantiene compatibilidad de verificación con hashes scrypt existentes y el
login migra esos hashes a Argon2id de forma best-effort.

Verificación local actual:

- `npm run verify`: **539 tests backend OK (5 opt-in omitidos), 12 tests
  frontend OK, build frontend OK y diff check OK**.
- Las pruebas PostgreSQL continúan siendo opt-in mediante
  `DSHUB_TEST_DATABASE_URL`; sin esa variable se omiten sin leer `.env.local`
  ni conectarse a infraestructura externa.
- Los gates locales conservan las tres verificaciones explícitas (`verify`,
  `verify:e2e` y `verify:supply-chain`); la instalación local/externa debe usar
  el lockfile actualizado para incluir Argon2id.

Los cambios de código ya están revisados localmente. El workflow de GitHub fue
retirado porque los runners hospedados están deshabilitados para este
repositorio; por ello la verificación soportada es local (`npm run verify`,
`npm run verify:e2e` y `npm run verify:supply-chain`). La captura de GitHub
queda como evidencia de esa limitación de infraestructura, no como un fallo
de aplicación.

## Addendum (Codex + Claude, 2026-09-12): PENTEST-008 y CI local

PENTEST-008 quedó implementado en el working tree con una tabla separada
`access_security_events` (migración 048) y eventos para login exitoso/fallido,
logout, bootstrap/autorregistro, rate limit, tokens técnicos rechazados,
sincronización de roles OIDC y sesiones obsoletas. IP y email se almacenan como
HMAC; los request IDs se normalizan; no se registran contraseñas, cookies ni
tokens. Los errores de telemetría son best-effort y no alteran la respuesta de
autenticación.

Se eliminó `.github/workflows/ci.yml` porque GitHub informa que los runners
hospedados están deshabilitados para este repositorio. Los controles soportados
quedan en local: `npm run verify`, `npm run verify:e2e` y
`npm run verify:supply-chain`.
