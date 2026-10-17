---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-06
---

# Vistas SQL de consulta

Migración `087_reporting_views.sql`. Las vistas del esquema `reporting` son
contratos de lectura para consultas operativas y reportes sobre PostgreSQL.
No almacenan otra copia ni necesitan refresco. No cambian los endpoints.

## Contratos

| Vista | Población y uso |
|---|---|
| `reporting.netskope_devices` | Sólo equipos activos de Netskope; identidad, SO, versión del cliente, clasificación, fabricante, modelo, último evento y fechas en columnas. |
| `reporting.netskope_device_reviews` | Los mismos equipos activos, con diagnóstico humano y seguimiento; incluye equipos sin decisión. Contiene responsable, referencia y nota: requiere autorización específica. |
| `reporting.source_sync_status` | Última corrida por `(source_system, source_file)`, incluida una fallida, parcial o en curso. Una importación o un flujo distinto no sustituye a la corrida de inventario. |

Las columnas son explícitas: no se exponen JSON crudo, heartbeat, evidencias
crudas guardadas, tokens ni textos de errores de sincronización. Hostname y
usuario provienen de la proyección SSE ya aprobada; no vinculan otras fuentes.
La empresa usa el mismo fallback de dominio que los filtros del inventario.

`inventory_observed_at` es cuándo Custodia observó el registro; **no es actividad
del cliente**. `last_event_at` es NULL para fechas ausentes, no numéricas,
no positivas o futuras, igual que en la API. `event_age_days` conserva decimales:
para cortes de 7 o 30 días se recomienda comparar `last_event_at` directamente.

Sin decisión, `review_saved=false`, `diagnosis='undetermined'` y los campos
propios de la decisión son NULL. Una excepción vencida conserva `stored_status`,
pero `effective_status='pending'`, igual que en la API. Las decisiones de equipos
retirados permanecen en la tabla original y no aparecen en estas vistas activas.
Las sugerencias automáticas siguen perteneciendo a la API; estas vistas no
introducen reglas de sugerencia ni demuestran uso o baja corporativa.

Sólo `netskope-api` tiene aquí política de vigencia: corrida `completed`,
finalizada entre ahora y las últimas 24 horas. Sin corrida, se publica una fila
Netskope con `source_fresh=false`. Los demás flujos observados tienen
`freshness_hours=NULL` y `source_fresh=NULL`: se muestran sus fechas y estado,
sin atribuirles la política de Netskope. `as_of` indica el instante de lectura.

## Ejemplos

```sql
-- Equipos observados con más de 30 días sin eventos; no exige sync vigente.
SELECT device_id, hostname, username, os, last_event_at
FROM reporting.netskope_devices
WHERE last_event_at < statement_timestamp() - interval '30 days'
  AND os = 'Windows'
ORDER BY last_event_at, device_id;

-- Sin clasificar, con evaluación de inventario vigente.
SELECT d.device_id, d.hostname, d.owner, d.next_review_at
FROM reporting.netskope_device_reviews d
JOIN reporting.source_sync_status s
  ON s.source_system = 'netskope' AND s.source_file = 'netskope-api'
WHERE s.source_fresh IS TRUE
  AND d.diagnosis = 'undetermined'
  AND d.last_event_at < statement_timestamp() - interval '30 days'
ORDER BY d.last_event_at, d.device_id;

SELECT source_system, source_file, status, completed_at, source_fresh
FROM reporting.source_sync_status
ORDER BY source_system, source_file;
```

## Acceso de sólo lectura

La migración no crea usuarios, credenciales ni asignaciones de acceso. Revoca
acceso de `PUBLIC` al esquema y a las tres vistas. Además, las vistas no permiten
INSERT/UPDATE/DELETE, incluso al propietario; las escrituras operativas pasan
por la API, con sus permisos y auditoría.

Los permisos PostgreSQL **no heredan roles ni permisos de Custodia**. Quien reciba
acceso a una vista podrá leer toda su población; no aplica restricciones por
sesión de la aplicación. El DBA debe elegir el rol autorizado y comprobar que
no tenga otros grants o membresías con escritura. No usar la cuenta de la app
para reportes ni otorgar acceso a tablas originales, capturas o auditoría.

Ejemplo para un **rol existente** aprobado por el DBA (nombre ilustrativo):

```sql
GRANT USAGE ON SCHEMA reporting TO equipo_reportes;
GRANT SELECT ON reporting.netskope_devices TO equipo_reportes;
-- Sólo si también tiene autorización para leer el seguimiento humano:
GRANT SELECT ON reporting.netskope_device_reviews TO equipo_reportes;
-- El estado de todos los flujos requiere su propia autorización operativa:
GRANT SELECT ON reporting.source_sync_status TO equipo_reportes;
```

No usar `GRANT SELECT ON ALL TABLES IN SCHEMA reporting` ni permisos por defecto:
una vista futura debe autorizarse explícitamente. Si el entorno tiene grants por
defecto para otros roles, el DBA debe revisarlos antes de habilitar consumidores.
No hay un login de reportes habilitado por esta entrega.

## Cambios y verificación

Una modificación de columnas, tipos, población o reglas requiere una migración
nueva y revisión de consumidores. El baseline generado sirve sólo para bases
vacías; las migraciones numeradas siguen siendo el historial de actualización.

Las pruebas en PostgreSQL verifican proyección, fechas inválidas, aislamiento,
retirados, decisiones ausentes, excepciones vencidas, frescura contra la API y
acceso real de un rol sin permisos sobre tablas originales. También intentan
escribir en cada vista para comprobar que se rechaza.
