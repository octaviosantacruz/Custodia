---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-05
---

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
- Opcionalmente, `DATABASE_SECRET_ID` y `DATABASE_SECRET_REGION` para que los
  comandos locales versionados y el propio pool del backend recuperen la
  credencial vigente desde AWS Secrets Manager si PostgreSQL rechaza la
  contraseña configurada (al arrancar y también mientras el proceso corre,
  ver más abajo).
  La credencial recuperada vive sólo en memoria. Si `DATABASE_PASSWORD_FILE`
  quedó desactualizado tras una rotación, el aviso del preflight lo dice; las
  herramientas que lean ese archivo directamente (cliente SQL, `psql`) lo
  actualizan con `scripts/refresh_database_password.sh`, que valida la
  contraseña de AWS contra PostgreSQL y la escribe con permisos 0600 sin
  imprimirla. La app y `migrate.sh` no lo necesitan.
- Las variables de CyberArk y el secreto montado como
  `/run/secrets/ca_secret`.
- `SESSION_SECRET` estable entre reinicios.
- `AUTH_MODE=local`, `hybrid` u `oidc`, según el flujo elegido.
- `WEB_ORIGIN` y `OIDC_REDIRECT_URI` cuando se usa OIDC.
- `EXPOSE_API_DOCS=false` (PENTEST-010) en cualquier ambiente donde el
  puerto del backend sea alcanzable sin pasar por el proxy/frontend;
  por defecto expone la referencia de API (Scalar) y `openapi.json` sin sesión.

No incluir secretos en imágenes, commits, logs ni archivos de configuración
versionados. El frontend sólo necesita la configuración de su servidor web;
Nginx sirve la SPA y proxifica `/api` hacia el backend.

El fallback de Secrets Manager está implementado en
`scripts/run_with_database_secret.py` y se usa en `npm run web:backend` y
`scripts/migrate.sh`. Requiere AWS CLI ya autenticado y permiso mínimo
`secretsmanager:GetSecretValue`; si el secreto usa una clave KMS administrada
por el cliente, la identidad también necesita `kms:Decrypt`. El diseño futuro
de contenedores/orquestación debe usar la integración nativa de secretos del
entorno en vez de depender de AWS CLI dentro de la imagen.

Esa recuperación por AWS CLI sólo corre una vez, al arrancar el proceso. Si
RDS rota la contraseña maestra mientras el backend ya está corriendo, el pool
de conexiones (`backend/app/db.py`) usa un `conninfo` dinámico
(`DatabaseCredentialProvider`, armado en `lifecycle.py`) en vez de una cadena
fija: `psycopg_pool` lo vuelve a invocar en cada intento de conexión nuevo, y
su hook `reconnect_failed` dispara la misma recuperación guardada (probar la
credencial actual, y sólo si el propio PostgreSQL la rechaza — incluida la
variante `no pg_hba.conf entry for host ...` que RDS también usa para esto,
no sólo `password authentication failed` — consultar `DATABASE_SECRET_ID`).
No requiere reiniciar el servicio a mano; sí requiere que `DATABASE_SECRET_ID`
esté configurado en el entorno del backend, no sólo en el del script de
arranque.

### Remotos y diagnóstico

El checkout conserva cuatro remotos: `itti` es el SSH activo; `gvz` es el
original personal; `origin` y `Cybersecurity-Org` son aliases de la
organización. No se sincronizan solos: se hace push explícito al remoto
correcto. Los logs del servicio se consultan con `journalctl -u custodia` y en
`/var/log/custodia/`; nunca copiar secretos desde ellos.

`npm run verify` incluye los tests con PostgreSQL real mediante un cluster
efímero local: usa `initdb` en un directorio temporal, sólo socket local y
`trust`, ejecuta las migraciones y borra el cluster al terminar. No lee
`DATABASE_URL` ni `.env.local`; `CUSTODIA_TEST_DATABASE_URL` existe únicamente en
ese proceso. Si faltan binarios de PostgreSQL el gate falla de forma explícita;
`CUSTODIA_SKIP_PG=1` permite omitirlo deliberadamente. El aprovisionamiento y la
recuperación de respaldo productivos se ejecutan con el runbook interno
aprobado, fuera del repositorio.

## Imágenes (diseño futuro, no ejecutable hoy)

