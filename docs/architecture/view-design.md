---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-16
---

# Diseño de vistas por pregunta

Cada vista de Custodia responde **una pregunta de una persona concreta**. El
menú se ordena por esas preguntas, no por la herramienta de origen del dato ni
por la tabla que lo contiene. Criterio fijado por el dueño del producto el
2026-10-11 (`UX-IA-002`) después de ver Experiencia digital de Netskope: tres
tablas repetían los mismos equipos y una vista de flota y una de usuario
convivían en la misma pantalla.

## Cómo se decide una vista

1. **Pregunta.** Se escribe en una frase, en la voz de quien la hace
   («¿Cómo está la flota?», «¿Quién tiene acceso a qué?»). Si hacen falta dos
   frases con sujetos distintos, son dos vistas.
2. **Persona.** *Manager* (¿cómo vamos, dónde está el riesgo?), *operador*
   (¿a quién o qué atiendo hoy y por qué?) o *auditor* (¿qué evidencia hay?).
   Una vista puede servir a dos, pero el primer vistazo es de uno.
3. **Respuesta en 5 segundos.** Arriba, el dato que responde la pregunta
   (tarjeta, proporción, ranking, semáforo). El detalle va debajo; el
   procedimiento y la metodología van a Ayuda.
4. **Una entidad por pantalla.** Un equipo, un usuario o un Safe aparece en
   **una** tabla; si dos tablas lo muestran, se fusionan en una con más
   columnas y el detalle se expande en la fila.
5. **Del número a la lista.** Todo contador abre exactamente la lista que
   cuenta (misma consulta, mismo filtro).
6. **Nombre = lo que responde.** El menú dice «Equipos», «Usuarios», «Hallazgos»,
   no el origen técnico («ADEM», «UCI», «Catálogos técnicos»). El origen va en
   la ayuda de la tarjeta.
7. **Texto mínimo** y **«Sin dato», nunca 0** (ver `AGENTS.md` y la guía de
   producto). Lo que no responde la pregunta no se muestra.
8. **Dos planos.** *Macro* (flota, empresa, programa) arriba o a la izquierda;
   *micro* (un usuario, un Safe, un equipo) como ficha. No se mezclan en la
   misma tabla.

## Lista de control antes de agregar o mover una vista

- ¿Cuál es la pregunta y quién la hace?
- ¿Ya existe otra vista que responde lo mismo? Fusionar antes de crear.
- ¿Algún dato aparece en más de una tabla de la pantalla?
- ¿Cada número tiene su lista?
- ¿El nombre del menú describe la respuesta?
- ¿El texto de la pantalla cabe en una línea por bloque? Los límites y la metodología van tras un «?» (`HelpHint`), no en la página.

## Mapa de Netskope (actualizado 2026-10-16)

