# Diccionario de métricas de DS Hub

Este documento define las métricas que ya expone DS Hub. Los valores siempre se
calculan desde la base vigente y respetan los filtros seleccionados.

| Métrica | Fórmula / definición | Fuente | Nota de lectura |
|---|---|---|---|
| Safes activos | Safes con `lifecycle_status = active` | PAM | Inventario vigente; no incluye retirados |
| Cuentas activas | Cuentas con `lifecycle_status = active` | PAM | No representa licencias ni usuarios únicos |
| Safes sin cuentas | Safes activos sin cuentas PAM activas | PAM | Señal para revisar inventario o fuente |
| Safes sin CPM | Safes activos sin CPM informado | PAM | Falta de dato; no prueba una falla de CPM |
| Sin retención/purga | Safe sin retención por versiones, días ni purga automática | PAM | Señal de configuración observada |
| Cuentas con plataforma | Cuentas activas con relación de plataforma completa | PAM | La relación parcial se muestra por separado |
| Cobertura por IP | Coincidencia exacta entre IP importada y cuentas PAM o reglas IP SIA | Inventario + PAM/SIA | No infiere coincidencias por nombre |
| ZSP informado | Valor importado en el inventario de conexiones | Inventario de conexiones | `SI`, `NO` y `N/A` se conservan como estados distintos |
| Concentración de acceso | Safes alcanzables por usuario o rol mediante `user -> role -> safe` | CMDB PAM | Muestra alcance técnico, no uso real |
| Frescura del inventario | Safes agrupados por antigüedad de `last_modification_time` y cuentas no observadas por más de 30 días | PAM | No es rotación de credenciales |
| Asientos Standard conciliados | Usuarios PAM activos `EPVUser` que también pertenecen a `Privilege Cloud Administrators` o `Privilege Cloud Users` | CMDB PAM | Conciliación operativa; no es facturación. Los grupos `sg_cyberark_privilege_cloud_*` no suman asientos |

## Métricas derivadas del panel modular

Estas métricas cruzan inventarios sólo cuando existe una relación verificable.
El panel muestra el porcentaje junto con su total para que el número no se lea
fuera de contexto.

| KPI | Fórmula / definición | Fuentes | Decisión que ayuda a tomar |
|---|---|---|---|
| Cobertura PAM + SIA | Conexiones del inventario con coincidencia exacta en PAM y en reglas IP de SIA / conexiones totales | Inventario + PAM/SIA | Priorizar conexiones sin cobertura completa |
| Cobertura ZSP | Conexiones con `ZSP = SI` / conexiones totales | Inventario de conexiones | Medir avance de implementación; `N/A` permanece como dato desconocido |
| Cuentas con plataforma | Cuentas activas con plataforma informada / cuentas activas | PAM | Detectar cuentas que requieren completar su relación técnica |
| Safes con cuentas | Safes activos con al menos una cuenta activa / safes activos | PAM | Detectar Safes vacíos o incompletos |
| Usuarios, roles y políticas | Conteo de objetos activos observados por tipo y fuente | PAM / SIA | Dimensionar el inventario disponible; no equivale a licencias ni actividad |

Los cruces se mantienen deliberadamente como KPIs de cobertura y configuración: no
infieren sesiones, rotación, licencias, sistema operativo ni uso real cuando
esas fuentes todavía no están integradas.

## Visualizaciones cruzadas del panel

| Atajo | Cruce verificable | Lectura esperada |
|---|---|---|
| Evolución del inventario | Fecha de sincronización × Safes y miembros recibidos | Detectar cambios de volumen entre cargas; no representa actividad de uso |
| Estado por empresa | Unidad de negocio × estado operativo | Identificar dónde se concentra el trabajo pendiente o en curso |
| Cuentas vs. miembros | Cuentas activas × miembros activos por Safe | Detectar Safes atípicos por tamaño o exposición |
| Safes y cuentas por empresa | Unidad de negocio × Safes y cuentas activas | Comparar volumen de contenedores y credenciales por empresa |

El mapa geográfico no se habilita hasta disponer de país, región o coordenadas
provenientes de una fuente inventariada y verificable.

## Reglas comunes

- Toda tarjeta debe mostrar el valor, su denominador cuando corresponda, el
  filtro aplicado y la fecha de la última sincronización.
- Un clic sobre una categoría debe abrir el inventario que compone el número.
- `N/A`, sin dato y cero no son equivalentes.
- No se deben presentar miembros de Safes como licencias ni frescura como
  rotación.
- Las métricas PAM, Identity Administration y SIA permanecen separadas salvo
  el puente de lectura explícitamente documentado para identidades.
