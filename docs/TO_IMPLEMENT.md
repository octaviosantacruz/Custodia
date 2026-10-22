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
| `PROD-DEMO-001` | Implementada; falta la aceptación del dueño | UI de Conexiones, Inventario y Cambios con detalle/historia. Build independiente sin `.env`; navegación por teclado, foco, estados de error y lectura pública en pantalla estrecha. Recorrido completo probado, sin afirmar backend real. **Hecho:** `demo/` (React 19, Vite 8, TypeScript 7, versiones exactas) con las tres vistas, panel de detalle con evidencia, revisión e historial, guion Anterior/Siguiente/Reiniciar, ES/EN y los estados cargando, sin conexiones, sin conexión con la fuente, permiso insuficiente y error recuperable con controles explícitos; 10 pruebas en Chromium sobre el build (guion completo, Sur intacto, teclado y foco, ES/EN, 375 px sin desplazamiento lateral, axe WCAG A/AA por vista y estado, cero peticiones fuera del origen). **Falta:** que el dueño la mire y la acepte (de ahí depende `PROD-GO-001`); medir el contraste del diseño final si se alinea con Portfolio. Mover a IMPLEMENTED al aceptarla. |
| `PROD-DIST-001` | En curso; antes de compartir/publicar | Registrar procedencia de código/assets nuevos o reutilizados, revisar material del árbol e historia Git y decidir licencia/distribución con el dueño. La historia laboral no se publica automáticamente con la demo. **Hecho:** registro de procedencia del código, los datos y las dependencias del build de la demo en [PROVENANCE.md](PROVENANCE.md). **Falta:** revisión del árbol y la historia Git, y la decisión de licencia/distribución con el dueño. |
| `PROD-SHOW-001` | Bloqueado por PROD-DEMO-001 y PROD-DIST-001 | Entregar caso ES/EN, capturas originales, artifact reproducible y límites a Portfolio bajo CROSS-009. Build local y enlaces/claims revisados; publicación requiere pedido explícito. |
| `PROD-GO-001` | Bloqueado por aceptación local de PROD-DEMO-001 | Módulo Go, API/worker con apagado ordenado, PostgreSQL independiente, roles mínimos y migrador explícito con status/up. Versiones fijadas, instalación vacía y gate propio. No espera publicación de Portfolio. |
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
