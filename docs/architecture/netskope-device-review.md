---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-13
---

# Propuesta: diagnóstico y seguimiento de equipos Netskope sin eventos

> **Actualización 2026-10-13 (`NSK-INV-002`, decisión del dueño):** la clasificación manual salió de las
> pantallas. Con miles de equipos sin señal y sin una fuente corporativa de uso (`NSK-DEVREV-003`), pedirle a
> una persona que decida equipo por equipo no es viable. Postura muestra los equipos sin señal agrupados por
> lo que explica Netskope (desinstalación informada, reemplazo, registro histórico, sin explicación), de solo
> lectura, y cada grupo abre exactamente sus equipos. Se retiraron el formulario, el lote de sugerencias, la
> columna y los filtros de diagnóstico y los widgets `devices_stale_unclassified` y `devices_stale_by_diagnosis`.
> La tabla `netskope_device_reviews` y sus decisiones se conservan; las rutas de escritura quedan sin uso desde
> la interfaz y son candidatas a retiro.

Fecha: 2026-10-05 (revisada). **Estado: aprobado por el dueño; Fases 1 y 2 implementadas (2026-10-05/06)** (`NSK-DEVREV-001`, ver [tracker](../tracking/TO_IMPLEMENT.md#revisión-de-equipos-sin-eventos--nsk-devrev-001-aprobado-2026-10-05)). El permiso dedicado queda para después; la Fase 1 escribe con `netskope:admin`.

Antes de la Fase 1, DS Hub muestra la antigüedad y el estado `review` de cada equipo, pero no
hay forma de clasificarlos, asignarlos ni registrar qué se decidió. Este
documento define esa clasificación (`NSK-DEVREV-001`) para dar granularidad al
grupo de equipos sin eventos.

No cambia el contrato vigente de [métricas Netskope](netskope-metrics.md#heartbeat-retirado-nsk-hb-001-2026-10-05).

## Problema y objetivo

Después de `NSK-HB-001`, un candidato a revisión es un dispositivo activo con
último evento válido de más de 30 días y una última corrida Netskope completa
de las últimas 24 h. La tarjeta `devices_stale_30d` cuenta antigüedad aun cuando
la evaluación no está disponible, indicando la vigencia del sync.

El inventario inspeccionado el 2026-10-05 (solo lectura, conteos agregados,
sync completo vigente) tenía **8.955 equipos activos y 4.037 con esa antigüedad**
(45 %). Son referencias de esa fecha, no valores para fijar en la UI. La sección
"Desglose medido" indica qué contiene ese grupo.

El objetivo es reducir casos sin explicación y resolver incidencias reales.
La antigüedad seguirá visible: clasificar un caso no demuestra que volvió a
reportar ni modifica el dato recibido de Netskope.

## Desglose medido (2026-10-05)

Consulta de solo lectura sobre los 4.037 equipos con último evento válido de más
de 30 días. Los grupos son vistas distintas y se solapan; no se suman.

| Pregunta | Resultado | Lectura |
|---|---|---|
| ¿Cuánto hace? | 30–90 d: 835 · 90–180 d: 647 · 180–365 d: 1.953 · más de 365 d: 602 | 2.555 (63 %) superan 180 días: son registros históricos, no equipos que "dejaron de reportar ayer" |
| ¿Cuál fue el último evento? | Tunnel Down 1.724 · Tunnel Up 1.538 · System Shutdown 303 · Change in Network 100 · otros ≤ 100 cada uno | Casi todos terminaron con un evento de operación normal: no hay causa declarada |
| ¿Hubo desinstalación o deshabilitación informada? | Disconnected By Uninstall 92 · Uninstalled 52 · Admin Disabled 14 = **158 (3,9 %)** | Es la única evidencia explícita; el 96 % restante no dice por qué dejó de reportar |
| ¿Tiene usuario informado? | 4.036 de 4.037 | Nombre de usuario presente, sin que eso pruebe que lo siga usando |
| ¿Clasificación Netskope? | Unmanaged 3.739 · Managed 209 · Unknown 88 · Not Configured 1 | Casi todo el grupo es "Unmanaged" |
| ¿El usuario tiene otro equipo con evento en los últimos 7 días? | 1.547 (38 %) | Indicio débil: no prueba que el equipo antiguo siga en uso |
| ¿Hostname idéntico en un registro reciente? | 996 (25 %) | Insuficiente por sí solo: nombres genéricos o de imagen compartida pueden coincidir |
| ¿Hostname **y** usuario idénticos en un registro reciente? | **57 (1,4 %)**, todos con una única coincidencia | Es el único grupo de "posible reemplazo" con evidencia razonable |
| ¿`guid` compartido con otro registro? | **0** | El `guid` es distinto en cada registro: no sirve para unir una reinstalación con su registro anterior |
| ¿Hostname repetido dentro del mismo grupo antiguo? | 1.017 (25 %) | Reinstalaciones sucesivas o nombres genéricos; sin identidad de equipo no se distinguen |

Consecuencias para la propuesta:

- La hipótesis de **reemplazo** explica una fracción pequeña (57 con hostname y
  usuario). Descartar el resto como "reemplazado" no tiene respaldo.
- La **desinstalación informada** (158) es la única categoría con evidencia
  directa de Netskope; es útil para priorizar, pero no cierra el caso (ver
  límites).
- La gran mayoría (más de 3.800) quedaría en "sin evidencia suficiente" con las
  fuentes actuales. Sin una fuente independiente de uso, la clasificación por
  caso no reduce el volumen: ordena la cola, no la vacía.
- El `guid` no ofrece la identidad estable que la propuesta quería verificar. La
  comprobación de identidad entre registros requiere otra fuente.

## Diseño: clasificación humana con sugerencia por evidencia

Se reutiliza el patrón de la clasificación de Safes (`cyberark_safe_metadata`):
la decisión humana vive en una tabla propia y ningún sync la toca. Hay tres
capas independientes, que nunca se mezclan en un mismo número:

1. **Observación** (existe): antigüedad del último evento, `devices_stale_30d`.
2. **Sugerencia** (calculada, no se guarda): categoría propuesta por reglas
   deterministas sobre la evidencia disponible, con su motivo. Es una ayuda.
3. **Decisión** (guardada): lo que operaciones confirmó, con actor, fecha,
   referencia y nota. Solo esta capa cuenta como clasificado.

Una sugerencia nunca se convierte en decisión sola. Aceptarla es una acción
humana auditada, individual o por lote.

### Diagnóstico (qué le pasó al equipo)

Un solo valor por equipo; es la granularidad que se pide:

| Código | Nombre | Cuándo se asigna | Sugerencia automática |
|---|---|---|---|
| `uninstalled_reported` | Desinstalación o deshabilitación informada | El último evento es `Uninstalled`, `Disconnected By Uninstall` o `Admin Disabled` | Sí: 158 hoy |
| `replaced` | Registro reemplazado | Existe un registro reciente del mismo hostname y usuario (único) | Sí: 57 hoy, como "posible" hasta confirmar |
| `decommissioned` | Baja confirmada | Referencia de baja del activo | No: solo humana, con referencia |
| `in_use_not_reporting` | En uso, sin reporte | Alguien confirma que el equipo se usa; hay que recuperar el cliente | No: solo humana (no hay fuente de uso) |
| `historical_record` | Registro histórico sin evidencia | Más de 180 días sin evento y sin ninguna de las señales anteriores | Sí, solo como segmento: 2.434 hoy. No es una baja |
| `temporary_exception` | Excepción temporal | Reparación, reserva u otro motivo con aprobador y vencimiento | No: solo humana |
| `undetermined` | Sin determinar | Valor inicial; también si la evidencia es ambigua | Por defecto |

Reparto medido hoy con la precedencia de arriba: 203 con evidencia propia
(158 desinstalación + 57 reemplazo, 12 en ambos), 2.434 `historical_record` y
1.400 de 30–180 días que quedan `undetermined` y son los que más probablemente
sigan en uso. La suma da los 4.037.

`historical_record` es la categoría que da granularidad al grueso del grupo sin
fingir una causa: dice "esto es antiguo y no tiene evidencia", no "se dio de baja".

### Estado de seguimiento (en qué punto está el trabajo)

`pending` → `investigating` → `ticket_open` → `resolved`. Es independiente del
diagnóstico: un `in_use_not_reporting` puede estar `ticket_open`; un
`historical_record` puede quedar directo en `resolved` tras la revisión por lote.

Una `temporary_exception` vence: al pasar la fecha el equipo vuelve a
`pending`. Un caso `resolved` cuyo equipo vuelve a reportar (último evento
reciente) se muestra como **"volvió a reportar"**, calculado al leer, sin
modificar la decisión guardada.

### Datos guardados

Tabla `netskope_device_reviews` (migración nueva, no edita ninguna anterior):

- clave: `object_id` del equipo en `cyberark_inventory_objects` (los equipos
  nunca se borran físicamente; un retiro por sync no elimina la decisión);
- `diagnosis`, `status`, `owner` (responsable), `reference` (ticket o referencia
  de baja), `note`, `exception_expires_at`, `next_review_at`;
- `evidence`: instantánea JSON de lo que se vio al decidir (último evento, edad,
  coincidencia usada), para poder auditar la decisión aunque el dato cambie;
- `decided_by`, `decided_at`, `created_at`, `updated_at`.

El historial de cambios es el registro de auditoría existente
(`entity_type = 'netskope_device_review'`, con el estado anterior y el nuevo),
escrito en la misma transacción (`record_audit(..., connection=conn)`); no hay
una tabla de eventos aparte. La clave tiene `ON DELETE RESTRICT`: el inventario
nunca borra equipos y una decisión no puede perderse en silencio. Ningún sync
escribe en esta tabla.

**"Sin clasificar" y `undetermined` son lo mismo:** un equipo sin decisión y un
equipo con diagnóstico "sin determinar" cuentan igual en filtros y conteos.

### Permisos

Lectura con `netskope:read`. Escritura con `netskope:admin`, como los baselines
de Netskope. Un permiso dedicado (`netskope:review`) queda para más adelante:
sólo cambiaría la dependencia de la ruta de escritura y el control del drawer.

### Interfaz (escritorio)

Fase 1 entrega el bloque del drawer, la columna y los filtros del inventario y
el panel de Postura. La Fase 2 agrega la sugerencia con su motivo, el filtro de
sugerencia, los drills de atención y la aceptación en lote.

### Sugerencias y lote (Fase 2, `NSK-DEVREV-002`)

La sugerencia se calcula en SQL (`suggestion_sql`), no se guarda, y existe sólo
con un sync completo vigente, para un equipo sin clasificar y con evidencia que
informó Netskope. Precedencia: 1) último evento de desinstalación o
deshabilitación; 2) un único registro reciente (7 días) con el mismo hostname y
usuario, sin distinguir mayúsculas; 3) más de 180 días sin eventos y sin otra
señal. Un hostname o un usuario solos no sugieren nada, y heartbeat,
`user_status` y `guid` no participan.

