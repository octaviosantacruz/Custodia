---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-19
---

# Configuración del entorno y secretos

`.env.example` es la plantilla versionada; `.env.local` contiene la configuración
del entorno y permanece fuera de Git. Ambos siguen el mismo orden: HTTP, base de
datos, sesión, OIDC, automatización, sincronización, herramientas CyberArk,
Netskope e inspección manual. Los bloques opcionales de la plantilla están
comentados: completarlos sólo con el contrato y los permisos del tenant.

Los secretos viven en archivos individuales dentro de `.secrets/`, también
excluida de Git. Los `.env` sólo guardan sus rutas mediante variables `*_FILE`.
No copiar valores de los archivos locales a logs, tickets, chats o commits.

## Archivos de secretos

| Variable | Contenido del archivo |
|---|---|
| `DATABASE_PASSWORD_FILE` | Contraseña PostgreSQL; la conexión base va sin contraseña en `DATABASE_URL`. |
| `SESSION_SECRET_FILE` | Secreto aleatorio de sesión de al menos 32 bytes; requerido en los tres modos de autenticación. |
| `OIDC_CLIENT_SECRET_FILE` | Secreto del cliente OIDC aprobado. |
| `APP_WRITE_TOKEN_FILE` | Token técnico para escrituras con `X-Access-Token`; no concede lectura. |
| `AUTH_BOOTSTRAP_TOKEN_FILE` | Token para crear el primer administrador; retirar después del alta. |
| `CA_SECRET_FILE` | Secreto OAuth de PAM; también lo usan Connector Manager y Risk Management. |
| `CA_IDENTITY_ADMIN_SECRET_FILE` | Secreto OAuth configurado explícitamente para Identity Administration. |
| `CA_SIA_SECRET_FILE` | Secreto OAuth configurado explícitamente para SIA. |
| `CA_ACCESS_SECRET_FILE` | Secreto OAuth configurado explícitamente para Access space. |
| `NETSKOPE_API_TOKEN_FILE` | Token Netskope con los permisos aprobados. |
| `SIA_PROBE_TOKEN_FILE` | Token específico de la sonda manual SIA; no es el secreto OAuth. |

Cada archivo contiene sólo el valor, sin `NOMBRE=`, comillas ni JSON adicional.
Usar permisos `0600` para `.env.local` y los archivos de secretos, y `0700`
para el directorio `.secrets/`. Ejecutar los comandos desde la raíz del checkout:
las rutas relativas a secretos se resuelven respecto del directorio de trabajo.
Configurar una ruta requiere provisionar su archivo; dejar sin configurar las
opciones que el entorno no utilice. Las credenciales de cada herramienta siguen
siendo explícitas, aunque el tenant autorice compartir un archivo.

Los nombres inline anteriores siguen soportados por compatibilidad, pero no
forman parte de la plantilla recomendada. Evitar configurar ambas formas:
sesión, OIDC, tokens técnicos y Netskope prefieren el archivo; los clientes
CyberArk conservan su prioridad histórica del valor inline sobre el archivo.
No se cambió esa precedencia al ordenar los `.env`.

## Carga y recuperación de base de datos

El backend de desarrollo carga `.env.local` mediante el wrapper y Uvicorn.
`scripts/run_with_database_secret.py` y los comandos que lo utilizan aceptan
`ENV_FILE` para elegir otro archivo; las variables ya presentes en el entorno
del proceso prevalecen sobre el archivo. No todos los probes aceptan ese override:
consultar la ayuda del comando concreto.

El wrapper combina `DATABASE_URL` y `DATABASE_PASSWORD_FILE` en memoria.
Si está configurado `DATABASE_SECRET_ID`, valida la conexión y solicita
`AWSCURRENT` a AWS Secrets Manager sólo cuando falta la URL o PostgreSQL
rechaza la credencial. `DATABASE_SECRET_REGION` es opcional si AWS CLI ya
resuelve la región. Nunca escribe la credencial recuperada en un `.env`.

La persistencia de una contraseña recuperada requiere el mecanismo explícito
`scripts/refresh_database_password.sh` o su timer instalado. Ver
[despliegue y mantenimiento](deployment.md). Reordenar la configuración no
rota credenciales ni reinicia servicios.

## Opciones de operación

`AUTH_MODE` admite `local`, `oidc` y `hybrid`. OIDC requiere issuer, cliente,
callback, origen y claim de grupos aprobados; `hybrid` mantiene también el login
local. `OIDC_DEFAULT_ROLE` vacío significa sin acceso por defecto. Mantener
`ALLOW_SELF_REGISTER_SETUP=false` y usar `SESSION_HTTPS_ONLY=true` en producción
con HTTPS. Ver [autenticación](authentication.md).

`WEB_ORIGIN` y `WEB_ORIGINS` contienen orígenes explícitos, nunca `*`.
`EXPOSE_API_DOCS=false` deshabilita Swagger y OpenAPI cuando el backend puede
quedar expuesto. `API_MAX_BODY_BYTES` limita las solicitudes `/api`.

`INGESTION_INTERVAL_MINUTES` es la frecuencia general. `SYNC_SOURCE_INTERVALS`
es un JSON de fuente o tarea a minutos; una tarea prevalece sobre su fuente.
Un intervalo de `0` deshabilita la ejecución programada y cualquier intervalo
activo debe ser de al menos cinco minutos. `SYNC_MAX_CONCURRENT_SOURCES`
admite de una a cinco fuentes (tres por defecto). Revisar el presupuesto de
llamadas antes de cambiar frecuencias: [políticas de sincronización](deployment.md).

Las rutas opcionales Netskope habilitan capacidades independientes. La medición
de experiencia en oficina puede realizar aproximadamente 1.200 llamadas por
día hábil; la sugerencia de golden release consulta documentación pública y
requiere confirmación administrativa. Los contratos y aprobaciones Advanced
Analytics quedan al final de Netskope para separar sus JSON del inventario
básico. No completar contratos o hashes a partir de candidatos de discovery.
Ver [contratos CyberArk](../architecture/integration-contracts.md) y
[API Netskope](../architecture/netskope-api.md).

Para comparar las claves de los dos archivos sin mostrar sus valores, usar la
sección «Archivos de entorno» de [comandos clave](comandos-clave.md).
Después de cambiar valores operativos se requiere reiniciar el proceso para
que los vuelva a cargar; un cambio de orden o comentarios conserva la
configuración interpretada.
