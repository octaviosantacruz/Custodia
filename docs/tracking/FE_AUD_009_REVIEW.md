---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-13
---

# Revisión adicional de interfaz — FE-AUD-009

Revisión de lectura en Custodia local (`:5173`), con datos reales del tenant y
sesión autenticada, escritorio 1440×900. Complementa el barrido de 28 rutas
con fixtures del 2026-10-11; no lo presenta como una medición con datos reales.
La revisión adicional terminó; sus hallazgos pendientes conservan IDs propios.

## Alcance y evidencia

Se recorrieron 26 URLs en tema claro con agent-browser, Axe WCAG A/AA,
comprobación de carga y de desborde horizontal, y captura por vista. Incluye
URLs anteriores que redirigen: el total no implica 26 workspaces distintos.
Todas cargaron y ninguna desbordó horizontalmente el documento a 1440 px.
Axe detectó cinco superficies con violaciones, reproducidas en una segunda
pasada. Las comprobaciones incompletas de Axe no se cuentan como aprobadas.

Rutas revisadas:

- CyberArk: `/pam`, `/pam/safes`, `/pam/platforms`, `/pam/connectors`,
  `/pam/health`, `/pam/cleanup`, `/pam/roles`, `/pam/identity/users`,
  `/pam/identity/roles`, `/pam/sia`, `/pam/sia/resources`,
  `/pam/sia/database-accounts`, `/pam/assets`, `/pam/graph`, `/pam/posture`.
- Netskope: `/netskope`, `/netskope/operations`, `/netskope/devices`,
  `/netskope/users`, `/netskope/experience`, `/netskope/uci`, `/netskope/posture`.
- Transversales: `/chains/person`, `/admin/access`, `/admin/activity`, `/help`.

Además se abrió el drawer de Safe (Resumen y Clasificar), el de Identity y el
de acceso de un usuario Okta; los diálogos Mi cuenta y Crear usuario local;
y Command-K. Se comprobó Tab/Shift+Tab/Escape en Command-K y foco dentro de los
drawers de acceso e Identity. Safe y Command-K se observaron en ambos temas;
el barrido completo de datos reales fue en claro. Se abrió una persona real,
sus ramas CyberArk y Netskope, y se verificó que `/connections/coverage`
redirige a Personas. La consola no registró excepciones JavaScript en el
recorrido. No se guardaron formularios, modificaron roles, exportaron datos
ni iniciaron sincronizaciones.

Las capturas, snapshots y resultados JSON permanecen fuera del repositorio,
en `/tmp/custodia-fe-aud-009/` (directorio privado), porque contienen inventario e
identidades reales. `sweep-results.json` registra el primer barrido y
`sweep-recheck-results.json` la reproducción de las cinco superficies detectadas.
Cada ruta tiene su captura en `screenshots/` y su resultado Axe. Estos
artefactos son evidencia local de esta sesión, no una baseline visual durable.
La contraseña temporal se eliminó después del login y no se guardó estado
autenticado en el repositorio.

## Corregidos durante la revisión

| Hallazgo | Evidencia antes del arreglo | Cambio y regresión |
|---|---|---|
| Filtro activo de Command-K en claro | Texto `#167a4b` sobre `#d8ece2`, 11 px: 4,34:1, mínimo 4,5:1. Captura `command-light-issue.png` y dos resultados Axe de reproducción. | Texto con `--text-primary`, conservando fondo y borde verdes. La prueba existente en `frontend/tests/e2e/cross/auth.spec.ts` ahora selecciona y comprueba el tema almacenado de Custodia: falla en claro antes del arreglo y pasa en ambos temas después. |
| Insignia «Cuenta de Okta» en el drawer de acceso | Texto `#167a4b` sobre `#dee9e2`, 11 px en negrita: 4,30:1. `real-user-access-light-axe.json` y `real-user-access-light-recheck-axe.json`. | Texto con `--text-primary`. La prueba existente del drawer Okta fija el tema de Custodia y falla antes del arreglo; pasa en ambos temas después. |
| Título de Depuración | `/pam/cleanup` mostraba la pestaña Depuración y el h1 Limpieza PAM; `screenshots/real-cleanup-title.png`. | El registro PAM usa Depuración. La regresión existente de Postura comprueba el h1; falla antes del cambio y pasa después. |