| Vista | Pregunta | Contenido |
|---|---|---|
| Métricas | ¿Cómo estamos en general? | Sin cambios. |
| **Equipos** (rediseñada el 2026-10-11, `NSK-FLEET-001`) | ¿Cómo está la flota? | Banda con lo crítico y pestañas **Flota** (tabla agrupada) y **Cambios**. Los números de riesgo abren su fila en Postura. |
| **Riesgo** (antes «Usuarios»; renombrada el 2026-10-19) | ¿Qué personas tienen señales de riesgo? | Pestañas «Para revisar» (solo UCI bajo o moderado, menor primero) y «Por empresa», búsqueda superior y ficha lateral de la persona (con sus «Últimos 7 días»: Oficina, Remoto, Sin señal o Pendiente). El rendimiento no entra en esta cola. |
| **Rendimiento** (`NSK-EXP-OFFICE-001`, 2026-10-19) | ¿Cómo funcionan las apps y la red en la oficina? (dueño del servicio, jefatura) | Todo lo de ADEM, en dos pestañas. «Oficina, por semana»: una frase con denominador y una línea de datos; un solo gráfico semanal (selector malo o regular / promedio, solo desde la primera hasta la última semana medida) y una sola tabla (selector personas / por día / por empresa) que pagina de a 20, sin scroll interno. «Evolución diaria» (`NSK-EXP-OFFICE-002`): línea de tiempo diaria oficina/remoto con filtro de empresa, una persona superpuesta, lugar y período (30/90/180 días o fechas «Desde/Hasta»), con un resumen del período que hace de leyenda; los días se eligen sobre el gráfico (clic, arrastre, Ctrl/⌘ + clic para días sueltos, Shift + clic para extender, Enter/Espacio con teclado) y el resumen describe la selección; reemplaza la lista de los 100 menores puntajes de 24 h, que no separaba oficina de remoto y en la práctica mostraba solo puntajes buenos. Ambas abren la misma ficha que Riesgo. Permiso estricto `netskope:uba_read`. |
| Postura | ¿Qué está mal y qué hago? | Banda por severidad y una sola tabla con todos los chequeos; cada fila se expande con muestra y detalle (último evento, diagnóstico con sugerencias, duplicados). Sin pestañas; «Actividad de políticas» se retiró (2026-10-11). |
| Alertas DLP | ¿Qué alertas hay? | Fuera del menú mientras su publicación siga pausada; accesible por URL con su permiso específico. |
| Inventario | ¿Qué hay registrado? | «Registro de equipos» y «Registro de usuarios» como listas separadas. |
| Administradores | ¿Quién administra Netskope y con qué permisos? | Pestañas «Administradores» y «Roles»; detalle de permisos por rol. |

Ficha del usuario: tarjetas arriba (Rendimiento digital, Ubicación, Anomalías, Confianza UCI) y
**una** tabla de equipos (ubicación, client config, puntajes general/equipo/
red/aplicaciones, última señal); el POP informado por ADEM va en la fila
expandida. «Relaciones (enlace histórico)» deja de ser entrada de menú y su
ruta conserva la redirección.

## Mapa de CyberArk (propuesta, 2026-10-11)

Hoy el menú se agrupa por origen técnico (Inventario, Acceso PAM, Catálogos
técnicos PAM, Identity y SIA, Postura) y varias preguntas están repartidas:

| Pregunta | Dónde se responde hoy | Problema |
|---|---|---|
| ¿Qué está mal? | Hallazgos PAM y Limpieza PAM | Dos vistas, una en «Postura» y otra en «Catálogos técnicos». |
| ¿Quién tiene acceso a qué? | Personas, Relaciones, Roles CyberArk, Roles y grupos, Usuarios, Identidades | Seis entradas para una pregunta. |
| ¿Está sano el servicio? | Salud PAM y Conectores PSM y SIA | Conectores está registrado dos veces (PAM y SIA) en la misma ruta. |
| ¿Qué conexiones y recursos están migrados y cubiertos? | Inventario, Máquinas virtuales SIA, Cuentas de base de datos SIA | «Inventario» no dice qué responde y comparte categoría con Safes. |

Propuesta de menú (el dueño fijó el nombre «Postura» para ambas plataformas el 2026-10-11; el resto de los nombres está por discutir y CyberArk se ordena después de Netskope):

| Vista | Pregunta | Contenido |
|---|---|---|
| Métricas | ¿Cómo vamos? | Sin cambios. |
| **Postura** (estandariza el nombre con Netskope) | ¿Qué está mal y qué limpio? | Hallazgos PAM y Limpieza PAM como dos pestañas (Riesgos, Depuración). |
| Safes | ¿Qué Safes hay y cómo están clasificados? | Sin cambios; Plataformas queda como catálogo secundario (decisión del dueño, 2026-10-11). |
| **Acceso** | ¿Quién tiene acceso a qué? | Relaciones (cadenas) primero, luego Roles (CyberArk e Identity) e Identidades. Personas sigue transversal y enlaza acá. |
| **Cobertura** | ¿Qué conexiones están migradas? | Hoy «Inventario». Los recursos SIA quedan en el hub SIA (decisión del dueño, 2026-10-11). |
| **Servicio** | ¿Está sano PAM y SIA? | Salud PAM y Conectores PSM y SIA, una sola vez. |
| SIA | ¿Qué políticas de acceso hay? | Sin cambios. |

