---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-12
---

# Barrido de código sin consumidores

Se revisaron imports del frontend desde `main.tsx`, incluidos imports dinámicos
literales, exports sin referencias en producción, imports Python y funciones
sin consumidores en `backend/app` y `scripts`. Los candidatos se contrastaron
con tests, routers y registros de fuentes. El análisis estático sirve para
encontrar candidatos; no demuestra que todo código restante sea necesario.

## Retirado

- Pantalla antigua `netskope-chains-workspace.tsx`, sus columnas y estilos
  exclusivos. El router actual lleva al inventario; PAM conserva su explorador.
- `use-chain-explorer.ts` y helpers de su recorrido secuencial. Los enlaces
  actuales y la compatibilidad con enlaces anteriores siguen en `chain-columns.ts`.
- Helpers y tipos de la pantalla retirada de políticas observadas.
- Wrappers frontend sin llamadas: listado de POPs de Netskope, detalle SIA,
  carga combinada del dashboard PAM, agenda global de ingestión y listado
  antiguo de usuarios. Se conservan las llamadas activas de cada módulo.
- Etiqueta de severidad PAM sin consumidores.
- Cliente `get_dlp_alert_page` de exportación DLP cruda y su campo de settings.
  Sólo lo ejercitaba su test; la captura usa `get_dlp_incident_page`.
- Matching Netskope en memoria sin imports de producción. El matching vigente
  sigue en `netskope_chain_expand.py`, con sus consultas de unicidad.
- Helper de agenda anterior `effective_interval_minutes` y overview sin llamadas.
  El scheduler conserva `effective_task_interval_minutes` y su prueba de
  precedencia administrativa, por tarea, por fuente, por política y global.
- Tests que sólo sostenían las piezas retiradas. Las pruebas de recorridos
  activos permanecen.

## Conservado por contrato o uso vigente

- Conteos de alertas de 7/30/90 días y dimensiones que los alimentan.
- Pantalla, API y captura de incidentes DLP mínimos; UCI y ADEM.
- Fuentes registradas y herramientas cuyo contrato está aprobado, aunque sean
  opcionales o no estén configuradas en un entorno concreto.
- Endpoints públicos registrados, incluido políticas observadas y POPs. Retirar
  su wrapper frontend no autoriza a eliminar el contrato HTTP o datos históricos.
- Señal `dlp_export_configured`, que informa configuración heredada sin consumir
  la exportación cruda.
- Declaraciones ambientales como `vite-env.d.ts`, modelos generados y migraciones.
- Helpers usados para verificar límites de seguridad y consultas de hallazgos:
  requieren revisar esa cobertura antes de eliminarlos sólo por no tener caller
  de producción.

No hay cambios de esquema, eliminación de datos, migraciones ni retiros de fuentes.
La limpieza se mantiene separada de los cambios concurrentes del editor de métricas.

## Validación

Typecheck frontend, pruebas de columnas y helpers activos de cadenas, y 55 tests
focalizados de cliente Netskope, agenda y hallazgos: correctos.

`npm run verify` completó compilación, lint, los 1.599 tests backend con PostgreSQL
efímero y probes. Se detuvo en una regla CSS huérfana que quedó al retirar la
pantalla; se eliminó y se repitió correctamente el control de estilos.
Los pasos restantes se completaron por separado: tipos generados, build,
trackers, documentación y `git diff --check`.

De los 90 archivos de tests frontend, 89 pasaron en el sandbox. El archivo del
runner E2E requiere procesos Node anidados: se repitió fuera del sandbox y
pasaron sus tres casos. La comprobación de tipos generados también se repitió
fuera del sandbox por un bloqueo `EPERM` al lanzar Python. No se ejecutó la
suite E2E de navegador para esta eliminación de código sin consumidores.