La preferencia de color del navegador no seleccionaba por sí sola el tema de
Custodia: las dos pruebas de Axe podían ejecutarse bajo el proyecto claro y
seguir viendo el tema oscuro predeterminado. La corrección de esas pruebas
cubre el comportamiento observable y evita duplicar sus escenarios.

Se ejecutaron seis casos E2E focalizados: los dos controles de contraste en
ambos temas, el título de Depuración y el ciclo de foco de Command-K. Todos
pasaron. La sesión real también confirmó la corrección de Command-K y de la
insignia del drawer; el barrido confirmó el nuevo título de Depuración.

## Hallazgos reproducidos y seguimiento

| ID | Prioridad | Pasos y resultado | Propietario y cierre |
|---|---|---|---|
| `FE-AUD-010` (corregido 2026-10-13) | P2 | Abrir `/pam/platforms` en claro. El número de plataformas usa `#167a4b` sobre `#e0eae4`, 15 px en negrita: 4,35:1. | PAM, contador de plataformas. Corregido con `--text-primary`. Regresión Axe en ambos temas con contador de varias cifras; falla antes y pasa después. [Detalle del cierre](done/2026-10-13.md#contraste-del-contador-de-plataformas-pam). |
| `FE-AUD-011` (corregido 2026-10-13) | P1 | Abrir `/pam/cleanup` con señales reales. Axe marca `scrollable-region-focusable` en `.compact-table-wrap`: hay una tabla desplazable cuyo contenedor y contenido no son alcanzables por teclado. | PAM, `pam-cleanup-signals-view.tsx`. Corregido con región nombrada, Tab y foco visible. Regresión con 24 filas, PageDown y Shift+Tab en ambos temas y dos tamaños de escritorio; diez E2E de Depuración pasaron. [Detalle del cierre](done/2026-10-13.md#desplazamiento-por-teclado-en-depuración). |
| `FE-AUD-012` (corregido 2026-10-13) | P1 | Abrir `/pam/identity/users` en claro con asientos Standard conciliados. Texto de la insignia `#1f9d61` sobre `#e4f3ec`, 10 px en negrita: 3,02:1. | CyberArk compartido, `standard-seat-badge.css`. Corregido con `--text-primary`; nombre accesible y texto conservados. La regresión de Axe falla antes en claro y pasa después en ambos temas; 19 E2E de Identity en verde. [Detalle del cierre](done/2026-10-13.md#contraste-de-la-insignia-standard). |
| `FE-AUD-013` (corregido 2026-10-13) | P2 | Abrir `/pam/identity/roles` en claro. La insignia Rol de CyberArk (`.tone-info.status-badge`) usa `#446f96` sobre `#e2ecf9`, 12 px: 4,44:1. | Identity. La causa era la opacidad local de 0,9 aplicada a las insignias, retirada; los colores compartidos se conservan. Regresión Axe de roles y grupos en ambos temas; falla antes y pasa después. [Detalle del cierre](done/2026-10-13.md#contraste-de-tipos-de-rol-de-identity). |
| `FE-AUD-014` (corregido 2026-10-13) | P1 | Abrir `/admin/access` en claro. Chips de cuenta Okta: 3,36:1; chips de roles: 4,25:1. Los valores efectivos incluyen la composición visual de la fila. | Cross, `user-admin.css`. Reproducción estable: Okta 4,18:1; los roles pasan cuando termina la animación. Corregido únicamente el texto de Okta con `--text-primary`; Axe de la tabla pasa en reposo y hover en ambos temas, esperando las animaciones. [Detalle del cierre](done/2026-10-13.md#contraste-de-las-cuentas-okta-en-usuarios-y-permisos). |

Los resultados `*-recheck-light-axe.json` reproducen cada hallazgo y los
`*-real-light-axe.json` conservan los originales. Las capturas correspondientes
se nombran con la ruta (`pam-platforms`, `pam-cleanup`, `pam-identity-users`,
`pam-identity-roles`, `admin-access`). Todos son problemas visibles al cargar;
no requieren vídeo de una mutación para reproducirse.

## Límites

No se probaron mutaciones contra el tenant ni combinaciones exhaustivas de
roles restringidos, todos los datos posibles, todos los estados vacíos/fallidos
o lectores de pantalla. Los resultados incompletos de contraste por
superposición en algunos drawers y gráficos necesitan inspección específica;
no permiten afirmar cumplimiento total de accesibilidad. No se incorporó
cobertura móvil. La sesión real fue local, no una verificación de Cloudflare,
OIDC o del despliegue externo. No se necesita migración.
