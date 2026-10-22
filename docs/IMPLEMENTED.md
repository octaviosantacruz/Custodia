---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Entregas y evidencia

| ID | Fecha UTC | Entrega | Evidencia y límite |
|---|---|---|---|
| `PROD-PLAN-001` | 2026-10-22 | Base documental nueva: producto, arquitectura Go, conexiones, acceso, diseño y aceptación. | Revisión estática de la v1 `f6a7acc` y del contrato actual de visitante de Switchboard. Separadas decisiones del dueño de recomendaciones. No hay código Go, demo, integración OIDC ni SSO implementados. |
| `PROD-CLEAN-001` | 2026-10-22 | Retiro del árbol heredado y reemplazo por la base del producto en `product/go-reset`. | Worktree separado, sin configurar runtime. `npm run verify` verde: 12 documentos, 33 enlaces locales y 15 IDs únicos. Verificador sin dependencias; sólo documentación. No se cambian servicios/bases de v1, ni se sanea historia Git, ni se publica. |
| `PROD-FIX-001` | 2026-10-22 | Guion del laboratorio como contrato: [fixture](../fixtures/lab/scenario.json) con dos conexiones, cinco corridas y lo esperado en cada paso; modelo puro en TypeScript (`demo/src/model/`) con observaciones, cambios y revisión en capas separadas. | `npm run verify`: los siete pasos contra lo esperado escrito a mano, más invariantes (Sur intacto, decisión conservada, reset exacto, sin mutación, alcance nuevo sin bajas, reaparición, parcial sin línea base, entradas rechazadas). Sin dependencias ni red. El backend Go deberá pasar el mismo fixture; no demuestra UI ni persistencia. |

`PROD-PLAN-001` y `PROD-CLEAN-001` quedaron en el commit `5dec025`. Esta tabla describe
la capacidad del árbol local; no demuestra una instalación pública ni un
producto ejecutable. Los siguientes lotes están en [pendientes](TO_IMPLEMENT.md).