El lote para aceptar sugerencias (`POST .../device-reviews/accept-suggestion`) y las
rutas por equipo (`GET`/`PUT .../devices/{object_id}/review`) se retiraron el
2026-10-13 junto con la clasificación manual (`NSK-INV-002`). Las decisiones ya
guardadas siguen en `netskope_device_reviews` y en los filtros del listado.

Los conteos de Postura tienen su filtro exacto en el listado:
`review_attention=open_incident|expired_exception|reported_again` y
`review_suggestion`. El tablero personal ofrece «Equipos sin eventos sin
clasificar» (evaluación: nula sin sync vigente) y «Equipos sin eventos por
diagnóstico» (observación), ambos con los filtros del widget en su drill.

- **Drawer del equipo:** bloque "Revisión" con la sugerencia y su motivo, y los
  campos diagnóstico, estado, responsable, referencia y nota.
- **Inventario:** filtros "Diagnóstico" y "Seguimiento", y un filtro de
  "Sin clasificar". Se combinan con los filtros actuales (antigüedad, último
  evento, clasificación).
- **Acciones por lote** desde el listado filtrado: aplicar un diagnóstico a
  *exactamente* los equipos que muestra el listado. Antes de confirmar se
  muestra la cantidad y un resumen de evidencia; el backend recibe la cantidad
  esperada y rechaza si cambió. Lote máximo acotado, nota obligatoria, un solo
  evento de auditoría por lote con la lista de equipos. Solo se permiten lotes
  de diagnósticos que tienen sugerencia automática (`uninstalled_reported`,
  `replaced`, `historical_record`); `decommissioned`, `in_use_not_reporting` y
  `temporary_exception` se asignan de a uno o con referencia común explícita.
