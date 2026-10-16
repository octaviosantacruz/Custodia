---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-06
---

# Consumir la API de DS Hub desde Postman

Importar estos dos archivos con **Import** en Postman:

- [Colección de API](../../api/postman/DSHub.postman_collection.json).
- [Entorno de ejemplo](../../api/postman/DSHub.postman_environment.json).

Seleccionar el entorno y cambiar `base_url` por la URL del backend, sin `/api`
ni barra final. La colección contiene las operaciones publicadas en OpenAPI,
agrupadas por lectura/escritura y área. Consume DS Hub; no se conecta a
PostgreSQL ni directamente a CyberArk o Netskope.

## Autenticación

**Lectura con token personal:** completar `read_token` con un token emitido
desde una sesión autenticada por `POST /api/auth/api-tokens`. Tiene duración
limitada (5–480 minutos) y los permisos actuales del usuario. Se utiliza como
`Authorization: Bearer`. No permite guardar clasificaciones ni otras escrituras.

**Sesión local:** en modos local/hybrid, completar `email` y `password` y enviar
`POST /api/auth/login`. Postman conserva la cookie. Para emitir un token,
enviar `POST /api/auth/api-tokens` con esa cookie y un cuerpo como
`{"label":"Postman","expires_in_minutes":60}`; copiar el token devuelto a
`read_token`. El secreto se devuelve una sola vez. En modo OIDC, obtener el
token desde una sesión de navegador autenticada; el login local no está disponible.

**Escritura:** las operaciones que lo aceptan usan `write_token` en
`X-Access-Token`, el token técnico configurado por el administrador y atribuido
al actor configurado. Los permisos se comprueban en el servidor. Como alternativa,
seleccionar **No Auth** en la petición para usar una cookie de sesión válida.
Las operaciones exclusivamente de sesión ya usan **No Auth** y el cookie jar.
El token técnico no sirve para lectura. `bootstrap_token` sólo corresponde al
bootstrap inicial cuando está habilitado.

Mantener credenciales como valores privados/locales de Postman; no exportarlas
ni compartir el entorno una vez completado. Los archivos del repositorio no
incluyen credenciales. Más detalles: [Autenticación](authentication.md).

## Usar las peticiones

- En **Params**, activar sólo los filtros necesarios. Los opcionales vienen
  desactivados; los valores por defecto documentados se conservan.
- Completar las variables de ruta (`object_id`, `safe_id`, etc.) con IDs obtenidos
  del inventario. Las variables específicas se pueden agregar al entorno.
- Los cuerpos JSON son **plantillas para editar**, no decisiones aprobadas:
  revisar campos, enumeraciones, referencias y fechas antes de enviar. `date`
  debe usar `YYYY-MM-DD`, `datetime` una fecha ISO 8601 con zona horaria, y `uuid`
  un UUID válido cuando la operación lo requiera.
- Enviar escrituras individualmente tras revisar su contenido. Ejecutar toda
  la colección con Runner también enviaría sus escrituras.

### Cambios recientes de Netskope

La colección incluye:

- `GET /api/cmdb/netskope/device-reviews/summary`.
- Las rutas de clasificación por equipo y el lote de sugerencias se retiraron
  el 2026-10-13 (`NSK-INV-002`).
- Los filtros `review_diagnosis`, `review_status`, `event_age`, `evidence_state`
  y `freshness` de `GET /api/cmdb/netskope/devices`; la fase 2 agrega
  `review_attention` y `review_suggestion`.

Para listar equipos sin clasificar con más de 30 días desde el último evento,
activar `event_age=gt_30d`, `freshness=all` y `review_diagnosis=undetermined`.
Para abrir la cola de revisión manual, usar `review_suggestion=none`:
equipos activos con evento válido de más de 30 días, sin clasificación ni
sugerencia automática. Requiere sync vigente; no es una sugerencia aceptable en
lote. Se pueden combinar los filtros de SO, empresa y clasificación Netskope.
La clasificación humana no retira equipos ni modifica la evidencia sincronizada.
El contrato público de equipos Netskope ya no expone heartbeat: la antigüedad de eventos y la
vigencia del sync son señales distintas.

## Regenerar y verificar

OpenAPI es la fuente; no editar a mano la colección generada:

```bash
backend/.venv/bin/python scripts/build_postman_collection.py
backend/.venv/bin/python scripts/build_postman_collection.py --check
```

La generación registra rutas sin iniciar el backend, conectar a PostgreSQL ni
consultar proveedores. Utiliza el entorno inerte de `dump_openapi.py`. El chequeo
de sincronización forma parte de `npm run verify`; cualquier cambio de rutas,
parámetros, cuerpos o autenticación requiere regenerar el archivo.
