---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Aceptación, distribución y crecimiento

El orden decidido es demo para Portfolio, autohospedado y evaluación SaaS
si funciona. Los IDs y estados viven sólo en el [tracker](TO_IMPLEMENT.md).
No hay fechas de lanzamiento comprometidas ni usuarios externos registrados.

## Demo: comprensión del producto

Aceptar el [guion](DESIGN.md#guion-determinista-del-laboratorio)
completo: dos conexiones del mismo tipo, cambios trazables, decisión humana
conservada, corrida parcial sin bajas falsas y reset determinista. Build
aislado de configuración privada; recorrido por teclado y presentación ES/EN.

Observar si una persona puede explicar qué cambió, de dónde viene el dato y
por qué una corrida parcial no prueba una baja. Registrar dudas y ayuda del
autor. Esto valida comunicación/usabilidad, no integración ni demanda.
Publicación es una acción posterior autorizada, no efecto del build.

## Autohospedado: utilidad real

Una instalación por equipo con base PostgreSQL propia; API/worker Go y UI
React. Primer adaptador real acotado y de lectura, además del conector de
laboratorio. Recomendación inicial: inventario de Safes de PAM, por la base
contractual existente; no implica portar cuentas, secretos, sesiones, SIA ni
todo CyberArk. El contrato para un tenant nuevo debe verificarse aparte.

Aceptar instalación vacía desde instrucciones; acceso y permisos con dos
usuarios de alcances distintos; primera sincronización y otra comparable;
fallo de página y retry; decisión humana persistente; exportación autorizada;
restart sin duplicados; migración explícita y restore en base descartable.
La instalación laboral no se usa como fixture ni como destino de pruebas.

La demo puede seguir siendo estática mientras se construye Go. No añadir
una API corporativa detrás de la demo para aparentar integración terminada.
Registrar versión, dataset de laboratorio, comandos y límites de cada cierre.
La v1 no se retira ni se migra como consecuencia del lanzamiento del producto.

## Qué significa «si tiene éxito»

Señales mínimas propuestas para reevaluar SaaS: al menos dos equipos ajenos al
autor instalan el producto, vuelven a usarlo en sesiones distintas y explican
una tarea que les resuelve. Medir dificultad de instalación, tiempo/ayuda,
recurrencia y petición concreta de alojamiento. No inventar porcentajes,
clientes, entrevistas ni ahorros; tampoco fijar precios desde esta revisión.

Si sólo gusta la demo, mejorar comunicación. Si el producto resulta útil pero
instalarlo cuesta, corregir distribución primero. Si hay demanda explícita de
alojamiento, evaluar costes, soporte, privacidad y viabilidad con el dueño.
Las señales son una puerta de evaluación, no una prueba estadística de mercado.

## Lo que SaaS necesitaría antes de alojar clientes

Una conexión no es una empresa/tenant SaaS. Compartir tablas con
`connection_id` no demuestra aislamiento entre clientes. Haría falta una
decisión nueva de modelo de aislamiento, organizaciones, membresías, límites,
secretos, jobs, métricas, exports y restauraciones por tenant, con pruebas de
acceso cruzado. Evaluar RLS y/o bases separadas según ese modelo; no prometer
seguridad multiempresa a partir del piloto de una instalación.

También operación y soporte, retención, borrado, actualizaciones y recuperación
de cada cliente. Facturación y contratos de servicio se diseñan después de
validar la necesidad. No crear ahora un bosquejo de SaaS que se presente como
capacidad disponible.

## Distribución y procedencia

Antes de compartir código o material, registrar procedencia de componentes,
assets y fixtures y la licencia elegida por el dueño. El uso laboral, la
autoría y la disponibilidad pública son hechos diferentes; esta revisión no
resuelve derechos de distribución ni publica el repositorio. La demo inicial
se construye con ejemplos nuevos y materiales cuya reutilización esté clara.

La documentación nueva contiene sólo conceptos, referencias de código y
datasets ficticios. Los contratos de tenants, tickets corporativos, grupos,
dominios y evidencias privadas permanecen fuera de la presentación pública.
