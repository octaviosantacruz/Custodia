---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-06
---

# Métricas Netskope: registro, carga, AA e iterator

Documento único de las métricas de Netskope en Custodia. El trabajo pendiente vive en [`TO_IMPLEMENT.md`](../tracking/TO_IMPLEMENT.md) (`NSK-METRICS-001` y sus fases, `NSK-AA-001`, `NSK-PERF-001`, `NSK-E2E-TIME-001`); aquí quedan las decisiones, los contratos y la evidencia que las sostiene. Las APIs permitidas están en [`netskope-api.md`](netskope-api.md) e [`integration-contracts.md`](integration-contracts.md).

## Qué mostramos y qué buscamos

| Tema | Qué permite ver |
|---|---|
| Usuarios y dispositivos | Inventario, actividad observada, versiones y clasificación |
| Equipos | Equipos a revisar, antigüedad de señales, cambios y posibles duplicados |
| Alertas | Conteos por período, tipo y acción |
| Políticas | Políticas que dispararon en eventos (pestaña Actividad de políticas de Postura, `/netskope/posture?section=policies`) |
| DLP | Captura mínima de incidentes y su relación con usuarios |
| Experiencia | Dispositivos y POP observados para un usuario seleccionado (ADEM) |

Un equipo con actividad reciente no equivale a una conexión en vivo. Inventario, alertas y experiencia responden preguntas distintas y **no se suman ni se usan como fallback unas de otras**.

La dirección es usar **Advanced Analytics (AA)** para consultar resúmenes calculados por Netskope, conservarlos sólo en memoria y no copiar a PostgreSQL lo que Netskope ya resume. PostgreSQL conserva inventario y drill, snapshots operativos, baselines, decisiones humanas, preferencias y auditoría. Un histórico propio debe justificarse por métrica y usar agregados mínimos, nunca payloads completos. Nada de esto borra historia, edita migraciones aplicadas ni retira el iterator DLP.

Reglas de lectura que se mantienen: una prueba técnica demuestra sólo lo que midió; un porcentaje exige población, numerador, denominador, desconocidos, período y exclusividad verificables; no se suma entre ventanas móviles solapadas ni se deduce un total sumando un Top-N; una respuesta vacía no es un cero verificado.

## Registro contractual de métricas (`NSK-MET-REGISTRY-001`)

El dueño es `netskope/sse/services/netskope_metric_registry.py`. Las preferencias validan IDs, tipo y filtros contra él. `GET /api/dashboard/netskope/contracts` (`netskope:read`) devuelve los **27 contratos** sin consultar el tenant ni exponer credenciales ni IDs de AA. `contract_state=verified` acredita la definición, no que haya datos, sync reciente ni cobertura completa. Cada contrato declara clave y versión, fuente/adaptador, alcance, grano, unidad, filtros, ventanas, zona, denominador, Top-N, drill y fechas de observación/captura/consulta. IDs, tamaños, presets y plantillas se conservan; guardar con filtros incompatibles se rechaza.

Fuentes: **inventario** (`inventory_sql`), **alertas** (`alert_snapshot`, capturas de 7/30/90 días) y **AA** (`advanced_analytics`). Filtros: **D** (SO, empresa, clasificación) para equipos, **U** (empresa) para usuarios, ninguno para alertas y AA.

| Grupo (cantidad) | Widgets | Población / Top-N |
|---|---|---|
| Inventario de usuarios (6) | `users_total`, `users_recent_activity` (7/14/30 d), `users_without_observed_devices`, `users_by_company` (40), `users_by_device_count`, `users_by_recent_device_age` | Identidades activas, o todo el inventario; la edad cubre sólo usuarios con equipo resuelto |
| Equipos recientes (11) | `devices_total`, `devices_with_observed_user` (registrado, fuera del selector), `devices_observed_user_{matched,unmatched}`, `devices_by_{os,client,make,classification,user_status}` (8), `devices_by_company` (40), `devices_by_observed_user_status` | Activos con evento en 7 días; «sin match» excluye ambiguos |
| Equipos sin señal (1) | `devices_stale_30d` (`NSK-HB-001`) | **Todo el inventario activo**, no la ventana de 7 días: equipos con un último evento válido de más de 30 días; sin denominador ni porcentaje; las fechas ausentes, no numéricas, no positivas o futuras no cuentan. Devuelve además la vigencia del sync que respalda el inventario leído |
| Riesgo de cobertura (1) | `coverage_risk_devices_by_user` (10) | Último evento uninstall/admin disabled sobre el inventario activo (no la ventana de 7 d) |
| Alertas (3) | `alerts_{7d,30d,90d}` | Captura completa más reciente de la ventana |
| AA (1) | `alerts_by_severity` | Requiere un binding aprobado con ventana y zona |

