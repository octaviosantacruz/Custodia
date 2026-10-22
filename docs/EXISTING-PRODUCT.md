---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Producto existente: qué preservar y cómo extenderlo

**Dirección aclarada por el dueño el 22/10:** inventario de herramientas de
ciberseguridad —Netskope, CyberArk, CrowdStrike y otras—, con cruces e
inferencias, priorizando la experiencia ya construida. La UI React anterior
es la base del producto. Cambiar Python por Go no requiere reemplazarla.

Esta revisión sigue código de `/home/saint/projects/Custodia`, `f6a7acc`.
Las rutas siguientes pertenecen a ese checkout, conservado limpio; no son
archivos presentes en el árbol reducido del producto. Se pueden consultar
con `git show f6a7acc:RUTA`. No se consultaron inventarios ni APIs laborales.

## Lo que ya existe y no representó la demo reducida

| Capacidad | Evidencia de código | Qué preservar |
|---|---|---|
| Registro de herramientas | `backend/app/source_contract.py`, `backend/app/sources.py`, `frontend/src/source-contract.ts`, `frontend/src/sources.ts` | Cada herramienta declara contratos, tareas, rutas, permisos, vistas y runtime. Extender el registro existente; no reemplazarlo por una tabla genérica. |
| Safes y operación | `frontend/src/cyberark/pam/components/safes-workspace.tsx`, `safe-table.tsx`, `safe-detail-drawer.tsx` | Filtros, selección, cuentas expandidas, acciones por lote, vigentes/retiradas y detalle con Resumen, Cuentas, Miembros, Clasificar e Historial. |
| Lectura y clasificación | `frontend/src/cyberark/pam/hooks/use-safe-detail.ts`, `backend/app/cyberark/pam/repositories/safe_mutations.py` | El detalle reúne tres lecturas; los cambios humanos y su antes/después se auditan en la misma transacción. Conservar contratos HTTP y formularios al portar backend. |
| Ingesta | `backend/app/cyberark/pam/ingestion.py`, `cross/cmdb_sync.py`, `cross/repositories/cmdb_persistence.py` | Validación, duplicados, progreso, captura parcial frente a completa, reconciliación por tipo y conservación de calidad humana. La demo no describe toda esta semántica. |
| Orquestación durable | `backend/app/sync_coordinator.py`, `cross/repositories/sync_queue.py` | Cola, claim atómico, lease/heartbeat y exclusión de fuente con PostgreSQL. Llevar esas garantías al modelo de varias conexiones. |
| Personas entre herramientas | `backend/app/cross/api/routes/chains_person.py`, `cross/repositories/person_chain_queries.py`, `frontend/src/cross/components/person-chains-workspace.tsx` | Búsqueda, ficha por persona, vista radial, evidencia por herramienta y vínculos confirmados, referencias o ambiguos; sólo se consulta lo autorizado. |
| Puentes Identity/PAM/SIA | `backend/app/cross/repositories/identity_pam_bridge.py`, `person_role_access.py` | Resolución por ID o correo único según contrato y recorridos por roles. Las coincidencias por nombre autorizadas son reglas acotadas; no equivalencias universales ni fusiones de inventarios. |
| Cobertura Identity/Netskope | `backend/app/cross/services/person_client_coverage.py`, `cross/repositories/person_client_coverage.py` | Población elegible, fuentes vigentes, vínculo único, dispositivos recientes y estados covered/partial/gap/unknown/not_applicable. No convertir evidencia vieja o ambigua en cero o ausencia de protección. |
| Conexiones y cobertura de destinos | `backend/app/cross/repositories/connection_inventory.py`, `frontend/src/cross/components/connection-inventory-workspace.tsx` | Destinos declarados comparados con cuentas PAM y políticas SIA; capacidades clasificadas, desviaciones, responsable e historial. “Conexiones” aquí no significa configuración de credenciales de API. |
| Postura Netskope | `backend/app/netskope/sse/services/netskope_posture.py` | Hallazgos derivados de consultas concretas; el contador abre la misma población. Distinguir no configurado, sin permiso y evaluado. |
| Experiencia visual | `frontend/src/styles/foundation.css`, componentes `cross/`, registros `source.ts` | Geist/Geist Mono, verde Custodia, temas, controles propios, tablas densas, ayudas, búsqueda y vistas por pregunta. No adoptar la paleta de Portfolio como reemplazo de identidad. |

## Recorridos trazados