- **Postura:** panel "Diagnóstico de equipos sin eventos" con el reparto por
  diagnóstico (cada fila abre exactamente esos equipos), el contador "Sin
  clasificar" y, como texto sin drill, incidencias abiertas, excepciones vencidas
  y equipos que volvieron a reportar tras una decisión (sus poblaciones no
  coinciden con un único filtro del listado).
- **Tablero personal:** dos widgets en el selector de inventario (ver Fase 2).

### Métricas

| Indicador | Pregunta | Regla |
|---|---|---|
| Sin eventos hace más de 30 días | ¿Cuántos registros conservan esa antigüedad? | `devices_stale_30d`, sin cambios; no depende de la clasificación |
| Sin clasificar | ¿Cuántos no tienen una decisión? | Candidatos a revisar sin decisión vigente; el drill conserva filtros |
| Por diagnóstico | ¿Cómo se reparte lo clasificado? | Conteo por `diagnosis` entre candidatos; `historical_record` y `uninstalled_reported` se muestran aparte de las incidencias |
| Incidencias abiertas | ¿Cuántos equipos en uso hay que recuperar? | `in_use_not_reporting` con estado distinto de `resolved` |

Son vistas distintas; no se suman. Clasificar no cambia la antigüedad observada
ni quita al equipo de `devices_stale_30d`. Con sync vencido, parcial, fallido o
en curso la evaluación de "Sin clasificar" queda no disponible, como en
`NSK-HB-001`; las decisiones guardadas siguen visibles con su fecha.