### Árbol actual de CyberArk (vistas y subvistas, 2026-10-11)

`M` = entrada de menú, `S` = subvista (pestaña o subnavegación dentro de otra vista), `—` = ruta sin entrada visible.

| Nivel | Vista (id, ruta) | Contenedor |
|---|---|---|
| M | Métricas (`general`, `/pam`) | — |
| M | Hallazgos PAM (`posture`, `/pam/posture`) | — |
| M | Relaciones (`graph`, `/pam/graph`) | — |
| M | Safes (`safes`, `/pam/safes`) | subnav PAM: Safes · Plataformas · Infraestructura |
| S | Vigentes / Retiradas | pestañas dentro de Safes |
| S | Plataformas (`platforms`, `/pam/platforms`) | subnav PAM |
| S | Conectores PSM y SIA (`connectors`, `/pam/connectors`; también `siaConnectors`) | subnav Infraestructura PAM |
| S | Salud PAM (`pamHealth`) | subnav Infraestructura PAM |
| S | Limpieza PAM (`pamCleanup`) | subnav Infraestructura PAM |
| M | Inventario (`assets`, `/pam/assets`) | — |
| M | Identidades (`identity`) | hub Identity |
| S | Usuarios · Roles y grupos (`identityUsers`, `identityRoles`) | hub Identity |
| — | Grupos de Okta, Federaciones, Roles CyberArk (`identityGroups`, `identityFederations`, `roles`) | redirigen al hub Identity |
| M | SIA (`sia`) | hub SIA |
| S | Políticas · Máquinas virtuales · Cuentas de base de datos (`sia`, `siaResources`, `siaDatabaseAccounts`) | hub SIA |

Las rutas actuales se conservan como `legacyPaths`; no se borra ninguna URL.

## Estado

Servicio → Conectores incorpora los pools y redes de Connector Manager
(`CMGR-001`, 2026-10-19) en el selector existente. Cada inventario conserva su
fuente y una sola tabla: PSM y SIA sincronizados, pools y redes consultados en
vivo. La consulta muestra fecha, nombres y conteos; no mide salud ni capacidad
ni infiere asociaciones con los conectores de los otros inventarios.

El criterio está vigente. Las reorganizaciones de Netskope (`NSK-IA-001`) y
de CyberArk (`CA-IA-001`) están cerradas; el menú real es el de `source.ts`.
La propuesta de arriba se conserva como registro de la decisión: Acceso es
solo la antigua Relaciones, e Identidades sigue como hub propio.

## Conexiones: retiro de Cobertura de cliente (2026-10-11)

La vista agregada «Cobertura de cliente» se retiró del menú, buscador y guía:
mostraba conteos y trazabilidad sin permitir abrir las personas con brecha.
`/connections/coverage` se conserva como URL anterior de Personas y redirige
a `/chains/person`. La evidencia individual del cliente Netskope permanece en
el panel de cada persona, con los mismos permisos de ambas fuentes y sus
estados de frescura. El backend conserva el contrato y cálculo `CONN-001`;
las preferencias descartan la vista retirada y rechazan nuevas referencias a
ella. No se modificaron integraciones ni se requiere migración.

## Netskope: explicar el índice de confianza (2026-10-11)

La lista antes presentada como «Confianza de usuarios (UCI)» se llama
«Usuarios con señales de riesgo». La columna dice «Índice de confianza» y
muestra la escala 0–1000 y su sentido: menor puntaje, mayor riesgo. La ayuda
explica UCI (User Confidence Index), el origen Netskope, la población limitada
a confianza baja/moderada y la ausencia de una garantía sobre cuentas no
listadas. La variación semanal distingue «Mejora», «Empeora» y «Sin dato».
Usuarios, Postura y las etiquetas de permisos usan el mismo vocabulario.
No cambian las rutas, permisos, calificaciones del proveedor ni capturas.