Denominadores: `users_total` (usuarios), `devices_total` (equipos recientes), suma de buckets (edades), `devices_active_total` (riesgo de cobertura) y `total` independiente para alertas y AA. Los snapshots de alertas conservan los estados completo, incompleto y vencido y eligen siempre una corrida completa coherente (`NSK-MET-COHORT-001`).

**Fechas.** Inventario publica `last_observed_at` (máxima observación de lo consultado; no es el último evento ni conexión en vivo). Alertas publica `window_start`, `window_end` y `captured_at`. AA publica `fetched_at` y `cache_expires_at`, que son tiempos locales; la API no entrega el watermark ni los límites absolutos de la ventana remota.

### Oferta del selector

| Grupo visible | Contenido |
|---|---|
| Inventario y cobertura (22) | Todos los de usuarios, equipos y riesgo |
| Alertas y protección (4) | `alerts_{7d,30d,90d}`, `alerts_by_severity` |

Cada tarjeta muestra fuente, período y disponibilidad; un snapshot o preview ausente no es un cero; `alerts_by_severity` sigue visible como no disponible mientras su estado sea pendiente. El frontend no consume `/contracts`: deriva los rótulos de las definiciones y respuestas ya cargadas.

### Presentación de los gráficos: dona o barras

Los gráficos de categorías comparten un componente de `cross/` (`CategoryChart`: dona con leyenda y barras ordenadas, mismos datos, población y navegación al inventario). La presentación se elige en el panel «Configurar» de cada bloque y se guarda en las preferencias (`style`: `donut` o `bars`; ausente = predeterminada). Predeterminadas: **barras** para empresas (hasta 40 categorías) y **dona** para las distribuciones chicas (SO, clasificación, estado de usuario, cliente, fabricante, usuario observado, cantidad de dispositivos, antigüedad, diagnóstico). La dona agrega lo omitido por el Top-N como una porción neutra «Otras categorías», para que un Top-N no aparente ser toda la población. `coverage_risk_devices_by_user` es una muestra fija de 10 usuarios: sólo barras y sin porcentajes (lo dice la tarjeta); `alerts_by_severity` (AA) no tiene elección. El servidor sólo acepta `style` en bloques de inventario con gráfico y lo omite de la respuesta cuando no existe.

Se retiraron `alerts_by_type` y `alerts_by_action` (decisión del dueño, 2026-10-12): como el resto de los IDs retirados, las vistas guardadas y las plantillas los descartan al leer. El tablero predeterminado usa `devices_by_classification` en lugar del primero.

### Ranking de políticas retirado

`alerts_by_policy` («Políticas observadas en alertas», `NSK-MET-POL-001`) se retiró de Métricas (decisión del dueño, 2026-10-12: no aportaba). Ya no está en el registro ni en el selector; las vistas guardadas y las plantillas que lo contienen se leen sin él (`RETIRED_WIDGETS`) y guardar con ese ID se rechaza. La captura de la dimensión `policy` y `GET /api/cmdb/netskope/observed-policies` siguen en el backend, sin consumidor en el frontend.

## Carga selectiva (`NSK-MET-LOAD-001`)

El tablero espera las preferencias antes de consultar inventario: una vista vacía o sólo AA no lo necesita. `GET /api/cmdb/netskope/metrics` sin `widgets` conserva la respuesta completa; con parámetros repetidos (`?widgets=devices_total&widgets=devices_by_os`) el registro resuelve campos y denominadores, y rechaza IDs desconocidos, widgets de alertas/AA y más de 28 selecciones antes de tocar PostgreSQL (`netskope:read`). La respuesta selectiva omite lo que no ejecutó, sin convertirlo en ceros ni listas vacías; los grupos usuario/dispositivo comparten agregado, y el riesgo conserva su denominador de todo el inventario activo.

