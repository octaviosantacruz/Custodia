---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-11
---

# Roles y permisos: mapa de accesos y editor de capacidades

El dueño pidió reconstruir esta experiencia desde cero tras revisar la pantalla
anterior: el directorio lateral ocupaba demasiado ancho y el detalle dejaba un
panel grande con poca información. Este diseño sustituye el recorrido de roles
propuesto en [access-ui-proposal.md](access-ui-proposal.md). La gestión de personas
conserva el comportamiento actual del worktree.

## Pregunta y recorrido

Para quien administra DS Hub: «¿Qué habilita cada rol y a quién se lo doy?».

La entrada es un **mapa de accesos a todo el ancho, con compartimientos por herramienta**. Cada rol aparece una sola vez, con columnas por área del catálogo y acceso directo a miembros. Cada celda
muestra las capacidades del área; al abrirla, el editor enfoca esa área. El
conteo usa el dominio de cada permiso, nunca el dominio nominal del rol: un
nivel de Plataforma puede contener permisos PAM y la tabla lo muestra en PAM.
CyberArk reúne PAM, Identity y SIA; Netskope reúne sus permisos. DS Hub contiene los roles de Plataforma y los perfiles transversales. Cada compartimiento se puede plegar y tiene su propia tabla, para que agregar una herramienta no agregue columnas a todas las demás. La búsqueda encuentra nombres, propósitos, códigos y capacidades. Los roles
preparados tienen filtro propio; no se presentan como acceso efectivo.

Crear, consultar y editar reemplazan el mapa por una **pantalla dedicada**:

- Nombre, código y propósito compactos sobre el editor.
- Capacidades en una tabla: descripción del catálogo, acción y alcance.
- Filtros por área, búsqueda y «Sólo incluidos».
- Resumen lateral con las capacidades elegidas y los cambios reales.
- Barra de guardado visible y revisión antes de modificar un rol existente.
- «Miembros» abre las cuentas que tienen ese rol mediante `people?role=`, con
  su origen de asignación y paginación.

## Logos y extensión del catálogo

Los compartimientos, las filas y las áreas del editor usan los logos existentes
en `frontend/public`: blanco en oscuro y oscuro/negro en claro. El cambio de
tema cambia la variante mediante CSS; no se recolorean ni se crean assets.
Los permisos y los niveles se agrupan por herramienta, manteniendo visible
el área concreta de cada capacidad. La identidad visual está centralizada en
`access-tool-groups.ts`; un dominio nuevo del catálogo obtiene automáticamente
un compartimiento con su nombre y un icono neutro hasta que tenga marca propia.
BigID continúa siendo sólo un placeholder preparado, sin una integración nueva.

## Dos maneras explícitas de definir un rol

**Capacidades concretas** es el recorrido inicial: permisos explícitos de las
áreas elegidas. No agrega navegación, PAM ni ninguna capacidad implícita.
La tabla distingue navegación (abre el menú) de las funciones sobre datos.
DLP/UCI se identifican como datos por usuario. La descripción proviene del
catálogo; los códigos quedan en un detalle técnico.

**Niveles vinculados** conserva referencias al rol base de cada área. Se puede
omitir cualquier área, pero debe existir al menos una selección. El editor
explica que los cambios del rol base se heredan. Las composiciones existentes
con niveles preparados se conservan hasta que se quite cada referencia de
forma explícita. No se convierten silenciosamente en permisos copiados.

La duplicación conserva el tipo de rol y su conjunto exacto de permisos o
referencias. Los roles del sistema siguen siendo de sólo lectura. Los permisos
heredados y los códigos ausentes del catálogo se mantienen al guardar; se
identifican y sólo se quitan por una acción explícita.

## Asignaciones y Okta

Se conserva la decisión vigente de `ACCESS-UI-003`: **sin directorio de grupos
reales no se edita el mapeo de Okta desde la UI**. El detalle muestra «Lo otorga
en Okta» cuando el backend entrega grupos y el actor puede leer el mapeo. Es
configuración conocida, no una consulta de pertenencia actual.

Las asignaciones manuales se gestionan desde Miembros; las que vienen de Okta
se identifican y no tienen acción de revocación manual. Las cuentas de la
misma persona siguen siendo independientes. No se agregan datos de pertenencia
cargados a mano ni se cambian las reglas de refresco de sesión.

## Contrato técnico y validación

La reconstrucción vive en `frontend/src/cross/`. Sustituye la composición
lista/detalle y elimina el formulario anterior. Reutiliza los endpoints y el
catálogo existentes; no introduce tablas, migraciones ni un segundo motor de
autorización. El backend conserva techo de delegación, último administrador,
protección de roles del sistema, auditoría transaccional y permisos por ruta.
La UI evita ofrecer concesiones por encima del alcance del actor; el backend
vuelve a validarlas al guardar. Un rechazo conserva el borrador y su revisión.

Las pruebas de navegador cubren el mapa, el área abierta desde una celda,
payloads exactos al crear y duplicar, omisiones en composiciones, conservación
de niveles preparados, rechazo del servidor, lectura autorizada de grupos,
miembros, foco, descarte de borradores y accesibilidad. Se ejecutan además
`npm run verify`, verificación de estilos y revisión visual de escritorio.

## Evidencia de entrega

Validación local del 2026-10-11:

- `npm run verify`: 1601 tests de backend, 482 de frontend, build y typecheck,
  estilos, contratos y documentación correctos. PostgreSQL fue efímero.
- 44 E2E de acceso y regresiones pasaron en la corrida de ambos temas. Después
  del último ajuste de distribución de niveles, pasaron otros 11 casos de
  mapa, logos, composiciones, mapeos de sólo lectura y alineación.
- QA visual con `agent-browser`, datos simulados y viewport de escritorio:
  compartimientos CyberArk/Netskope y editor revisados en oscuro y claro;
  los logos usan las variantes locales correspondientes.
- Un rol preparado permite retirar una asignación manual existente sin
  ofrecer nuevas concesiones. Los permisos heredados de Okta permanecen
  identificados y sin acción de revocación manual.
- No hubo migraciones nuevas, cambios en datos reales, commit ni despliegue.
