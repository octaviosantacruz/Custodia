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

Los archivos de esta entrega permanecen sin commit. Esta tabla describe
la capacidad del árbol local; no demuestra una instalación pública ni un
producto ejecutable. Los siguientes lotes están en [pendientes](TO_IMPLEMENT.md).
