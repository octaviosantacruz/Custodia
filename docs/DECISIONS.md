---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Decisiones del nuevo inicio

| Decisión | Estado y origen | Consecuencia |
|---|---|---|
| Avanzar desde Faro Digital y darle otra vuelta al estilo. | Base aceptada y commit local pedido por el dueño, 22/10. | Conservar el escenario empresarial y experiencia original; refinamiento visual como próximo lote. La base aceptada no implica diseño final ni paridad completa. |
| La demo debe representar una empresa. | Instrucción explícita del dueño, 22/10. | Faro Digital: población y áreas explícitas, personas/equipos/accesos compartidos entre vistas y casos investigables. Datos nuevos, cifras derivadas y conclusiones con evidencia, sobre UI original. |
| Inventario multi-herramienta, cruces e inferencias, priorizando la experiencia ya construida. | Aclaración explícita del dueño, 22/10. | Preservar la UI original y contratos Python. El experimento reducido no es diseño objetivo ni gate para Go. Netskope, CyberArk y CrowdStrike son parte de la dirección; CrowdStrike no tiene adaptador implementado. |
| Portfolio, autohospedado y evaluar SaaS si tiene éxito. | Decidido por el dueño, 21/10. | El primer lote es una demo sintética; SaaS no dirige la arquitectura inicial. |
| Backend Go y producto extensible más allá de CyberArk/Netskope. | Decidido por el dueño, 21/10. | Base nueva; conectores por contrato y conexión. No traducir toda la v1. |
| Limpiar el repositorio y rehacer documentación. | Pedido del dueño, revisión 22/10 UTC. | Se retira el árbol heredado en `product/go-reset`; la historia y la v1 en ejecución permanecen como referencia. |
| Retirar el acoplamiento a Okta. | Pedido del dueño. | Sin configuración/grupos corporativos heredados. OIDC genérico sigue siendo una opción de producto. |
| Switchboard como camino inicial; OIDC genérico para instalaciones independientes. | Recomendación de esta revisión, no integración aceptada. | Contrato en [acceso](ACCESS.md); requiere trabajo en ambos extremos. Custodia mantiene autorización. |
| Go modular + PostgreSQL, React para UI, SQL explícito. | Recomendación técnica. | Fijar herramientas/versiones con el primer recorrido Go; todavía no hay módulo Go. |
| Actualizar observaciones válidas de una parcial, con marca parcial y sin bajas ni reemplazo de línea base completa. | Implementado en el modelo; pendiente de aceptación de la demo. | Conservar ese contrato en Go y distinguir parcial de snapshot completo. |
| Grafito de Portfolio con acento azul; guion móvil desplegable. | Experimento técnicamente probado; descartado como dirección visual del producto tras aclaración del dueño. | Conservar sus archivos como exploración. La identidad objetivo sigue siendo la de Custodia original. |
| Estilo «Grafito» para el producto: sólo oscuro, minimalista, una señal cian (degradé cian→violeta en puntos de marca), Geist, personas en círculo y herramientas en cuadrado. | Pedido del dueño el 22/10: libertad total de estilo; descartó la vuelta «Plano» (claro, papel cuadriculado) por poco minimalista y sin estilo, y pidió sólo modo oscuro. | Reemplaza la identidad verde de la v1 y la vuelta «Plano». La firma se concentra en los primitivos de `company-demo/src/theme/grafito.css`. |
| Interfaz e identidad visual nuevas en `web/`, sin derivar de DSHub: marca de dos registros cruzados, lima sólo para marca y acción, color de procedencia por tipo de fuente, veredicto con forma. | Pedido del dueño el 22/10: «crear desde 0», cambiar también el login, y un color con patrón o sistema específico. | Rama `product/custodia-ui`. Conserva el modelo y la regla CONN-001. El 22/10 el dueño pidió retirar `company-demo/` («sacale lo viejo»); queda en Git (`71c68de`). Ver [WEB.md](WEB.md). |
| Sitio en inglés por defecto (`/`, español en `/es/`), animado; empresa ficticia Acme Corp con personas genéricas; logos de CyberArk, Netskope y BigID junto a su nombre. | Pedido del dueño el 22/10 («siempre primero en inglés», «falta animación», «Alice en Acme Corp», «podés usar los logos de antes»). | Los logos quedan sujetos a `PROD-DIST-001`. La demo sigue en español. |

La limpieza no certifica derechos de distribución, borra historia Git ni
declara retirado el despliegue anterior. Tampoco aprueba publicación, SaaS,
migración de datos o integración de inventarios con SIGEA.

Las decisiones específicas de tenants de la v1 no se trasladan como reglas
universales. Consultarlas en `f6a7acc` cuando sirvan de evidencia para un
adaptador nuevo. Los próximos cambios de dirección deben registrar aquí
su motivo y modificar el [tracker](TO_IMPLEMENT.md).