Referencia de semántica: [Netskope, User Confidence Index](https://www.netskope.com/blog/detecting-ransomware-using-machine-learning).

## Netskope: revisión de usuarios y ficha (2026-10-12)

Usuarios conserva `/netskope/experience` y su URL anterior. La búsqueda superior
abre la ficha de una persona. «Para revisar» presenta una única cola de hasta
50 usuarios; «Por empresa» compara cantidades y proporciones con la última
semana anterior disponible, indicando su fecha. No se apilan ambas tablas.
La ficha se abre desde la cola o la búsqueda y conserva pestaña y foco al cerrar.

«Rendimiento digital» reemplaza «Experiencia» en este recorrido: puntaje ADEM
0–100 (mayor es mejor), ventana de 24 h y componentes equipo, red y aplicaciones.
El componente menor orienta la revisión, sin afirmar causa raíz. La cola usa
hasta 100 usuarios devueltos por ADEM, sin equivaler a la población completa ni
confirmar una falla. La confianza conserva su escala 0–1000 y su cambio semanal.
Las fechas de consulta se distinguen de las lecturas y los períodos de fuente.

Sin ID de inventario, sólo una búsqueda completa con correo exacto y único
habilita equipos y anomalías; las respuestas ambiguas o truncadas conservan
«Sin una identidad única». Sin permiso UBA no se consultan confianza, cola,
empresas ni anomalías; la búsqueda, los equipos y el rendimiento siguen disponibles.
No cambian contratos de integración, endpoints, captura ni permisos. No requiere migración.

## Netskope: Administradores (2026-10-14)

Pregunta: «¿quién administra Netskope y con qué permisos?». Persona: quien revisa
el acceso privilegiado del tenant. Una pestaña por entidad: Administradores (una
tabla con rol, estado, tipo, último acceso y MFA, con «Activos sin rol» y
«Cuentas de servicio» como filtros rápidos) y Roles (una tabla con administradores
observados y grupos de API por nivel). Abrir un rol reemplaza la tabla por sus
permisos y las páginas de la consola que abre cada grupo; no se apilan dos tablas.
La explicación va en un «?» y en la guía. Vista estricta: sólo
`netskope:admin_inventory_read`. No muestra credenciales ni quién creó o editó un rol.

## Netskope: acceso del panorama al detalle (2026-10-16)

«Usuarios» (hoy «Riesgo») abre la revisión de riesgo; el rendimiento vive en «Rendimiento» desde el 2026-10-19; Inventario distingue «Registro de
equipos» y «Registro de usuarios», con el estilo compartido de subnavegación y enlaces reales.
La sección activa conserva los filtros; «Desde la última sync» abre Cambios.
UCI se presenta como «Confianza (UCI)», separado del rendimiento digital ADEM.

## Barra de secciones por plataforma (2026-10-16, `UX-NAV-001`)

CyberArk y Netskope muestran sus vistas como una barra arriba del título, con la
sección actual marcada y los permisos del catálogo. Cada pestaña muestra al pasar
el mouse o enfocarla un cartel chico con la pregunta que responde. Esas plataformas
no repiten esa lista en el encabezado: ahí el botón «Accesos rápidos» muestra las
vistas fijadas y recientes de cualquier herramienta, con su marca. En Conexiones y
Administración el selector conserva todas sus vistas. Los accesos rápidos tienen un
total que crece con las plataformas (tres por plataforma activa: seis hoy) y la
persona los reparte como quiera, incluso todos en una herramienta; el backend sólo
limita el tamaño guardado. La herramienta declara la barra con `sectionNav` en su
`source.ts`. La ubicación y los accesos rápidos nombran la plataforma («CyberArk»,
«Netskope»), no la herramienta interna (PAM, Identity Administration, SIA).
