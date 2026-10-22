---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Pendientes del producto

Único backlog del nuevo Custodia. No incluye tickets ni operación del entorno
laboral. Los cierres pasan a [IMPLEMENTED.md](IMPLEMENTED.md). La coordinación
con Portfolio y Switchboard vive en los trackers del workspace.

| ID | Estado / dependencia | Entrega y aceptación |
|---|---|---|
| `PROD-UI-001` | En curso; base aceptada por el dueño el 22/10 | [Faro Digital](COMPANY-DEMO.md) en `company-demo/`: UI original recuperada, empresa coherente de seis personas, Personas/cobertura, cadena PAM, Safes e inventarios Netskope. El dueño acepta avanzar desde esta base y pide otra vuelta al estilo. **Falta:** adaptar o retirar módulos no incluidos, completar experiencia de edición y demás recorridos conforme a paridad. No confundir API sintética de lectura con backend funcional. |
| `PROD-STYLE-001` | Próximo lote; pedido del dueño el 22/10 | Refinar el estilo de Faro Digital desde la base aceptada: revisar jerarquía visual, tipografía, espaciado, densidad y presentación del contexto empresarial. Conservar flujos operativos, datos coherentes, evidencia, accesibilidad y estados ambiguos. Comparar capturas antes/después; la aceptación de la base no cierra el diseño final. |
| `PROD-PARITY-001` | Listo; antes de sustituir endpoints | Completar matriz por recorrido: UI, endpoint, request/response, permisos, normalización, reglas, transacción/auditoría y regresiones Python/TS. Base en [revisión existente](EXISTING-PRODUCT.md). Definir primer lote Go sobre esa matriz, no sobre el fixture reducido. |
| `PROD-CORR-001` | Listo para contrato | Extender cruces e inferencias ya existentes: resolver identidades y candidatos, versionar reglas por alcance, evidencias/frescura, desconocidos y permisos de todas las fuentes. Conservar vistas de Personas/cobertura. No fundir datos originales ni inventar confianza numérica. |
| `PROD-CS-001` | Candidato solicitado; después del contrato y la base de conectores | Incorporar CrowdStrike al registro conservando experiencia y dominios. Definir colección/caso de uso, campos permitidos, identidad de equipo, permisos, paginación/frescura y fixture sintético antes de conector real. Sin soporte implementado ni probes implícitos. |
| `PROD-DEMO-001` | Experimento conservado; deja de dirigir el producto | La demo reducida está implementada y probada, pero el dueño prioriza la UI original. No ampliarla como reemplazo ni pedir su aceptación como gate para Go. El fixture es un ejemplo, no paridad de Python. |
| `PROD-DIST-001` | En curso; antes de compartir/publicar | [Procedencia](PROVENANCE.md) registrada. Los avisos y el paquete con manifiesto SHA-256 cubren sólo el experimento anterior de `demo/`. **Falta para Faro Digital:** revisar el frontend recuperado, sus dependencias/logos y generar avisos propios; resolver licencia, distribución y eventual repositorio nuevo. El commit local y la aceptación de la base no equivalen a publicación. |
| `PROD-SHOW-001` | Base empresarial local disponible; distribución pendiente | Presentar Faro Digital sobre UI original, explicando personas, áreas, equipos, accesos y casos investigables. Material del experimento retenido en [presentación](PRESENTATION.md); no publicarlo como diseño aprobado. Rehacer el caso y las capturas de Portfolio a partir de la empresa, después de revisar la UI y procedencia; Go y CrowdStrike siguen previstos. |
| `PROD-GO-001` | Depende de PROD-PARITY-001 y del laboratorio de PROD-UI-001; sin gate de demo reducida | Módulo Go, PostgreSQL independiente y migrador explícito. Sustituir un recorrido tras la misma API del frontend original, con paridad de permisos, reglas y auditoría. Propuesta inicial: Personas/cobertura sintéticas de dos fuentes. Conservar fuente Python y pruebas de referencia durante transición. |
| `PROD-AUTH-001` | Bloqueado por PROD-GO-001 | Principal emisor/sujeto, usuarios habilitados, permisos/alcances por conexión y auditoría; administración inicial mediante comando local explícito sin contraseña predeterminada. Adaptador falso para QA y modo local-dev sólo si hace falta, con rechazo fuera de desarrollo/loopback. Pruebas de lecturas, exportaciones, jobs y escrituras denegadas. |
| `PROD-SB-001` | Diseño listo; implementación depende de PROD-AUTH-001 y contrato en Switchboard | Acordar opción C de ARCH-009 y resolver atribución ID-004. Aserción firmada verificada por petición, claves/rotación, replay compartido y revocación; sin sesión paralela que evada al gateway. Primero app descartable, luego Custodia con dos usuarios. Probar headers falsos/duplicados, firma/audiencia/issuer/exp inválidos, acceso directo IPv4/IPv6, logout y permisos. Ver [acceso](ACCESS.md). |
| `PROD-CONN-001` | Bloqueado por PROD-GO-001 y PROD-AUTH-001 | Registro estático, descriptor y configuración por conexión, referencias de secretos, probe y colecciones según [contrato](CONNECTORS.md). Adaptador de laboratorio contra servidor HTTP local: límites, paginación, errores y aislamiento de dos conexiones. |
| `PROD-INV-001` | Bloqueado por PROD-CONN-001 | Persistir staging/publicación, historial y decisiones auditadas. PostgreSQL descartable: fencing tras lease vencido, retries idempotentes, alcance/generación distinta sin bajas, parcial/error/duplicados sin retiros y edición humana concurrente sin pérdidas. |
| `PROD-REAL-001` | Candidato; después de PROD-INV-001 | Elegir un adaptador real read-only acotado. Candidato: Safes PAM. Aprobar contrato, allowlist, fixtures nuevos y probe autorizado en laboratorio; no extender soporte a todo un fabricante por una colección. |
| `PROD-OPS-001` | Bloqueado por PROD-INV-001, PROD-REAL-001 y PROD-SB-001 | Instalación autohospedada, TLS, secretos, backup y restore descartable; aceptar recorrido real con dos usuarios, restart y fallos recuperables según [validación](VALIDATION.md). Sin tocar la v1. |
| `PROD-OIDC-001` | Posterior al camino Switchboard; depende de PROD-AUTH-001 | Modo independiente: cliente OIDC genérico, Code + PKCE, state/nonce, validación de tokens y sesión revocable/CSRF. Proveedor simulado y luego laboratorio real, sin grupos/defaults corporativos. Revisar si hace falta antes de ampliar distribución. |
| `PROD-USE-001` | Bloqueado por PROD-OPS-001 y PROD-DIST-001 | Registrar uso recurrente externo, tarea resuelta y demanda de alojamiento. Reevaluar SaaS con evidencia y decisión del dueño; sin construir facturación o aislamiento multiempresa anticipadamente. |

Los nombres de modos y herramientas de arquitectura son propuestas hasta
implementación y aceptación. «Diseño listo» no significa integración funcional.
La demo no depende de login, del despliegue de Switchboard ni de OIDC.