**IF-012:** los comandos de esta sección son pseudocódigo bloqueado hasta
que `backend/Dockerfile`/`frontend/Dockerfile` existan de nuevo en el
repositorio. No copiarlos a un checkout actual: fallarán porque los
archivos no existen.

```bash
# Diseño previsto, NO funciona en el estado actual del repo:
docker build -f backend/Dockerfile -t custodia-backend .
docker build -f frontend/Dockerfile -t custodia-frontend .
```

El orquestador debe publicar el frontend por HTTPS, resolver el upstream del
backend que espera `frontend/nginx.conf` y entregar al backend `DATABASE_URL`
y `/run/secrets/ca_secret`.

## Despliegue actual en este host (systemd, sin Docker)

Mientras la ruta de contenedores está pospuesta (ver arriba), el ambiente de
prueba/staging en este host corre con `npm run deploy` (migraciones pendientes,
build del frontend + backend en `:8000` + `vite preview` del frontend en `:5173`) supervisado por
`systemd`, para que el proceso siga arriba aunque se cierre la sesión SSH y
se reinicie solo si se cae o si el servidor rebootea.

Unit instalada en `/etc/systemd/system/custodia.service` (no versionada en el
repo porque depende de rutas absolutas de este host — `nvm`, usuario `ubuntu`,
etc.; una copia de referencia queda documentada acá):

