# Custodia — instrucciones del producto

Leer primero README.md, docs/TO_IMPLEMENT.md y el documento del área afectada.
El contexto compartido está en `/home/saint/projects/AGENTS.md`.

## Dirección corregida por el dueño — 08/11

Custodia es DS Hub renombrado y publicado como código abierto (Apache 2.0).
`web/` es el frontend de DS Hub con la marca de Custodia: misma estructura,
estilo y registro de herramientas. Se construye en dos modos: contra la API
real (`npm run build`) o como demo estática con la API simulada de
`src/demo/mock-api.ts` (`npm run build:demo`), la misma que usan las pruebas
e2e. `site/` es el sitio de producto (inglés y español) y enlaza a la demo.
Esto reemplaza la decisión del 22/10 de no derivar de la UI de DS Hub.

Nunca copiar datos del empleador de origen: dominios, nombres de empresas o
grupos, hosts, remotos ni credenciales. La demo y las pruebas usan sólo
nombres ficticios (`acme.example`, Globex, Initech).

Los flujos y reglas de `/home/saint/projects/Custodia` siguen siendo
referencia de contratos: leer docs/EXISTING-PRODUCT.md.
Custodia inventaría herramientas de ciberseguridad (Netskope, CyberArk,
CrowdStrike y otras) y permite cruces e inferencias explicables. La demo
reducida es un experimento; no define producto, paridad ni UI objetivo y su
aceptación deja de bloquear Go. La referencia contractual está en Python.

- Producto personal: demo Portfolio primero, autohospedado Go después y SaaS
  sólo tras validar uso. No traducir toda la aplicación anterior ni copiar
  su backlog laboral. Demo vigente: `web/` con `npm run build:demo`,
  publicada como proyecto de Pages aparte; ver docs/WEB.md. La UI propia del
  22/10 se retiró (consultar `617f460`). `demo/` conserva el experimento reducido.
  Sin backend Go ni autenticación real.
- Backend objetivo Go; PostgreSQL autoridad; React/TypeScript para interfaz.
  Versiones y dependencias se fijan al implementar. No hay librería compartida
  ni importación aprobada con SIGEA.
- Aislar registros por conexión, colección e ID externo. Cruces e inferencias
  requieren regla explícita, evidencia, vigencia, alcance y permisos de las
  fuentes usadas. Preservar reglas ya construidas sin hacerlas universales.
- Conservar procedencia y completitud. Una corrida parcial no permite bajas.
  El sync no sobrescribe decisiones humanas. Autorizar y auditar mutaciones
  en el backend, incluyendo exportaciones y ejecución de jobs.
- Leer docs/ACCESS.md antes de tocar identidad. No confiar en headers por
  estar en loopback, confundir túnel mTLS con identidad del usuario, ni hacer
  fallback automático a login local. Custodia conserva su autorización.
- Demo sólo con datos sintéticos. No leer/copiar secretos, inventarios,
  dominios, grupos o contratos privados. Referencias de secretos, sin valores.
  Representar una empresa coherente: población explícita, personas, áreas,
  equipos y accesos compartidos entre vistas; cifras derivadas del mismo
  escenario y conclusiones explicadas. No inventar evidencia de otras herramientas.
- La versión anterior se consulta por Git en `f6a7acc` o en su checkout;
  sus migraciones aplicadas son inmutables. El producto tendrá base e historia
  nuevas, migración explícita y pruebas en destinos descartables.
- Los IDs viven sólo en docs/TO_IMPLEMENT.md y docs/IMPLEMENTED.md. Mover
  cierres con evidencia; distinguir diseño, código, prueba y despliegue.
- `npm run verify` valida la documentación y el modelo del ejemplo;
  `npm run verify:demo` compila la demo y recorre el guion en un navegador.
  `npm run verify:web` verifica la interfaz de `web/` (tipos, lint, estilos,
  unitarias y e2e); `verify:demo` sigue reservado al experimento de `demo/`.
  Al implementar Go, añadir su gate y ejecutarlo. No reportar suites de la
  versión anterior como prueba del producto nuevo.
- Las dependencias de `demo/` van con versión exacta. Cambiar el modelo
  (`demo/src/model`) exige mantener de acuerdo el fixture y sus pruebas: el
  experimento debe conservar su contrato, sin sustituir la paridad con Python.
- Preservar cambios ajenos. No cambiar servicios activos, despliegues,
  credenciales, datos o historia Git por limpiar el árbol del producto.
  No commit, push ni publicación sin pedido explícito.
