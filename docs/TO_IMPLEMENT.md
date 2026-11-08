---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-11-08
---

# Pendientes del producto

Único backlog del nuevo Custodia. No incluye tickets ni operación del entorno
laboral. Los cierres pasan a [IMPLEMENTED.md](IMPLEMENTED.md). La coordinación
con Portfolio y Switchboard vive en los trackers del workspace.

| ID | Estado / dependencia | Entrega y aceptación |
|---|---|---|
| `PROD-UI-001` | Sustituido por `PROD-UI-002`; `company-demo/` retirado el 22/10 | La UI recuperada de DSHub queda en Git (`71c68de`) como referencia de recorridos para la paridad. No se amplía. |
| `PROD-STYLE-001` | Descartado el 22/10; superado el 08/11 | Las vueltas «Plano» y «Grafito» sobre `company-demo/` no se conservan. El 08/11 el dueño decidió lo contrario de «no derivar de DSHub»: `web/` es el frontend de DSHub con la marca de Custodia (ver `PROD-UI-002`). |
| `PROD-UI-002` | Reemplazado el 08/11 por la base DSHub; en uso | `web/` es el frontend de DSHub con la marca y los colores de Custodia, datos de Acme Corp, español e inglés ([WEB.md](WEB.md)). `npm run verify:web` pasa salvo fallas previas conocidas. **Falta:** sumar las demás herramientas (endpoint, vulnerabilidades, firewalls) con contrato; recorridos de edición contra el servidor Go. |
| `PROD-SITE-001` | Publicado el 22/10 en `custodia.octaviosantacruz.com` con Switchboard (deployment de `6376925`); quedan pendientes residuales | Sitio de producto (inglés por defecto, `/es/`), animado, con casos de uso enlazados a la demo, y demo en `/demo/` ([WEB.md](WEB.md#qué-hay-en-el-repo)). Aceptación pública: `200` en `/`, `/es/` y `/demo/`, asset con hash idéntico al build, `404` en `/.env` y `/_headers`, HTTP→HTTPS, recorrido completo en Chromium bajo la CSP real. El dueño confirmó publicar la regla CONN-001 y los logos (`PROD-DIST-001`). **Falta:** enlazar desde Portfolio y traducir la demo al inglés. |
| `PROD-PARITY-001` | Listo; antes de sustituir endpoints | Completar matriz por recorrido: UI, endpoint, request/response, permisos, normalización, reglas, transacción/auditoría y regresiones Python/TS. Base en [revisión existente](EXISTING-PRODUCT.md). Definir primer lote Go sobre esa matriz, no sobre el fixture reducido. |
| `PROD-CORR-001` | Listo para contrato | Extender cruces e inferencias ya existentes: resolver identidades y candidatos, versionar reglas por alcance, evidencias/frescura, desconocidos y permisos de todas las fuentes. Conservar vistas de Personas/cobertura. No fundir datos originales ni inventar confianza numérica. |
| `PROD-CS-001` | Candidato solicitado; después del contrato y la base de conectores | Incorporar CrowdStrike al registro conservando experiencia y dominios. Definir colección/caso de uso, campos permitidos, identidad de equipo, permisos, paginación/frescura y fixture sintético antes de conector real. Sin soporte implementado ni probes implícitos. |
| `PROD-DEMO-001` | Experimento conservado; deja de dirigir el producto | La demo reducida está implementada y probada; la interfaz vigente es `web/` (PROD-UI-002). No ampliarla como reemplazo ni pedir su aceptación como gate para Go. El fixture es un ejemplo, no paridad de Python. |
| `PROD-DIST-001` | Repositorio público con licencia Apache 2.0 desde el 08/11 | [Procedencia](PROVENANCE.md) registrada. **Falta:** avisos de terceros del frontend recuperado (dependencias y logos) y revisar que la historia Git no contenga material laboral antes de promocionar el repositorio. |
| `PROD-SHOW-001` | Sitio y demo publicados con Acme Corp | Sitio con casos (Alice, Bob, Eve) enlazados a la demo, capturas por idioma. **Falta:** enlazar desde Portfolio y una captura o video del servidor Go detrás de Ozal cuando haya instalación publicada. |
| `PROD-GO-001` | En curso desde el 08/11 en `feat/go-server`; primer recorrido listo | `server/`: módulo Go, PostgreSQL con migraciones `goose` y `custodia migrate up` explícito, seed sintético de Acme. Personas y cobertura (CONN-001) servidas con las mismas respuestas que la demo (golden de `acme-api.ts`), detrás de la aserción de Ozal. Evidencia: `npm run verify:server` con base descartable, recorrido en Chromium con aserciones firmadas por Ozal. **Falta:** conectores (`PROD-CONN-001`), roles (`PROD-AUTH-001`) y las demás vistas. |
| `PROD-AUTH-001` | Bloqueado por PROD-GO-001 | Principal emisor/sujeto, usuarios habilitados, permisos/alcances por conexión y auditoría; administración inicial mediante comando local explícito sin contraseña predeterminada. Adaptador falso para QA y modo local-dev sólo si hace falta, con rechazo fuera de desarrollo/loopback. Pruebas de lecturas, exportaciones, jobs y escrituras denegadas. |
| `PROD-SB-001` | Implementado en lo esencial el 08/11 (Ozal `feat/identity-assertion` + `server/internal/identity`) | Aserción firmada por petición (EdDSA, 60 s, `jti`) verificada con clave fijada, loopback obligatorio y rechazo sin aserción ([acceso](ACCESS.md)). **Falta:** vínculo emisor/sujeto con usuarios de autorización (`PROD-AUTH-001`), replay compartido para más de una instancia y la aceptación con dos usuarios reales detrás de Ozal publicado. |
| `PROD-CONN-001` | Bloqueado por PROD-GO-001 y PROD-AUTH-001 | Registro estático, descriptor y configuración por conexión, referencias de secretos, probe y colecciones según [contrato](CONNECTORS.md). Adaptador de laboratorio contra servidor HTTP local: límites, paginación, errores y aislamiento de dos conexiones. |
| `PROD-INV-001` | Bloqueado por PROD-CONN-001 | Persistir staging/publicación, historial y decisiones auditadas. PostgreSQL descartable: fencing tras lease vencido, retries idempotentes, alcance/generación distinta sin bajas, parcial/error/duplicados sin retiros y edición humana concurrente sin pérdidas. |
| `PROD-REAL-001` | Candidato; después de PROD-INV-001 | Elegir un adaptador real read-only acotado. Candidato: Safes PAM. Aprobar contrato, allowlist, fixtures nuevos y probe autorizado en laboratorio; no extender soporte a todo un fabricante por una colección. |
| `PROD-OPS-001` | Bloqueado por PROD-INV-001, PROD-REAL-001 y PROD-SB-001 | Instalación autohospedada, TLS, secretos, backup y restore descartable; aceptar recorrido real con dos usuarios, restart y fallos recuperables según [validación](VALIDATION.md). Sin tocar la v1. |
| `PROD-OIDC-001` | Posterior al camino Switchboard; depende de PROD-AUTH-001 | Modo independiente: cliente OIDC genérico, Code + PKCE, state/nonce, validación de tokens y sesión revocable/CSRF. Proveedor simulado y luego laboratorio real, sin grupos/defaults corporativos. Revisar si hace falta antes de ampliar distribución. |
| `PROD-USE-001` | Bloqueado por PROD-OPS-001 y PROD-DIST-001 | Registrar uso recurrente externo, tarea resuelta y demanda de alojamiento. Reevaluar SaaS con evidencia y decisión del dueño; sin construir facturación o aislamiento multiempresa anticipadamente. |

Los nombres de modos y herramientas de arquitectura son propuestas hasta
implementación y aceptación. «Diseño listo» no significa integración funcional.
La demo no depende de login, del despliegue de Switchboard ni de OIDC.