### Reglas de seguridad de datos

- Ninguna sugerencia usa heartbeat, `user_status` ni ADEM.
- El hostname y el usuario solo sugieren; nunca confirman ni fusionan registros.
- El `guid` no se usa: es distinto en cada registro (0 compartidos).
- Fechas inválidas, un sync no vigente o una coincidencia ambigua no producen
  sugerencia.
- Una baja confirmada con actividad posterior muestra una inconsistencia; no se
  revierte la decisión.
- Resolver un caso no da de baja nada en Netskope desde DS Hub.

## Entrega por fases

1. **Fase 1 — clasificación manual:** migración, API con auditoría, bloque en el
   drawer, filtros de inventario, métricas "Sin clasificar" y "Por diagnóstico".
   Permite clasificar de a uno y ver el avance.
2. **Fase 2 — sugerencias y lotes:** reglas deterministas con su motivo y la
   acción por lote sobre el listado filtrado. Es donde se reduce el volumen real
   (158 + 57 + segmento histórico).
3. **Fase 3 — fuente de uso:** solo si el dueño elige y contrata una fuente
   corporativa con identidad de equipo; habilita sugerir `in_use_not_reporting`.
   Criterios acordados antes de construir (2026-10-06):
   - **Sondeo de solo lectura primero.** Informa coincidencias únicas,
     ambigüedades y equipos sin vínculo; no hay umbral mínimo de cobertura
     predefinido. Con el resultado se decide si la fuente sirve (un vínculo
     parcial puede aportar valor).
   - **Ventana de actividad:** propuesta (7 días), se acuerda según la
     frecuencia y la semántica de la fuente real.
   - **Baja:** solo un estado que represente explícitamente una baja corporativa
     del activo, con su referencia conservada. Un borrado del dispositivo
     (`wiped`) o la ausencia en la fuente no cuentan.
   - **Evidencias coexistentes:** "cliente desinstalado" y "equipo activo ayer"
     se muestran ambas; la precedencia decide la sugerencia, no oculta la otra
     evidencia.
   - **Integración completa:** aprobación de la fuente, permisos de lectura
     propios, persistencia aislada por `source_system`, vínculo entre fuentes
     como excepción sancionada y evidencia visible solo con acceso autorizado.

