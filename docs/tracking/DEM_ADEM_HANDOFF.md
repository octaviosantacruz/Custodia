---
estado: histórico
dueño: Octavio Santacruz
revisado: 2026-09-30
---

# DEM / ADEM de Netskope — nota de continuidad

**Estado al 2026-09-30.** Trabajo local en `feat/netskope-dev`. Esta nota
separa hechos comprobados en el tenant, ejemplos del Swagger aportados por el
dueño del producto e implementación local. No sustituye el contrato canónico
de `docs/architecture/integration-contracts.md` ni el tracker
`docs/tracking/TO_IMPLEMENT.md`. Los cambios recientes de Experiencia digital
siguen **sin commit** en el worktree; no asumir que están desplegados.

## Incremento validado el 2026-09-30

El dueño del producto aportó los requests y ejemplos 200 de `getlist` y
`getdetails`. El probe read-only confirmó HTTP 200 en ambos, `userLocation:
[]` aceptado, un dispositivo y su ID literal común en una ventana de 2 h,
`pop` poblado y `lastActivity` entero de segundos Unix. También se observó
una lista vacía para otro usuario. `poplist` respondió 200 con 18 códigos.
No se publicaron correo, nombre de equipo, IDs reales, IP ni coordenadas.

**Limitación observada:** `lastActivity` quedó unos 24 minutos posterior al
reloj de consulta. Se conserva como actividad *informada* y se marca
`outside_window`; no se toma como conexión actual ni frescura confirmada.
Su semántica temporal requiere aclaración del tenant.

Implementación local: buscador de usuarios en Experiencia digital, selector
explícito de dispositivos ADEM y detalle por dispositivo/ventana; también
disponible en el drawer de usuarios Netskope. El backend valida usuario
activo y fuente, IDs literales y pertenencia del dispositivo en la misma
ventana; sólo retorna ID/nombre/SO, POP, timestamp, procedencia y período.
Sin persistencia ADEM ni migración. `getentities`, métricas, mapa y agregados
por POP continúan fuera de alcance. Las secciones siguientes conservan el
contexto del handoff original del 2026-09-29, previo a este incremento.

## Objetivo de producto

Sustituir la vista de inventario de “Sitios DEM”, de escaso valor operativo,
por **Experiencia digital**. La pregunta prioritaria es: para un usuario y su
dispositivo Netskope, ¿qué POP informó ADEM como punto de salida y cuándo se
observó? Más adelante interesan volumen, sesiones, steering, latencia
endpoint→POP y POP→aplicación, siempre que cada métrica tenga fuente,
denominador y ventana comprobados. No presentar estos datos como conexión en
vivo ni deducir salida por IP o por el nombre del POP.

## Qué existe hoy y con qué evidencia

| Superficie | Evidencia | Estado en Custodia |
|---|---|---|
| `GET /api/v2/dem/config/sites` | Probe read-only del tenant: `200`, tres sitios. Swagger: array JSON directo; nombres, IDs, revisión, timestamps, conteos y `pop_tracing`. | Inventario técnico opt-in en corrida Netskope mediante `NETSKOPE_DEM_SITES_PATH=/api/v2/dem/config/sites`, migración 070 y allowlist estrecha. Falta activar y comprobar primera captura real. No es una métrica de experiencia. |
| `GET /api/v2/adem/poplist` | Swagger aportado: `starttime`/`endtime` Unix requeridos; máximo 48 h dentro de 30 días; `prefix` opcional; ejemplo `{ "pops": ["US-NYC1"], "totalCount": 1 }`. | Implementado localmente como consulta read-only `GET /api/cmdb/netskope/experience/pops?hours=2|24|48`. Devuelve códigos y ventana, sin persistir ni vincular usuarios. Falta probar status y forma real con token del tenant. |
| `GET /api/v2/adem/iplist` | Swagger aportado: lista de IPs activas, ordenadas por IP, límite por defecto y máximo de 1000; misma ventana máxima de 48 h. | **No implementado.** No contiene relación IP→usuario→POP; no usarlo para inferir ruta, ubicación o egreso de una persona. |
| `POST /api/v2/adem/users/device/getlist` | Swagger aportado: body con `user`, `starttime`, `endtime` y `userLocation`; ejemplo 200 de array con `deviceId`, `deviceName`, `deviceOs`. | Candidato read-only para seleccionar el dispositivo de un usuario. No implementado ni probado con token del tenant. |
| `POST /api/v2/adem/users/device/getdetails` | Swagger aportado: body con `user`, `deviceId`, `starttime`, `endtime`; ejemplo 200 con `pop`, `lastActivity`, `gateway`, `geo`, `clientStatus` y otros campos de dispositivo. | **Candidato principal** para detalle usuario→dispositivo→POP. No implementado ni probado con token del tenant. La respuesta de ejemplo no prueba que `pop` esté poblado en este tenant ni que equivalga a una conexión actual. |
| `POST /api/v2/adem/users/getentities` | Swagger aportado: paginación `limit`/`offset` (máximo indicado: 100), sort por `expScore`; body de filtros incluye `starttime`, `endtime`, `user`, `pop`, `sourceIp`, `userLocation`, `deviceOs`, `application` y `expScore`. La captura **no muestra completo el schema 200**. | Candidato para listado filtrable de usuarios por POP. No implementar agregados ni paginación hasta ver la respuesta real/schema completo y permisos. |
| `POST /api/v2/adem/users/getapplications` | Swagger aportado: aplicaciones usadas por usuarios activos, con score cuando existe. | Documentado como opción posterior; no resuelve por sí solo usuario→POP. No implementado. |
| `GET /api/v2/dem/query/definitions` | Probe del tenant: `403`. | Métricas DEM RUM/Traceroute/HTTP Measures bloqueadas por scope. Los `POST query/getdataset`/`getentities` de **DEM** siguen sin schema de consulta versionado y no deben ejecutarse aún. |

