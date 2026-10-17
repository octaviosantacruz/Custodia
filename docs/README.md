---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-09
---

# Documentación de Custodia

Custodia reúne inventarios de **CyberArk** y **Netskope** para que el equipo pueda
revisarlos, clasificarlos y entender sus métricas. Cada plataforma conserva
sus propios datos y permisos. [AGENTS.md](../AGENTS.md) explica el producto y
sus reglas.

| Quiero… | Leer |
|---|---|
| Saber qué falta y qué sigue | [Trabajo pendiente](tracking/TO_IMPLEMENT.md) |
| Saber qué ya se hizo | [Trabajo cerrado (índice)](tracking/IMPLEMENTED.md); detalle por periodo en `tracking/done/` |
| Consultar lo aparcado o descartado | [Trabajo diferido](tracking/BACKLOG_ARCHIVE.md) |
| Registrar tareas y relacionarlas con Jira | [Guía de seguimiento](tracking/README.md) |
| Instalar, actualizar u operar el servicio | [Despliegue](operations/deployment.md) |
| Configurar el acceso (OIDC, tokens, permisos administrativos) | [Autenticación](operations/authentication.md) |
| Consumir la API con Postman | [Colección y autenticación](operations/postman.md) |
| Consultar inventario desde PostgreSQL | [Vistas SQL y permisos](operations/reporting-views.md) |
| Saber qué datos externos podemos consumir | [Contratos de integración](architecture/integration-contracts.md) |
| Saber qué APIs de Netskope existen y cuáles usamos | [API de Netskope](architecture/netskope-api.md) |
| Entender las métricas Netskope, AA y la carga | [Métricas Netskope](architecture/netskope-metrics.md) |
| Entender la clasificación de equipos Netskope sin eventos (NSK-DEVREV-001) | [Revisión operativa de equipos Netskope](architecture/netskope-device-review.md) |
| Saber dónde pertenece cada parte del código | [Modularidad](architecture/modularity.md) |
| Ver qué endpoints existen y qué acceso exige cada uno (generado) | [Referencia de la API](architecture/api-reference.md) |
| Ver qué roles existen y qué permisos reúne cada uno (generado) | [Catálogo de roles y permisos](architecture/access-catalog.md) |
| Conocer las decisiones sancionadas que limitan el código (con su test) | [Decisiones (ADR)](architecture/decisions/README.md) |

El [historial](history/README.md) conserva planes, reuniones y revisiones de su
fecha; es un archivo local ignorado por Git y puede no existir en otro checkout.

## Frontmatter de cada documento

Todo `.md` de `docs/` empieza con un bloque mínimo, comprobado por `npm run docs:check`
(parte de `npm run verify`):

```yaml
---
estado: vigente        # vigente | histórico
dueño: Nombre Apellido # quién responde por el contenido
revisado: 2026-10-09   # AAAA-MM-DD de la última revisión del contenido
---
```

- `vigente`: describe el sistema o el proceso tal como está. Si pasan más de 90 días sin
  actualizar `revisado`, el chequeo avisa (no falla): revisarlo o marcarlo histórico.
- `histórico`: registro de una fecha (planes, cierres, handoffs, revisiones). Puede citar rutas e
  IDs que ya no existen; los agentes lo ignoran salvo que se pida el contexto. Todo lo de
  `history/` y `tracking/done/` es histórico.
- `revisado` se actualiza al revisar el contenido, no por cada edición menor.
  Los valores iniciales salen de la fecha del último cambio en git (o del archivo, en `history/`).

**Una sola fuente de trabajo activo:** `tracking/TO_IMPLEMENT.md`;
`tracking/BACKLOG_ARCHIVE.md` conserva lo aparcado y retirado sin duplicar filas
activas. No mantener listas de pendientes distintas en cada documento. Esta
documentación es interna: no incluir secretos ni respuestas API completas.