Presupuesto: una solicitud por combinación única de filtros y widgets (no se pide además el inventario sin filtros si todos están filtrados); máximo dos solicitudes de inventario por tablero, dos distribuciones SQL concurrentes por solicitud y pool de 8; cancelación hasta cola y transporte (no promete cancelar SQL ya recibido); caché de React Query por filtros, proyección y refresh con frescura de 30 s, limpiada al cambiar de actor; sin retries automáticos; el reintento repite sólo los grupos fallidos y no consulta AA; las previews del editor se piden sólo con las tarjetas visibles.

Comparación local de consultas SQL de inventario: dispositivos totales 11 → 1; una distribución 11 → 2; usuarios con actividad 11 → 2; riesgo por usuario 11 → 3; vista recomendada 11 → 3; tablero predeterminado 11 → 5; cliente que no envía selección 11 → 11. Con una captura de alertas, 12 → 4 (recomendada) y 12 → 6 (predeterminada). En el navegador, una vista vacía o sólo AA pasa de 2 solicitudes de inventario a 0. Son mediciones de comportamiento y cantidad de consultas, no p50/p95 ni carga real (eso es `NSK-MET-VALIDATE-001`/`NSK-PERF-001`). Pruebas: `test_netskope_cross_metrics_postgres_integration.py`, `test_netskope_device_filters_http.py`, `netskope-metrics-loading.unit.test.ts`, los e2e Netskope y `test_netskope_aa_metrics.py`.

## Severidad desde Advanced Analytics (`NSK-AA-001`) — reemplazada por el mapa de gráficos (2026-10-12)

