# Custodia — instrucciones del producto

Leer primero README.md, docs/TO_IMPLEMENT.md y el documento del área afectada.
El contexto compartido está en `/home/saint/projects/AGENTS.md`.

- Producto personal: demo Portfolio primero, autohospedado Go después y SaaS
  sólo tras validar uso. No traducir toda la aplicación anterior ni copiar
  su backlog laboral. Estado actual: documentación, sin aplicación.
- Backend objetivo Go; PostgreSQL autoridad; React/TypeScript para interfaz.
  Versiones y dependencias se fijan al implementar. No hay librería compartida
  ni importación aprobada con SIGEA.
- Aislar registros por conexión, colección e ID externo. No unir fuentes por
  nombre/correo ni inferir cobertura, riesgo o rotación desde otros campos.
- Conservar procedencia y completitud. Una corrida parcial no permite bajas.
  El sync no sobrescribe decisiones humanas. Autorizar y auditar mutaciones
  en el backend, incluyendo exportaciones y ejecución de jobs.
- Leer docs/ACCESS.md antes de tocar identidad. No confiar en headers por
  estar en loopback, confundir túnel mTLS con identidad del usuario, ni hacer
  fallback automático a login local. Custodia conserva su autorización.
- Demo sólo con datos sintéticos. No leer/copiar secretos, inventarios,
  dominios, grupos o contratos privados. Referencias de secretos, sin valores.
- La versión anterior se consulta por Git en `f6a7acc` o en su checkout;
  sus migraciones aplicadas son inmutables. El producto tendrá base e historia
  nuevas, migración explícita y pruebas en destinos descartables.
- Los IDs viven sólo en docs/TO_IMPLEMENT.md y docs/IMPLEMENTED.md. Mover
  cierres con evidencia; distinguir diseño, código, prueba y despliegue.
- `npm run verify` valida sólo esta base documental. Al implementar, añadir
  gates apropiados y ejecutarlos. No reportar suites de la versión anterior
  como prueba del producto nuevo.
- Preservar cambios ajenos. No cambiar servicios activos, despliegues,
  credenciales, datos o historia Git por limpiar el árbol del producto.
  No commit, push ni publicación sin pedido explícito.