```ini
[Unit]
Description=Custodia (backend + frontend production preview)
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/Custodia
Environment=PATH=/home/ubuntu/.nvm/versions/node/v24.19.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/home/ubuntu/.nvm/versions/node/v24.19.0/bin/npm run deploy
Restart=always
RestartSec=5
KillMode=control-group
LogsDirectory=custodia
Environment=CUSTODIA_LOG_DIR=/var/log/custodia
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Notas del diseño:

- `Type=simple` + `Restart=always`: si `npm run deploy` (o cualquiera de sus
  hijos, backend/frontend) muere, systemd reinicia todo el árbol de procesos
  a los 5s.
- `KillMode=control-group`: al parar el servicio, systemd mata también a
  `concurrently`, `uvicorn` y `vite preview` (procesos hijos), no sólo al PID
  principal de `npm`.
- `Environment=PATH=...` incluye el `bin` de la versión de Node instalada vía
  `nvm` para ese usuario, porque los servicios de systemd no heredan el shell
  profile (`.bashrc`/`nvm.sh`) de una sesión interactiva.
- Los mensajes de despliegue quedan en `/var/log/custodia/deploy.log` (y también
  en el journal de `custodia.service`) y los
  procesos se separan en `/var/log/custodia/backend.log` y
  `/var/log/custodia/frontend.log`. `LogsDirectory=custodia` crea el directorio
  bajo `/var/log` con permisos para el usuario del servicio.
- `WantedBy=multi-user.target` + `systemctl enable`: arranca automáticamente
  en cada boot del servidor, sin intervención manual.

Instalación/actualización en un host nuevo (ajustar rutas de usuario/nvm si
difieren):

```bash
sudo cp deploy/custodia.service /etc/systemd/system/custodia.service   # o pegar el contenido de arriba
sudo cp deploy/custodia.logrotate /etc/logrotate.d/custodia
sudo systemctl daemon-reload
sudo systemctl enable --now custodia.service
```

Operación diaria:

```bash
sudo systemctl status custodia      # ver estado y últimos procesos
sudo systemctl restart custodia     # reiniciar (p.ej. tras git pull / npm install)
sudo systemctl stop custodia        # bajar el servicio
tail -f /var/log/custodia/backend.log       # backend
tail -f /var/log/custodia/frontend.log      # frontend/Vite
journalctl -u custodia -f                    # migraciones, build y supervisor
```

### Contraseña y migraciones de PostgreSQL automáticas

La app y las migraciones recuperan automáticamente la contraseña desde AWS
en memoria. Para mantener vigente también `DATABASE_PASSWORD_FILE` para
clientes SQL y otras herramientas y aplicar migraciones pendientes, instalar
el timer optativo (ajustar
`User` y `WorkingDirectory`/`ExecStart` si cambia el checkout):

```bash
sudo install -m 0644 deploy/custodia-database-password.service deploy/custodia-database-password.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now custodia-database-password.timer
sudo systemctl start custodia-database-password.service
systemctl list-timers custodia-database-password.timer
journalctl -u custodia-database-password.service -n 20 --no-pager
```

El servicio corre como `ubuntu`, carga `.env.local` con el script existente y
usa las credenciales AWS del mismo usuario (incluido el rol IAM de la instancia).
Requiere `DATABASE_SECRET_ID`, `DATABASE_URL`, AWS CLI y permiso
`secretsmanager:GetSecretValue`; respeta `DATABASE_SECRET_REGION` y
`DATABASE_PASSWORD_FILE`. No guarda secretos en las units ni los imprime.
Comprueba el archivo un minuto después del boot y cada cinco minutos desde
que termina el intento anterior. Sólo consulta AWS si el archivo falta o no
funciona; valida la contraseña contra PostgreSQL y reemplaza el archivo
atómicamente con permisos 0600. Si falla, conserva el archivo anterior,
registra el fallo en el journal y vuelve a intentar en el siguiente intervalo.
El archivo puede quedar desactualizado hasta el próximo intento; la app y las
migraciones tienen su propia recuperación y no dependen de ese intervalo.
Después de actualizar o validar el archivo, systemd ejecuta `scripts/migrate.sh`.
Si el primer paso falla, no ejecuta el segundo. El runner aplica sólo las
migraciones pendientes presentes en el checkout, conserva el historial en
`schema_migrations` y usa su advisory lock para serializar ejecuciones con
el despliegue. Un fallo deja el servicio en estado fallido y el timer vuelve
a intentarlo en el siguiente intervalo. El intento completo tiene un límite
de 15 minutos. Los archivos nuevos de migración se ejecutarán automáticamente
cuando lleguen a este checkout; el timer no hace `git pull`, build ni reinicio.
`npm run deploy` sigue aplicando las migraciones antes de arrancar la app.
Para deshabilitarlo:
`sudo systemctl disable --now custodia-database-password.timer`.

### Actualización de dependencias Python

Detener el servicio antes de instalar paquetes en `backend/.venv`. Python
conserva módulos importados en memoria; actualizar sus archivos mientras el
backend está activo puede mezclar dos versiones de una misma biblioteca.
Las sincronizaciones pueden fallar con `ImportError` aunque un proceso nuevo
y `pip check` funcionen correctamente. Se observó este caso con AnyIO y
`cannot import name 'get_coro_name'`.

```bash
sudo systemctl stop custodia
backend/.venv/bin/python -m pip install --require-hashes -r backend/requirements.lock.txt
backend/.venv/bin/python -m pip check
backend/.venv/bin/python -c 'import asyncio, anyio; asyncio.run(anyio.sleep(0))'
sudo systemctl start custodia
curl --fail --silent --show-error http://127.0.0.1:8000/api/health/ready
```

Si la instalación o la comprobación fallan, corregir el entorno antes de
iniciar el servicio. Si los paquetes ya se actualizaron con el backend
activo, reiniciar tras validar el entorno y comprobar una nueva corrida:
el reinicio no cambia el estado de las corridas fallidas históricas ni
demuestra por sí solo que una sincronización completa haya terminado.

### Errores operativos desde Custodia

El workspace **Actividad → Errores del sistema**, disponible sólo con
`access:manage`, muestra los errores internos no controlados desde la
migración `055`: hora, referencia de request, método, ruta y clase técnica.
No guarda ni muestra mensajes de excepción, stack traces, headers, cuerpos,
SQL, tokens o secretos. Al usuario que recibe un `500` se le muestra la misma
referencia, para correlacionar el incidente sin revelar detalles internos.

Para una investigación de infraestructura que requiera la traza completa,
un operador del host puede buscar esa referencia en `/var/log/custodia/backend.log`.
No copiar líneas que contengan secretos a tickets, chats o commits.

Limitaciones a tener presentes:

- Cada arranque/reinicio del servicio corre `web:build` de nuevo (porque
  `npm run deploy` lo incluye), lo que agrega ~10-15s antes de que el
  frontend responda. Si esto molesta, separar el build del arranque en dos
  pasos (`ExecStartPre` para build, `ExecStart` sólo para servir) es la
  mejora natural.
- `vite preview` (`web:frontend:prod`) no es un servidor de producción
  hardenizado; sirve para este ambiente de prueba mientras no se retoma la
  ruta Nginx/Docker de la sección anterior.
- `ufw` está inactivo en este host; si el sitio no es alcanzable desde
  afuera, revisar el Security Group/firewall de la nube (fuera del alcance
  de este repositorio), no `ufw`.
- El puerto 8000 del backend no debería quedar expuesto directamente a
  Internet — ver el checklist de hardening de proxy/TLS más abajo y
  `EXPOSE_API_DOCS` (PENTEST-010).

## Migraciones

Las migraciones son secuenciales e inmutables. El paso controlado del despliegue
es `npm run deploy`, que ejecuta primero el runner idempotente mediante
`scripts/deploy.sh`; si una migración falla, el
backend y el frontend no se arrancan y el error queda en la salida del deploy
y en `/var/log/custodia.log`. Esto evita que el servicio publique una aplicación
que no puede completar su startup por esquema incompleto.

Los cambios del cache DLP requieren las migraciones `063`, `064` y `065`.
Estas migraciones deben aplicarse antes de que la versión nueva del backend
inicie el poller o atienda Investigación. En systemd se debe usar
`npm run deploy`, o ejecutar primero `./scripts/migrate.sh` y recién después
reiniciar el servicio; no arrancar manualmente el código nuevo con el esquema
anterior.

Para aplicar o verificar migraciones sin arrancar el servicio:

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
backup, destino de `DATABASE_URL` y posibilidad de restauración. Para
identificar si la base corre en RDS/Aurora o PostgreSQL autogestionado y usar
el respaldo correcto, seguir el runbook aprobado para ese entorno, fuera del
repositorio.

## Política de sincronización por fuente

`INGESTION_INTERVAL_MINUTES` es el intervalo por defecto (0 = apagado). Para
dar a una fuente su propia cadencia se define `SYNC_SOURCE_INTERVALS` como JSON
(`{"netskope": 30}`); las claves deben ser fuentes o tareas registradas o el
backend no arranca, y cada valor es 0 o al menos 5. `SYNC_MAX_CONCURRENT_SOURCES` (1-5,
por defecto 3) limita las fuentes simultáneas: el pool tiene 8 conexiones y
cada fuente activa retiene una para su lock. Cambiar cualquiera de las dos
requiere reiniciar el servicio. Una fuente vence desde su última corrida
correcta y, tras un fallo, reintenta con backoff exponencial antes de volver
a su intervalo (detalle en `integration-contracts.md`). Si el scheduler no
encola nada, revisar primero que la fuente tenga su contrato configurado y que
no haya una corrida en cola o en curso.

El panel **Actividad → Agenda** muestra una fila por tarea registrada
(`task_key`), aunque varias tareas compartan `source_system` y su lock. La
precedencia del intervalo es: override administrativo persistido > override
`SYNC_SOURCE_INTERVALS` por tarea > override por fuente > política de tarea/fuente
> `INGESTION_INTERVAL_MINUTES`. El override persistido puede ser `0` (apaga esa
tarea) o al menos 5 minutos; dejarlo vacío lo elimina y vuelve a heredar. Sólo
`access:manage` puede cambiarlo, y el cambio se audita junto con la actualización
en la misma transacción. La variable de entorno sigue teniendo prioridad sobre
la política estática, pero no sobre un ajuste administrativo explícito; las
variables de entorno siguen aplicándose al reiniciar el servicio.

### Tareas programadas dentro de una fuente (`SYNC-TASK-001`)

`source_system` identifica de quién son los datos; `task_key` (columna de
`cyberark_ingestion_runs`, migración `078`) identifica qué trabajo programado
generó la corrida. Cadencia, vencimiento, backoff, reintentos y racha de fallos
se calculan por `task_key`; el lock advisory sigue siendo por fuente, así que
las tareas de una misma fuente se ejecutan en serie. Una fuente con una sola
tarea usa su propio nombre como `task_key`, por lo que nada cambia para
Identity Administration, SIA ni Access. PAM (`SYNC-TASK-002`, migración `079`)
tiene dos tareas de la fuente `cyberark`: `pam_safes` (`cyberark-api`, con la
reconciliación completa que retira Safes) y `pam_psm` (`cyberark-psm-api`, el
refresh aislado del catálogo PSM). Cada una tiene su historial, backoff y
cadencia; el nombre `cyberark` en `SYNC_SOURCE_INTERVALS` sigue cubriendo a las
dos y `pam_psm` o `pam_safes` lo ajustan por separado. Las corridas históricas
de PAM se reasignan por `source_file`/`psm_only`.

Netskope se divide en tareas independientes (la tabla lista las cinco):

| `task_key` | Contenido | Se programa si |
|---|---|---|
| `netskope_inventory` | Usuarios, dispositivos y DEM; es la única que reconcilia y retira registros | el contrato de Netskope está configurado |
| `netskope_alerts` | Agregados de alertas (NSK-ALR-001) y su purga a 180 días | `NETSKOPE_ALERT_PATH` está definido |
| `netskope_uci` | Último UCI de usuarios con calificación baja o moderada (NSK-UBA-002) | `NETSKOPE_UCI_PATH` es la ruta aprobada |
| `netskope_golden_release` | Release golden desde la documentación pública de Netskope, sólo como sugerencia (NSK-GOLDEN-001); una vez por día | `NETSKOPE_GOLDEN_RELEASE_URL` es la URL aprobada |
| `netskope_dlp` | Captura de incidentes DLP (NSK-DLP-001); un error de captura falla sólo esta tarea | `NETSKOPE_DLP_INCIDENTS_PATH` es el endpoint aprobado |
| `netskope_office_experience` | Puntaje ADEM de los tramos en oficina y en remoto de cada persona que fue a la oficina, por día UTC completo (NSK-EXP-OFFICE-001); cada 3 h mide hasta dos días pendientes de los últimos 7 (~1.200 consultas por día hábil) | `NETSKOPE_OFFICE_EXPERIENCE_PATH` es la ruta aprobada (`/api/v2/adem/users/getinfo`) |

`SYNC_SOURCE_INTERVALS` acepta el nombre de la fuente (`"netskope": 30` aplica
a sus tres tareas) o el de una tarea (`"netskope_dlp": 10`); la entrada de la
tarea gana. Las corridas anteriores a la migración conservan su historial: el
Netskope combinado cuenta como `netskope_inventory`. El botón «Sincronizar
ahora» de Netskope encola las tareas configuradas y devuelve la corrida de
inventario. Desplegar con `./scripts/migrate.sh` antes de reiniciar el backend.

### Observabilidad de la agenda (`SYNC-OBS-001`)

`GET /api/ingestion/schedules` agrega por tarea `freshness` (`fresh`, `stale` o
`unknown`), `intervals_since_success` y `stale_after_intervals` (3). Una tarea es
`stale` cuando pasaron más de 3 intervalos efectivos desde su última corrida
correcta (`completed` o `partial`, igual que el scheduler). Sin tarea configurada,
con intervalo 0 o sin ninguna corrida correcta registrada el estado es `unknown`:
no se muestra banner ni se afirma frescura. Cada workspace avisa sólo por las
fuentes que declara en `refreshSources`. `GET /api/ingestion/sources/{source}/stages/history`
(`runs`, 1-50, por defecto 10) devuelve duración y filas por capa de las últimas
corridas finalizadas; la vista de Sincronizaciones resume mediana de duración, filas
de la última corrida correcta y corridas con fallo. Ambos usan sólo metadatos
operativos, sin payloads.

## Verificación y operación

Después del despliegue:

```bash
curl --fail https://HOST/api/health
```

Después de publicar cambios de Netskope, comprobar que el proceso cargó la
versión nueva antes de probar la UI. Sin credenciales, una ruta protegida debe
responder `401` (no `404`); por ejemplo:

```bash
curl -i https://HOST/api/cmdb/netskope/devices
```

Con una sesión/token autorizado, esa ruta devuelve el inventario de equipos.
El endpoint retirado `/api/cmdb/netskope/dlp/status` responde siempre
`410 Gone`: la investigación de incidentes/eventos DLP individuales está
postergada y sólo se mantienen agregados count-only de alertas en
`/api/cmdb/netskope/alerts`. Un `404` en cualquiera de esas rutas indica que
el proceso systemd todavía ejecuta una versión anterior, aunque `/api/health`
responda `200`.

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
