# Documentación de DS Hub

Esta documentación es interna del repositorio y contiene decisiones operativas
y hallazgos sobre el entorno de CyberArk. No debe incluir secretos, exports ni
respuestas API reales completas.

## Seguimiento

- [Por implementar](TO_IMPLEMENT.md): fuente central del backlog, prioridades,
  bloqueos y criterios de cierre. Los demás documentos aportan contexto y
  evidencia, pero no mantienen un estado paralelo.
- [Implementado](IMPLEMENTED.md): índice de trabajo cerrado, commits y
  evidencia resumida. No contiene tareas activas.

## Arquitectura

- [Contratos de integración](architecture/integration-contracts.md): contratos
  confirmados y límites de PAM, Identity Administration y SIA.
- [Modularidad](architecture/modularity.md): responsabilidades y límites entre
  rutas, servicios, repositorios, integraciones y frontend.

## Producto

- [Revisión KR1](product/kr1-safe-review.md): alcance y calidad del inventario
  de Safes.

## Métricas

- [Publicación privada con Cloudflare](operations/cloudflare-dshub-meeting.md):
  referencia histórica de Tunnel + Access para `dshub.itti.digital` (`DEP-001`
  y `DEP-002` cerrados).
- [Despliegue](operations/deployment.md): imágenes, migraciones y requisitos
  del orquestador.

Los documentos históricos redundantes fueron retirados; las decisiones vigentes
se mantienen en `TO_IMPLEMENT.md`, `IMPLEMENTED.md` y los contratos de
arquitectura enlazados arriba.
