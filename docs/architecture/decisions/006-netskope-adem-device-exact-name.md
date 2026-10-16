---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-11
---

# ADR 006 — Equipo ADEM ↔ equipo del inventario Netskope por nombre exacto único

## Contexto

Netskope entrega dos listas de equipos de un usuario sin un identificador común. El inventario (`clientstatus`) trae ubicación (On-Premises Detection), client config y última señal; ADEM
(`adem/users/device/getlist` y `getaggregatedscores`) trae puntajes (general, equipo, red, aplicaciones) y POP, con un `deviceId` propio. Hasta ahora el contrato prohibía vincularlos por nombre
(`NSK-ADEM-USERPOP-001`), así que la ficha del usuario mostraba el mismo equipo en tablas separadas.

## Decisión

Un equipo ADEM se une al equipo del inventario del mismo usuario cuando su `deviceName` es **exactamente igual, sin distinguir mayúsculas ni espacios en los extremos, y único en ambos lados**: un
nombre repetido en cualquiera de las dos listas del usuario no vincula a ninguno. El nombre del inventario es `attributes.hostname` o, si falta, `display_name`. Se implementa **sólo** en
`backend/app/netskope/sse/services/netskope_device_link.py`; la ruta de puntaje devuelve el `inventory_device_id` del vínculo o `null`.

## Aprobación

2026-10-11, dueño del producto, para la ficha de usuario de Experiencia digital (`NSK-IA-001`).

## Límites

- Es una referencia por nombre, no un vínculo confirmado: la pantalla lo rotula «vinculado por nombre exacto».
- Solo dentro del mismo usuario (el inventario por `observed_user_id` y la lista ADEM de ese usuario); nunca entre usuarios ni para métricas, KPIs, agregados ni filtros del inventario.
- No persiste el vínculo. Sin coincidencia única, cada lado se muestra por separado y el dato ausente es «Sin dato», nunca 0.
- No cambia que `deviceId` ADEM sea un identificador distinto del `source_id` del inventario.

## Cumplimiento

`backend/tests/netskope/test_netskope_device_link.py`.