## Pruebas de cierre

- El sync no modifica ni borra una decisión, incluso si el equipo se retira.
- Cada escritura exige permiso y deja auditoría en la misma transacción.
- La sugerencia coincide con una consulta independiente sobre datos sembrados
  (límites de 180 días, evento de desinstalación, coincidencia única y ambigua).
- Un lote aplica exactamente la lista mostrada y rechaza si la cantidad cambió.
- Una excepción vencida vuelve a `pending`; un equipo que vuelve a reportar se
  muestra como tal sin alterar la decisión.
- El conteo de la tarjeta es igual al del drill, con filtros y con sync no vigente.

## Qué se puede estudiar con lo actual

DS Hub ya conserva último evento y timestamp, hostname, usuario informado,
clasificación, `guid` (único por registro, ver desglose), capturas e
identificadores Netskope. El inventario ya permite abrir cada grupo por
antigüedad y por último evento con los filtros de dispositivos existentes
(antigüedad del último evento, último evento reportado y clasificación
Netskope); lo que falta no es la vista sino la evidencia.

Las Fases 1 y 2 ya permiten seguimiento operativo; todavía no existe una
comprobación independiente de uso del mismo equipo. `user_status` tampoco debe utilizarse
sin corregir su mapeo y verificar su semántica en el contrato real.

ADEM no se usará como comprobación automática: el contrato actual no confirma
la correspondencia de sus dispositivos con SSE y la semántica de `lastActivity`
tiene una observación pendiente. Ver [Experiencia digital: ADEM](netskope-api.md#experiencia-digital-adem).
No se habilitan proveedores, integraciones o joins adicionales por esta propuesta.

## Decisiones pendientes del dueño

- Aprobar el catálogo de diagnósticos, en especial `historical_record` (¿180
  días es el corte correcto?) y si debe permitirse en lote.
- Decidir si basta `netskope:admin` o se crea `netskope:review`.
- Elegir quién confirma bajas y reemplazos y con qué referencia.
- Definir el vencimiento máximo de una excepción y el plazo de revisión.
- Aprobar la Fase 1 como primer alcance y registrar `NSK-DEVREV-001` en
  `tracking/TO_IMPLEMENT.md` con estas pruebas de cierre.

## Avance sin una fuente externa

El dueño confirmó **JumpCloud MDM y Cortex** como sistemas disponibles, pero
pospuso integrar sus inventarios. Son candidatos para la Fase 3; no constituyen
un contrato aprobado. Falta precisar el producto de Cortex, permisos, identidad,
semántica de actividad y baja. `NSK-DEVREV-003` permanece **Externo**.

Mientras tanto, Postura ofrece **Sin sugerencia automática**, una cola de revisión
manual: inventario activo Netskope, último evento válido de más de 30 días,
sin diagnóstico humano distinto de `undetermined` y sin ninguna sugerencia
actual. El filtro API es `review_suggestion=none`, conserva los filtros del
inventario y requiere un sync completo de las últimas 24 h. Sin sync vigente,
el conteo indica «No disponible»; el filtro no devuelve equipos. No es un
diagnóstico y no puede aceptarse en lote.

Operaciones abre la cola, revisa cada registro, contrasta con una referencia
operativa y guarda su decisión, responsable y próximo seguimiento cuando
corresponda. Si no consigue evidencia, mantiene «Sin clasificar». La ausencia
de sugerencia no demuestra uso ni baja, y clasificar no cambia la antigüedad
observada ni da de baja el equipo en Netskope.

Lectura de datos reales del 2026-10-06 UTC: 4.038 candidatos, 2.638 sugerencias
y 1.400 sin sugerencia, sin decisiones humanas guardadas. Estos son datos de
esa captura, no valores fijos del producto. La proyección actual conserva
`device_id` y `guid`, pero no serial, UUID de hardware ni IDs de MDM/EDR.
Su unicidad no prueba que compartan identidad con JumpCloud o Cortex. Los
hostnames repetidos impiden usar el nombre como vínculo automático entre
fuentes. El futuro sondeo deberá verificar una clave común, exacta y única.
