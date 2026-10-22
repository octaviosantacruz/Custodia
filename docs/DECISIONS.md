---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Decisiones del nuevo inicio

| Decisión | Estado y origen | Consecuencia |
|---|---|---|
| Portfolio, autohospedado y evaluar SaaS si tiene éxito. | Decidido por el dueño, 21/10. | El primer lote es una demo sintética; SaaS no dirige la arquitectura inicial. |
| Backend Go y producto extensible más allá de CyberArk/Netskope. | Decidido por el dueño, 21/10. | Base nueva; conectores por contrato y conexión. No traducir toda la v1. |
| Limpiar el repositorio y rehacer documentación. | Pedido del dueño, revisión 22/10 UTC. | Se retira el árbol heredado en `product/go-reset`; la historia y la v1 en ejecución permanecen como referencia. |
| Retirar el acoplamiento a Okta. | Pedido del dueño. | Sin configuración/grupos corporativos heredados. OIDC genérico sigue siendo una opción de producto. |
| Switchboard como camino inicial; OIDC genérico para instalaciones independientes. | Recomendación de esta revisión, no integración aceptada. | Contrato en [acceso](ACCESS.md); requiere trabajo en ambos extremos. Custodia mantiene autorización. |
| Go modular + PostgreSQL, React para UI, SQL explícito. | Recomendación técnica. | Fijar herramientas/versiones con el primer recorrido; no hay dependencias instaladas. |

La limpieza no certifica derechos de distribución, borra historia Git ni
declara retirado el despliegue anterior. Tampoco aprueba publicación, SaaS,
migración de datos o integración de inventarios con SIGEA.

Las decisiones específicas de tenants de la v1 no se trasladan como reglas
universales. Consultarlas en `f6a7acc` cuando sirvan de evidencia para un
adaptador nuevo. Los próximos cambios de dirección deben registrar aquí
su motivo y modificar el [tracker](TO_IMPLEMENT.md).