**Estado (decisión del dueño, 2026-10-12):** `alerts_by_severity` ya no se ofrece en el selector ni en las vistas preconfiguradas; el tenant no tiene un widget de dos columnas que cuente **todas** las alertas (los de severidad DLP e IaaS devolvieron 0 filas y «Malware by Severity» cuenta sólo malware). La severidad por tipo se consume ahora con el [mapa de gráficos](#gráficos-aa-por-mapa-del-tenant-nsk-aa-charts-001-2026-10-12) («Malware por severidad»). El contrato y la aprobación de abajo siguen vigentes para una vista guardada que aún contenga el bloque y no se retira código hasta decidirlo. Si el equipo necesita la severidad de todas las alertas, hace falta un widget compartido de dos columnas en la consola de Netskope.

**Decisión (2026-10-02):** reemplazar primero `alerts_by_severity` por el resultado calculado por Netskope, sin persistirlo. El inventario local, otros agregados y la captura DLP por iterator conservan su alcance.

**Flujo.** `GET /api/cmdb/netskope/aa/severity` (`netskope:read`, también con caché) consulta un único widget por el transporte async validado, proyecta sólo severidades categóricas y conteos y guarda una entrada **en memoria por proceso** durante 5 minutos, con un lock que comparte la consulta entre lectores y un cooldown de 15 s tras un fallo. No se sirve un resultado vencido ante error; cambiar contrato, tenant, token o aprobación invalida la entrada; reiniciar vacía la caché y cada worker tiene la suya. Sólo se audita la lectura (estado y cantidad de buckets, sin IDs remotos ni conteos). No hay tabla, migración, snapshot ni payload en logs. El frontend consulta AA sólo con el gráfico seleccionado e informa fuente, alcance, unidad, ventana/zona guardadas y hora de consulta (no el watermark remoto); cero filas dice «El widget AA no devolvió filas» con total `null`. La sync dejó de pedir severidad por `datasearch/alert`: quedan total, tipo y acción (9 requests lógicos por sync, antes 12); los snapshots históricos de severidad no se borran y el endpoint legacy los excluye de su lectura actual.

**Catálogo sin consola.** `backend/.venv/bin/python scripts/catalog_netskope_aa.py --output <archivo nuevo>` hace sólo GET secuenciales (reportes accesibles, widgets globales y por reporte), reutiliza HTTPS y límites del cliente AA y guarda IDs, categorías y relaciones, sin resultados ni títulos. Indexa `reports`, `widgets` y `metric_candidates[severity|policies|applications|traffic]`, clasificados por título (`unverified`); `metric_bindings` queda vacío hasta tener un contrato aprobado. Barrido del 2026-10-02: 66 reportes, 159 widgets globales y 998 referenciados (1.157 IDs distintos); 11 candidatos de severidad, 74 de políticas, 252 de aplicaciones y 150 de tráfico. Una falla deja el reporte `unavailable`; el barrido falla ante exceso (100 reportes, 1.000 entradas) en vez de truncar.

**Contrato y aprobación.** `NETSKOPE_AA_SEVERITY_CONTRACT_JSON` (vacío por defecto) tiene exactamente: `report_id`, `widget_id`, `severity_column`, `count_column`, `window_days` (1–365), `timezone` (IANA), `scope` (`all_alerts` o `dlp`) y `unit` (`events` o `incidents`). Describen lo verificado por el operador, no parámetros que Custodia imponga (la API no aplica nuestros filtros ni da evidencia para verificarlos); se recomienda un widget compartido dedicado a Custodia, y no se infieren período ni unidad del título ni se elige por posición. `NETSKOPE_AA_SEVERITY_APPROVAL_JSON` lleva `version` (entero positivo), `contract_sha256` (SHA-256 del contrato JSON con claves ordenadas y separadores `,` `:`, UTF-8) y `definition_sha256` (hash de la evidencia sanitizada revisada: población, medida, grano, exclusividad, filtros, ventana, zona).

| Condición | Resultado |
|---|---|
| Contrato ausente | `not_configured`, sin consulta |
| Contrato válido sin aprobación | `pending_validation`, sin consulta |
| Aprobación inválida o fingerprint distinto | 503, sin consultar ni servir caché; registro `invalid` |
| Contrato y aprobación válidos | `verified`; respuesta con `contract_version` |
| Columnas, categorías, conteos o grano incompatibles | 502; no se sirve caché vencida ni se suman dimensiones |
| Cambio de versión, evidencia, configuración, tenant o token; retiro de aprobación | Invalida la entrada |

`definition_sha256` identifica la evidencia revisada y **no** detecta cambios semánticos remotos (la API no expone la definición): al editar el widget se revoca la aprobación, se revisa y se emite otra versión.

**Forma del resultado.** Sólo dos columnas de datos, una fila por severidad, sin agrupar por aplicación, usuario o política ni totales intercalados (se descarta un índice técnico con encabezado vacío sólo tras verificar una secuencia desde 0 o 1). Las categorías deben ser excluyentes: con `unit=incidents` cada incidente cuenta una sola severidad, y un distinct sobre eventos que permita el mismo incidente en varias no cumple. Severidades: critical, high, medium, low, informational e unknown/null/vacío (se normalizan alias; una segunda fila de la misma severidad falla; las categorías desconocidas no se publican). Conteos enteros no negativos; CSV y JSON se proyectan al mismo contrato; se piden hasta 100 filas y alcanzar el límite falla por posible truncamiento.

**Validación técnica (2026-10-02).** Se inspeccionaron los 11 candidatos de severidad (100 filas, seis polls, 45 s por candidato; sólo IDs, forma y duración). El único con dos columnas, datos y severidades limpias es el reporte `12352`, widget `530247`, que corresponde a **severidad de alertas de malware**, no a DLP ni a todas las alertas; los demás tenían tres o más columnas, dimensiones extra, el límite alcanzado o venían vacíos. La forma no acredita ventana, zona, filtros, unidad ni exclusividad, así que **ninguno tiene binding productivo**. Caché sobre ese widget: lectura individual vacía 4,9 s (1 tarea AA); 20 lectores con caché vigente 0 tareas (máximo 0,0002 s por lector); 20 lectores con caché vacía 1 tarea (3,8 s el lote), todos con el mismo resultado. Es una medición de servicio en un proceso, con una fixture en memoria cuyos metadatos no son evidencia del widget; no mide HTTP, varios workers, carga sostenida ni la caché de Netskope.

**Bloqueo externo.** El reporte DLP inspeccionado (19 widgets) devuelve cuatro columnas (índice técnico, conteo de incidentes y otras dimensiones), así que no se habilitó con una suma adivinada. Falta elegir o preparar en AA un agregado de dos columnas y confirmar ventana, zona y grano; después, configurar el binding aprobado y verificar la ruta autenticada y el gráfico con esos metadatos. No se modificaron reportes remotos, configuración del tenant ni `.env.local`. La reducción de requests y de persistencia no demuestra aún menor latencia con datos grandes: eso exige un widget equivalente y consultas frías y calientes, sin comparar eventos con incidentes.

Candidatos de AA para el futuro (propuestas, no widgets contratados): tráfico total por período, aplicaciones por bytes y alertas por severidad/tipo; un reporte compartido de Custodia debería fijar período, unidad, denominador y dimensiones permitidas. La API documenta async → status → resultado, límite de 10.000 filas y sin paginación; las muestras previas incluyeron CSV aunque se pidió JSON, y un `500`. Ver [Reporting AA v2](https://docs.netskope.com/en/rest-api-v2-reporting-endpoints-for-advanced-analytics).

## Gráficos AA por mapa del tenant (`NSK-AA-CHARTS-001`, 2026-10-12)

**Decisión (dueño):** en lugar de una definición única por variable de entorno, un **mapa título → IDs** declarado por tenant. Agregar un gráfico es agregar una entrada; no hay tabla, migración ni pantalla de administración.

- **Configuración.** `NETSKOPE_AA_CHARTS_JSON` (vacío = sin gráficos; inválido = 503 y el selector no ofrece nada). Objeto `clave → {title, report_id, widget_id, label_column, value_column, unit, period[, labels]}`; `labels` (opcional, hasta 40) traduce nombres que Netskope devuelve en inglés (`{"Low": "Bajo"}`, coincidencia exacta; dos nombres que terminen iguales son una etiqueta duplicada y fallan); clave `[a-z0-9_]{1,40}`, hasta 24 entradas, sin campos extra. Los IDs son del tenant: viven en el entorno, no en el repo, y nunca llegan al navegador ni a las respuestas.
- **Aprobación = la entrada.** Quien la agrega atestigua el `period` y la `unit` que leyó en la consola (la API no expone la definición del widget ni si aplica el filtro de tiempo del dashboard). Un widget que no depende del tiempo (por ejemplo, nivel GDPR de las aplicaciones del catálogo) declara «Catálogo actual»; uno que sí depende debe declarar su ventana real.
- **Ayuda.** `backend/.venv/bin/python scripts/aa_chart_entry.py --report-id <id> --title <texto> --key <clave> --unit <u> --period <p>` busca el widget por título (GET), detecta las dos columnas con una consulta acotada e imprime la entrada. No imprime valores de filas. Revisá período y unidad antes de pegarla.
- **Forma admitida.** Dos columnas (etiqueta + conteo entero), una fila por etiqueta, menos de 100 filas. Se ignora el espacio en los encabezados, un índice de fila sin encabezado con secuencia válida y el separador de miles con comas (`12,345`; otro uso de la coma es inválido); una etiqueta vacía se muestra «Sin dato». Columnas extra, etiquetas duplicadas, conteos no enteros o el tope de filas fallan (502), igual que severidad.
- **Rutas** (`netskope:read`): `GET /api/cmdb/netskope/aa/charts` (id `aa_<clave>`, título, unidad y período, sin consultar Netskope) y `GET /api/cmdb/netskope/aa/charts/{clave}` (404 si no está declarada). Caché en memoria de 5 minutos por gráfico y proceso, con consulta compartida y espera de 15 s tras un fallo; se audita la lectura con estado y cantidad de buckets. No se persisten resultados.
- **Tablero.** Cada entrada es un widget `aa_<clave>` de tipo gráfico: aparece en el selector bajo «Advanced Analytics», se dibuja como dona o barras (se elige en «Configurar»), no admite filtros ni navega a inventario. Si una entrada sale del mapa, las vistas guardadas que la contenían la descartan al leerse.
- **Primer caso validado (2026-10-12):** reporte `170`, «# of Risky Applications by GDPR Level» (dos columnas, 4 filas, 11 s); sus proporciones coincidieron con la consola.

## Iterator DLP (`NSK-ITER-*`, `NSK-PERF-001`)

La captura DLP lee incidentes por páginas con checkpoints y recuperación. Benchmark controlado del 2026-10-02 (`scripts/benchmark_netskope_iterator.py`, tres páginas por lote, dos rondas en orden alterno, sin escrituras ni cambios al índice productivo): mismas 783 identidades en ambos clientes; el cliente nuevo respeta el `wait_time` de 5 s (el anterior aplicaba 0,25 s) y tardó ≈17 % más (39,2 s frente a 33,4 s) con ≈20 % menos pico de memoria Python (7,5 frente a 9,4 MiB; entre rondas osciló 2–34 %). Tres páginas no agotan la ventana de 24 h, y la medición no incluye SQL, RSS, fallas reales ni sync completa.

**Decisión:** conservar las pausas y la recuperación segura; **nunca** paralelizar el mismo endpoint/índice; máximo de 12 páginas. La espera se mide desde la recepción de cada página con reloj monotónico y la siguiente página espera sólo el tiempo restante después de confirmar la anterior (con pausa de 5 s y persistencia de 2 s el request pasa de t=7 a t=5); `dlp_persistence_ms` y `dlp_wait_ms` separan los tiempos. Falta medir una sync completa con varias páginas y concurrencia entre endpoints independientes (`NSK-PERF-001`).

## Investigación del timeout E2E (`NSK-E2E-TIME-001`)

El trace histórico de `NSK-POSTURE-UX-001` vence por el **presupuesto acumulado de 45 s del test** durante la configuración del último análisis Axe, después de nueve navegaciones; ningún análisis tardó 45 s (los terminados tardaron 2,0–2,4 s). No se reprodujo: tres corridas por estado pasaron en `7bfdcaf` (32–34 s), `1498bcf` (33–35 s) y `10a20b5` (50–53 s, incluido build y arranque), con el mismo Node, Chromium, lockfile y un worker. No hay señal para atribuirlo al refactor ni para bisectar, y no se tocaron timeouts, retries ni aserciones. Reproducir con `E2E_PORT=<puerto> npx playwright test tests/e2e/netskope/sse/netskope.spec.ts -g "NSK-POSTURE-UX-001" --workers=1` desde `frontend/`.

## Diferencias esperadas con la consola de Netskope (`NSK-REF-001`, `NSK-USR-001`, 2026-10-06)

Guía para responder «¿por qué Custodia no muestra el mismo número que la consola?». Se comparó el 2026-10-05 22:30 con las pantallas
`Devices` (Last 7 Days) y `User Management`; la medición completa y los endpoints están en
[netskope-api.md](netskope-api.md#conciliación-de-totales-con-la-consola-nsk-ref-001-nsk-usr-001). Cada diferencia de abajo tiene causa
conocida y **no se corrige a propósito**: igualarla obligaría a mostrar un dato menos correcto. Con la misma medición, esta fue la lectura
al 2026-10-05 23:40 (hora de Asunción):

| Cifra | Consola | Custodia | Diferencia y causa | ¿Se iguala? |
|---|---|---|---|---|
| Usuarios | `Total Users` 8.859 | «Usuarios en inventario» 8.855 | −4. Netskope repite 4 filas al paginar `getusers` y la consola las cuenta dos veces; Custodia las une por id. La tarjeta lo muestra como «Netskope informa 8.859 · Custodia lista −4». | No: sería contar dos veces a los mismos usuarios. |
| Dispositivos con evento en 7 días | 4.578 | «Dispositivos» 4.576 | −2. La ventana de 7 días se mide contra la hora de la consulta y los datos solo cambian con cada sync (cada 30 min); un equipo sale de la ventana cada pocos minutos. La tarjeta indica la hora del inventario. | No: aun congelando la ventana en el sync, la consola usa su propio reloj. |
| Usuarios en esos equipos | `users` 4.454 | «Usuarios con actividad reciente» 4.440 | −14. La consola cuenta **nombres de usuario vistos** en los equipos, incluidos los de usuarios borrados (12 con equipo reciente); Custodia cuenta identidades vigentes con un equipo resuelto. 4.454 − 12 = 4.442; los 2 restantes son la ventana móvil. | No: volvería a atribuir actividad a personas dadas de baja. |
| Cuentas habilitadas / deshabilitadas | 10.209 / 1.987 | referencia guardada de `users/counts` | Coinciden. Custodia muestra el estado por usuario, no por cuenta: 7.618 habilitados y 1.237 deshabilitados (la consola informa 7.619 con `Status = Enabled`: ±1 por una fila repetida). | — |
| Grupos / OUs | 718 / 141 | referencia guardada de `users/counts` | Coinciden. Los grupos no están habilitados en la sincronización (`NETSKOPE_GROUPS_PATH`). | — |

**Qué es «borrado».** Netskope marca `deleted: true` en cada cuenta; un usuario con todas sus cuentas borradas no cuenta como usuario en la
consola y Custodia lo retira del inventario. No prueba que la persona haya dejado la empresa. Los equipos que reportaban con ese usuario pasan
a «sin usuario resuelto» (efecto en las tarjetas: 0 → 14 equipos recientes; detalle y revisión en netskope-api.md).

**Cómo reproducirlo si hay una consulta.**

1. Mismo instante: comparar contra la hora de «Device List Last updated» y «Results As Of» de la consola, no contra el momento en que se abre
   Custodia. Una diferencia de 1 a 3 equipos en 7 días es la ventana móvil.
2. Usuarios: la diferencia esperada es de unos pocos usuarios (filas repetidas). Una diferencia de decenas indica que cambió el estado de las
   cuentas en Netskope (por ejemplo, usuarios dados de baja), y se confirma con la corrida siguiente.
3. Actividad: sumar al número de Custodia los usuarios borrados con equipo reciente (el drill «Sin usuario resuelto» los lista) y debe acercarse
   al `users` de la consola.
4. Si una diferencia no se explica con lo anterior, no ajustar el cálculo: registrar la hora, las dos cifras y la corrida de sincronización.

## Heartbeat retirado (`NSK-HB-001`, 2026-10-05)

El booleano `heart_beat` del snapshot de dispositivos **ya no es un estado ni una métrica**: desaparecen `devices_heartbeat_{active,inactive,unknown}` y `heartbeat_status`, el filtro `heartbeat` del inventario, el apilado por heartbeat de la frescura, la tarjeta de Postura, el badge del drawer y el campo en el historial de cambios. Se sigue guardando crudo (`attributes.heartbeat`, capturas en `netskope_device_snapshots`) por si se retoma. Motivo: con la misma flota (~8.950 equipos) los equipos con heartbeat activo van de ~2.900 de noche y fines de semana a ~4.800 un día laboral a la tarde (316 sincronizaciones de 30 min), 3.825 equipos (43 %) cambiaron de valor en 24 h y 1.212 conservan `true` con más de 30 días sin ninguna señal; Netskope no documenta el campo.

**Regla única de estado, sólo por antigüedad del último evento** (`netskope_shared.valid_event_epoch` y derivados, con los cortes de `EVENT_AGE_THRESHOLDS`, que salen de `RECENT_DAYS`/`REVIEW_DAYS`): un timestamp ausente, no numérico, no positivo o posterior a la referencia es `unknown` y no cuenta como reciente ni como viejo. `recent` hasta 7 días inclusive, `not_recent` hasta 30 días inclusive, `review` con más de 30 días y sólo con un sync completo de las últimas 24 h; sin él todo es `unknown`. Python (`device_evidence`) y SQL (estado, buckets, métrica y filtros) se prueban contra la misma tabla de casos en PostgreSQL.

**Observación frente a evaluación.** Los buckets de frescura y `devices_stale_30d` son una *observación* del último inventario y siguen mostrándose con un sync vencido, parcial, fallido o en curso, con la vigencia indicada. «Candidatos a revisar» es una *evaluación*: sin sync vigente `review_candidates` es `null` («Evaluación no disponible: sin sync vigente») y su drill es el estado `review`, la misma población que el número. La tarjeta `devices_stale_30d` cuenta por antigüedad y su drill es el filtro de antigüedad (`event_age=gt_30d`, todo el inventario) con los filtros del widget, de modo que el total del inventario abierto coincide con la tarjeta. Esa tarjeta lee el inventario actual, no una corrida, así que dice «último inventario observado» y explica el estado del sync.

**Tableros guardados.** Los IDs retirados (`RETIRED_WIDGETS`) se descartan al leer preferencias y plantillas por rol (`RETIRED_WIDGETS`), conservando orden, tamaños y filtros del resto; sólo si una vista no vacía queda vacía vuelve a los valores por defecto, y una vista guardada vacía a propósito sigue vacía. El `PUT` sigue rechazando IDs retirados o desconocidos.

## Equipos sin eventos (`NSK-DEVREV-001`, `NSK-INV-002`)

El diseño original (clasificación humana por equipo, sugerencias y lotes) quedó en
`docs/history/architecture/netskope-device-review.md`. Vigente desde 2026-10-13
(`NSK-INV-002`, decisión del dueño):

- **Candidato:** equipo activo con último evento válido de más de 30 días y una
  corrida Netskope completa de las últimas 24 h; `devices_stale_30d` cuenta la
  antigüedad aun cuando la evaluación no esté disponible, indicando la vigencia del sync.
- **Sin clasificación manual en pantalla:** con miles de equipos sin señal y sin una
  fuente corporativa de uso (`NSK-DEVREV-003`, **Externo**: JumpCloud MDM y Cortex
  son candidatos, sin contrato aprobado), decidir equipo por equipo no es viable.
  Postura agrupa los equipos sin señal por lo que explica Netskope (desinstalación
  informada, reemplazo, registro histórico, sin explicación) en **solo lectura**; cada
  grupo abre exactamente sus equipos.
- **Retirado:** formulario, lote de sugerencias, columna y filtros de diagnóstico, y los
  widgets `devices_stale_unclassified` y `devices_stale_by_diagnosis`. La tabla
  `netskope_device_reviews` y sus decisiones se conservan; el sync no las toca.
- **Evidencia medida (2026-10-05, no valores fijos):** de 4.037 equipos con esa
  antigüedad, 158 (3,9 %) tenían desinstalación o deshabilitación informada; 57 (1,4 %)
  un registro reciente con el mismo hostname y usuario; 0 compartían `guid` (distinto en
  cada registro, no sirve para unir reinstalaciones). La gran mayoría no tiene causa
  declarada.
- **Reglas de datos:** ninguna sugerencia usa heartbeat, `user_status` ni ADEM; hostname
  y usuario solo sugieren, nunca confirman ni fusionan registros; un sync no vigente o una
  coincidencia ambigua no producen sugerencia; nada da de baja un equipo en Netskope.

## Cruce oficina × experiencia (NSK-EXP-UCI-001)

Equipos cruza el usuario de cada dispositivo (`username`, coincidencia exacta en minúsculas) con `netskope_user_uci`.
La tabla solo guarda usuarios Bajo (`Poor`) o Moderado; por eso «Sin alerta» significa «no figura Bajo/Moderado»
únicamente cuando existe alguna captura de UCI. Sin captura el valor es «Sin dato» y nunca se presenta como sano.
Filtro `uci_rating` (`Poor`, `Moderate`, `Sin alerta`, `Sin dato`), agrupaciones `onprem_status` y `uci_rating` en
`/api/cmdb/netskope/devices/fleet-groups`, y conteos `uci_low`, `uci_moderate`, `uci_evaluated`, `on_prem_uci_low`.
ADEM no participa: `getentities` solo devuelve los 100 peores y no se persiste, así que no puede cruzarse con la flota.

## Salud de la flota y retiro de alertas del selector (2026-10-16)

Las tarjetas `alerts_7d/30d/90d` salen del selector y de los valores por defecto (las vistas guardadas que las contienen siguen renderizando; ver `RETIRED_NETSKOPE_WIDGET_IDS`). `users_total` vuelve al selector. Se agregan cinco tarjetas de inventario calculadas sólo cuando se piden, reutilizando el resumen de `get_netskope_fleet_groups`: `fleet_signal_24h`, `fleet_client_current`, `fleet_os_supported`, `fleet_on_prem` y `devices_duplicate_hostnames`. Sin línea base de cliente o SO el valor es `null` («Sin línea base»), nunca 0. El contador de contratos pasa a 28 (16 de datos).
