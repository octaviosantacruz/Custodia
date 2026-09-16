# Despliegue

**Docker queda pospuesto por ahora.** `backend/Dockerfile` y
`frontend/Dockerfile` se quitaron del repositorio (2026-09-11); este
documento describe el diseño de despliegue previsto para cuando se retome,
no el estado actual del repo. La orquestación, PostgreSQL y la gestión de
secretos son responsabilidad del entorno de despliegue; el repositorio no
incluye Compose ni archivos `.env.docker`.

## Configuración requerida

El backend necesita:

- `DATABASE_URL` apuntando a PostgreSQL.
- Las variables de CyberArk y el secreto montado como
  `/run/secrets/ca_secret`.
- `SESSION_SECRET` estable entre reinicios.
- `AUTH_MODE=local`, `hybrid` u `oidc`, según el flujo elegido.
- `WEB_ORIGIN` y `OIDC_REDIRECT_URI` cuando se usa OIDC.
- `EXPOSE_API_DOCS=false` (PENTEST-010) en cualquier ambiente donde el
  puerto del backend sea alcanzable sin pasar por el proxy/frontend;
  por defecto expone Swagger/ReDoc/`openapi.json` sin sesión.

No incluir secretos en imágenes, commits, logs ni archivos de configuración
versionados. El frontend sólo necesita la configuración de su servidor web;
Nginx sirve la SPA y proxifica `/api` hacia el backend.

## Imágenes (diseño futuro, no ejecutable hoy)

**IF-012:** los comandos de esta sección son pseudocódigo bloqueado hasta
que `backend/Dockerfile`/`frontend/Dockerfile` existan de nuevo en el
repositorio. No copiarlos a un checkout actual: fallarán porque los
archivos no existen.

```bash
# Diseño previsto, NO funciona en el estado actual del repo:
docker build -f backend/Dockerfile -t dshub-backend .
docker build -f frontend/Dockerfile -t dshub-frontend .
```

El orquestador debe publicar el frontend por HTTPS, resolver el upstream del
backend que espera `frontend/nginx.conf` y entregar al backend `DATABASE_URL`
y `/run/secrets/ca_secret`.

## Migraciones

Las migraciones son secuenciales e inmutables. La aplicación no las ejecuta al
iniciar: deben aplicarse como paso controlado del despliegue.

En un checkout con el entorno configurado (esto sí funciona hoy):

```bash
./scripts/migrate.sh
```

Dentro de la imagen backend (diseño futuro, depende de la imagen que hoy no
existe — ver la sección "Imágenes" arriba):

```bash
python /app/scripts/migrate.py
```

El runner registra las versiones en `public.schema_migrations`, aplica sólo
las pendientes y valida las tablas requeridas. Antes de migrar, confirmar
backup, destino de `DATABASE_URL` y posibilidad de restauración.

## Verificación y operación

Después del despliegue:

```bash
curl --fail https://HOST/api/health
```

El endpoint debe indicar `status=ok`. Mantener PostgreSQL fuera de la imagen,
poner HTTPS delante del frontend y configurar rate limiting en el proxy para
las rutas públicas de autenticación. Para el primer usuario en modo local,
usar `POST /api/auth/bootstrap` con un token temporal y retirarlo después.

### Liveness vs. readiness (IF-017)

`/api/health` (y `/health`) es **readiness**: confirma que el proceso puede
llegar a PostgreSQL (`SELECT 1`). Si un orquestador lo usa como *liveness*,
una caída de PostgreSQL puede hacer que reinicie procesos backend sanos y
agrave la indisponibilidad en vez de aislarla.

Usar en su lugar:

- **Liveness** (`/api/health/live`, `/health/live`): no toca la base, sólo
  confirma que el proceso responde. Configurar acá el `livenessProbe`.
- **Readiness** (`/api/health/ready`, `/api/health`, `/health/ready`,
  `/health`): confirma DB alcanzable. Configurar acá el `readinessProbe`
  (o el chequeo que decide si el balanceador envía tráfico a esa réplica).

Para rollback, detener el despliegue si falla una migración y restaurar el
backup mediante el procedimiento del DBA. No borrar tablas ni editar
migraciones ya aplicadas.

## Checklist de hardening de proxy/TLS (PENTEST-012)

Antes de un pentest externo o de exponer un ambiente nuevo, confirmar en el
proxy/balanceador (no en este repositorio, que no lo controla):

- [ ] `server_tokens off;` (u equivalente) para no anunciar versión de Nginx.
- [ ] TLS 1.2+ únicamente, sin CBC/RC4/3DES; suites alineadas a Mozilla
      "Intermediate" o más estricto.
- [ ] Redirect `HTTP → HTTPS` incondicional en el puerto 80.
- [ ] `Strict-Transport-Security` con `includeSubDomains` y `preload` sólo si
      el dominio realmente sirve todo por HTTPS de forma permanente.
- [ ] Páginas de error del proxy/WAF (403/502/504) no filtran headers
      defensivos que sí aplica el backend (`X-Content-Type-Options`,
      `X-Frame-Options`, CSP) — confirmarlas con `curl -i` contra un caso de
      error real.
- [ ] Caching del proxy no sirve respuestas autenticadas (`/api/*`) a otra
      sesión; `Cache-Control` explícito en rutas sensibles si el proxy no lo
      respeta por defecto.
- [ ] El puerto 8000 (backend) y 5432 (PostgreSQL) no son alcanzables desde
      fuera de la red interna — ver también `EXPOSE_API_DOCS` (PENTEST-010).

El CSP de `frontend/nginx.conf` ya no usa `unsafe-inline` en `style-src`
(sólo en `style-src-attr`, que cubre los `style={{...}}` inline de React sin
habilitar `<style>`/`CSSStyleSheet` inyectados). `AUD-API-002` (ningún
endpoint declara `response_model`) queda registrado como mejora de
mantenibilidad, no como vulnerabilidad activa; no se re-abre acá.