El probe DEM existente cubrió 15 GET allowlisteados: 11 `200`, 3 `403` y
1 `400`, con límite observado de 4 solicitudes/s. No extrapolar estos status
a los endpoints **ADEM**, que todavía no tienen probe de tenant registrado.

`udp-paris` e `icmp-paris` en `pop_tracing.method` son nombres del método de
traceroute *Paris*, no una ubicación en Francia ni un POP. Los sitios
configurados tampoco son la lista de POPs realmente usados por los usuarios.

## Implementación local de la primera entrega ADEM

- Navegación: `/netskope/experience`, etiqueta “Experiencia digital”; el path
  anterior `/netskope/dem/sites` redirige. Se conservó por compatibilidad el
  ID interno `netskopeDemSites` de preferencias/workspace; **no** significa que
  la nueva vista siga mostrando sitios.
- Integración: `backend/app/integrations/netskope.py` consulta la ruta fija
  `/api/v2/adem/poplist`, acota la ventana a 48 h y valida la forma JSON.
- API: `backend/app/api/routes/cmdb_netskope.py` exige lectura Netskope y
  expone únicamente `pops`, `total`, `window_start`, `window_end`.
- UI: `frontend/src/components/netskope-experience-workspace.tsx` ofrece
  2/24/48 h, estados loading/empty/error y una advertencia explícita: no hay
  usuario por POP, conteo de usuarios por POP, latencia ni IP de egreso.
- Validación local: pasaron tests de cliente y autorización, `npm run verify`
  y el E2E focalizado de ruta heredada, códigos y cambio de ventana. **No hubo
  prueba en vivo de `poplist` ni de los POST ADEM con el token del tenant.**

No se necesita migración para `poplist`: es una consulta bajo demanda. La
migración 070 pertenece exclusivamente al inventario técnico de sitios DEM.

## Siguiente incremento propuesto: recorrido por usuario

1. Confirmar en el tenant, con permiso de sólo lectura, status HTTP y forma
   anonimizada de `getlist` y `getdetails` para **un usuario y una ventana
   corta**. No compartir token, correo real, IP pública/privada ni coordenadas.
   Si alguno devuelve `401/403`, registrar el scope faltante y no simular la
   funcionalidad.
2. Validar que `deviceId` de `getlist` funciona literalmente en `getdetails`,
   que `pop` y `lastActivity` están poblados, y que la unidad/semántica del
   timestamp es la esperada. Varios dispositivos pueden tener POPs distintos;
   conservar la relación por dispositivo y ventana, no elegir uno arbitrario.
3. Sólo entonces agregar un detalle bajo demanda desde un **usuario Netskope**:
   usuario → dispositivo → POP informado, último evento y, si se aprueba,
   ubicación de país/región agregada. Etiquetar procedencia y frescura; estado
   desconocido cuando no haya dato. No persistir IP, coordenadas ni payload
   completo. No unir ADEM con otros proveedores por nombre/hostname.
4. Para un listado “usuarios que salieron por POP”, obtener el schema 200
   completo y paginación real de `POST /adem/users/getentities`; verificar que
   su filtro `pop` y sus filas establecen esa relación explícitamente. No
   derivar conteos de `poplist` ni de `iplist`.
5. Métricas de rendimiento, volúmenes, sesiones y mapa geográfico quedan
   apartados hasta aprobar sus contratos de datos y niveles de agregación.

**Pedido mínimo al dueño del tenant para reanudar:** status `200`/`403` de
`getlist` y `getdetails`, un ejemplo 200 **anonimizado de respuesta real** de
cada uno (conservando nombres de campos, tipos y nulos), y el schema 200
completo de `getentities` si se quiere la tabla por POP. No hace falta ni se
debe enviar el token. Los ejemplos de Swagger son contrato candidato, no
evidencia de disponibilidad ni contenido real.