**Revisar un Safe.** La tabla abre `useSafeDetail`, que solicita Safe/miembros,
cuentas y auditoría mediante el transporte común `/api`. El drawer permite
revisar y clasificar; `safe_mutations.py` guarda metadatos y auditoría juntos.
La ingesta actualiza los datos externos por su propio camino. Go debe mantener
esa separación y el comportamiento de la UI, no sólo almacenar filas.

**Investigar una persona.** La ruta calcula fuentes legibles antes de
consultarlas. El repositorio reúne resúmenes sin fundir los objetos originales.
Identity→PAM prioriza ID y aplica el contrato de correo único cuando
corresponde; los recorridos de roles conservan sus reglas exactas. La ficha
distingue enlace, referencia, ambigüedad y ausencia de registro.

**Evaluar cobertura.** El contrato Identity/Netskope usa frescura de ambas
fuentes y elegibilidad de población. Si falla la evidencia, devuelve unknown;
si el vínculo válido no tiene dispositivos recientes, devuelve gap con su
alcance preciso. No afirma que toda la seguridad de la persona esté ausente.
Por separado, la cobertura de destinos compara declaraciones con inventarios
PAM/SIA y deja explícito lo no clasificado.

## Estandarizar sin perder la experiencia

1. Recuperar el frontend original como base local del producto y ejecutarlo
   contra respuestas sintéticas de sus contratos HTTP existentes. Conservar
   shell, navegación, componentes, estados y flujos; no conectar datos laborales.
2. Levantar una matriz por flujo de endpoint, request/response, permiso,
   regla, persistencia, auditoría y prueba. Las pruebas y contratos Python
   gobiernan paridad; el fixture de tres recursos no los sustituye.
3. Portar un recorrido completo a Go detrás de la misma API. Propuesta de
   primer recorrido: Personas y cobertura con dos fuentes sintéticas, porque
   muestra inventario, cruce, evidencia y operación sin rediseñar la UI.
4. Extraer configuración de instancias, credenciales, elegibilidad, umbrales
   y clasificaciones del entorno laboral como políticas configurables.
   Conservar valores desconocidos y límites de cada fuente.
5. Agregar herramientas al registro y capacidades de UI. CrowdStrike es una
   herramienta objetivo solicitada; no se encontró adaptador en el código
   revisado ni se declara soporte de su API por esta revisión.

Lugares concretos que necesitan extensión: `SourceSpec.platform` tiene default
CyberArk; los tipos de plataforma/dominio del frontend son cerrados; la vista
radial tiene posiciones, logos y orden fijos para dos plataformas. El SQL de
inventario conserva nombres CyberArk y la clave actual no distingue varias
instancias del mismo origen. Son acoplamientos a resolver preservando el
producto, no razones para descartar sus módulos.

## Cruces e inferencias como capacidad explícita

Mantener inventarios por origen y añadir reglas de relación y conclusiones
sobre ellos. Cada resultado debe explicar entradas, conexiones, IDs, fechas,
regla/versión, fundamento del vínculo y límites. Un hecho observado, una
referencia por nombre, un candidato y una inferencia son estados distintos.
La revisión humana puede confirmar o rechazar una propuesta sin cambiar la
observación original. No inventar un porcentaje de confianza universal.

Ejemplo futuro: investigar la presencia de un mismo equipo en Netskope y
CrowdStrike. Primero se aprueba cómo resolver su identidad y qué fuentes y
ventanas prueban la población esperada. “No observado en esa captura” sólo
puede producir una brecha con ese contrato; una fuente incompleta produce
“no evaluable”. Es un caso candidato, no una integración ya construida.

Las reglas específicas existentes conservan su significado en la referencia;
en el producto nuevo se versionan y configuran por alcance. Hacer cruces no
implica autorizar una consulta que revele datos de fuentes que el actor no
puede leer.

## Verificación de esta revisión

Se ejecutaron 24 tests Python: `test_person_client_coverage`, `test_cmdb_sync`,
`test_person_view_isolation` y `test_person_role_access_isolation`; todos
pasaron, con datos sintéticos/mocks y comprobaciones de aislamiento de código.
Pasaron cuatro archivos TypeScript de Personas/cobertura: `person-radial`,
`person-coverage-presentation`, `person-client-coverage` y
`person-workspace-presentation` bajo `frontend/tests/cross/`.

No se ejecutó el gate completo de v1, una consulta real PostgreSQL ni una
validación visual autenticada. Esta evidencia no acredita paridad Go ni que
todas las reglas actuales puedan publicarse sin revisar su procedencia.
