# Prueba local de OIDC con Okta

El soporte OIDC ya está implementado en DS Hub. Esta guía deja el entorno
local listo para probarlo apenas IAM entregue la configuración de Okta.

## Datos que debe entregar IAM

- `issuer` exacto del authorization server.
- `client_id` y `client_secret` del cliente OIDC.
- Redirect URI autorizada: `http://localhost:8000/api/auth/callback` para la
  prueba local, o la URL pública exacta si la prueba se hace detrás del proxy.
- Scopes y claims incluidos en el ID token, especialmente el claim de grupos.
- Nombres exactos de los grupos que se mapearán a `reader`, `operator` y
  `admin`.

No se deben adivinar el issuer, los grupos ni el contenido de los claims.

## Checklist de configuración de grupos en Okta (authorization server)

El mapeo grupo→rol interno (`OIDC_GROUP_CLAIM`, `OIDC_ROLE_MAP_JSON`) ya está
implementado y probado en `backend/app/services/oidc_mapping.py`. Lo que
falta antes de habilitarlo en un entorno real es configuración del lado de
Okta, no código. Verificar cada punto explícitamente con quien administra el
tenant de Okta:

1. **El claim de grupos debe estar en el ID token** (no alcanza con que exista
   en el perfil del usuario). En el authorization server de Okta: Claims →
   agregar un claim (nombre exacto = el valor que se usará en
   `OIDC_GROUP_CLAIM`, por defecto `groups`) con "Include in token type:
   ID Token", filtrado por los grupos relevantes (ver punto 2).
2. **Límite de grupos en el ID token.** Okta omite el claim de grupos por
   completo (no lo manda vacío: lo saca del token) si el usuario pertenece a
   más grupos que el límite configurado (default histórico ~100). Configurar
   siempre un **Groups Claim Filter** (por prefijo/regex, ej. `dshub-.*`) para
   que el claim sólo incluya los grupos que DS Hub necesita mapear, en vez de
   depender de que ningún usuario supere el límite alguna vez. Sin este
   filtro, un usuario con muchos grupos puede autenticarse con éxito y caer
   silenciosamente en `OIDC_DEFAULT_ROLE` (o sin rol, si no hay default) sin
   ningún error visible.
3. **Dónde se configura y si hace falta un scope.** El claim se agrega en
   Okta Admin Console → **Security → API → Authorization Servers** →
   el authorization server usado (si `OIDC_ISSUER_URL` termina en
   `/oauth2/default`, es el server custom llamado `default`, no el "org
   authorization server" — la pantalla de configuración es distinta) →
   pestaña **Claims** → **Add Claim**. Ahí hay dos formas de liberar el
   claim, y determinan si hace falta tocar `OIDC_SCOPES`:
   - **"Include in token type: ID Token" + "Always"**: el claim viaja
     siempre que se emite un ID token. No hace falta ningún scope extra;
     `OIDC_SCOPES=openid profile email` (el actual) alcanza.
   - **Scope-gated** (atado a un scope específico, que puede no llamarse
     literalmente "groups"): sólo viaja si el login pide ese scope
     exacto. En ese caso agregarlo a `OIDC_SCOPES`.
   **Confirmado (2026-09-12) para el tenant de producción: está en
   "Always".** `OIDC_SCOPES=openid profile email` alcanza tal cual está;
   no agregar ningún scope de grupos al pasar a prod. Con el flujo
   Authorization Code que usa DS Hub (vía `authlib`), el ID token del
   callback ya trae los claims decodificados directamente ("fat ID
   token" en la terminología de Okta) -- no hace falta un llamado aparte
   a `/userinfo` una vez que el claim esté configurado.
4. **Grupos asignados a la app, no sólo usuarios individuales.** Confirmar en
   Okta → Applications → el cliente OIDC → Assignments, que el acceso se
   otorga por grupo (Group assignment), no por usuario individual uno por
   uno. Asignar usuarios individualmente sigue autenticando correctamente,
   pero no ejercita el camino de mapeo por grupo que se quiere probar.
5. **`OIDC_DEFAULT_ROLE` nunca debe ser un rol privilegiado sin que
   `OIDC_ROLE_MAP_JSON` tenga contenido real.** Si el mapa queda vacío (sin
   configurar todavía, o mal escrito), *todo* login OIDC exitoso cae en el
   default, sin importar el grupo real del usuario. El backend emite un
   `WARNING` en el log de arranque (`app.services.oidc_mapping`) cuando
   detecta esta combinación con OIDC habilitado; no bloquea el arranque,
   pero no debe ignorarse antes de exponer el ambiente a más usuarios.

## Punto de partida elegido (2026-09-12): 3 grupos, no 12

DS Hub ya tiene 12 roles internos (`reader`, `operator`, `admin`, más 9 roles
granulares por dominio: `cyberark_*`, `sia_reader`, `identity_reader`,
`bigid_*`, `netskope_*`), pero sólo `admin` tiene usuarios reales asignados
hoy. En vez de crear un grupo de Okta por cada uno de los 12 desde el día
uno, se arranca con los 3 roles base únicamente; los roles granulares por
dominio se siguen asignando a mano desde Acceso y Permisos hasta que haya
volumen real que justifique un grupo de Okta dedicado a, por ejemplo,
`cyberark_operator`.

Grupos a crear en Okta (todavía no existen, pendiente de quien administra el
tenant):

| Grupo Okta (a crear) | Rol interno |
|---|---|
| `dshub-admins` | `admin` |
| `dshub-operadores` | `operator` |
| `dshub-lectores` | `reader` |

```dotenv
OIDC_DEFAULT_ROLE=reader
OIDC_ROLE_MAP_JSON={"dshub-admins":"admin","dshub-operadores":"operator","dshub-lectores":"reader"}
```

`OIDC_DEFAULT_ROLE=reader` (no `admin`): mientras los grupos no existan o el
claim no llegue con esos nombres exactos, cualquiera que se autentique por
Okta entra con acceso de sólo lectura, nunca administrador. Ampliar este
mapa (agregar `cyberark_operator`, `sia_reader`, etc.) es sólo editar el
JSON y reiniciar el backend -- no requiere migración ni cambio de schema.

## Checklist de corte a producción

Cuando IAM entregue `issuer`/`client_id`/`client_secret` del tenant real, lo
único que cambia respecto a este documento son esos tres valores y la URL
pública. Ya confirmado, no hace falta reverificar en cada corte:

- El claim `groups` está configurado como **Always** en el authorization
  server de producción (confirmado 2026-09-12) → **no** agregar ningún
  scope de grupos a `OIDC_SCOPES`; se deja `openid profile email`.
- El código de mapeo grupo→rol (`OIDC_GROUP_CLAIM`, `OIDC_ROLE_MAP_JSON`,
  `sync_oidc_role_assignments`) no cambia entre preview y producción; es el
  mismo authlib/OIDC estándar en ambos casos.

Lo que sigue pendiente de IAM antes del corte:

- Confirmar que los grupos `dshub-admins`/`dshub-operadores`/`dshub-lectores`
  (o los nombres reales que decidan) existen en el tenant de producción y
  tienen gente asignada.
- Confirmar el **Groups Claim Filter** en el authorization server de
  producción (evitar `.*`; usar un patrón que sólo incluya los grupos de
  DS Hub, para no depender del límite de Okta de grupos por ID token).
- `OIDC_REDIRECT_URI` y `WEB_ORIGIN` con la URL pública real (no
  `dshub.itti.digital` de prueba).
- `AUTH_MODE`: decidir si producción arranca en `hybrid` (login local +
  Okta disponibles) u `oidc` puro, según lo acordado en `PENTEST-003`.

## Activación local

En `.env.local`, completar el bloque comentado de preparación OIDC:

```dotenv
AUTH_MODE="hybrid"
OIDC_ISSUER_URL=<issuer-entregado-por-iam>
OIDC_CLIENT_ID=<client-id-entregado-por-iam>
OIDC_CLIENT_SECRET=<client-secret-entregado-por-iam>
OIDC_SCOPES=openid profile email
OIDC_REDIRECT_URI=http://localhost:8000/api/auth/callback
OIDC_GROUP_CLAIM=groups
OIDC_ROLE_MAP_JSON=<json-con-los-grupos-reales>
OIDC_DEFAULT_ROLE=
SESSION_HTTPS_ONLY=false
```

`hybrid` mantiene disponible el login local mientras se valida Okta. Para una
prueba OIDC exclusiva se puede usar `AUTH_MODE="oidc"`. Reiniciar `npm run web`
después de cambiar variables: se leen al arrancar el backend.

## Smoke test

1. Abrir `http://localhost:5173`.
2. Elegir **Okta corporativo**.
3. Completar el login y verificar el regreso a DS Hub.
4. Confirmar en el perfil que el `actor_id` corresponde al `sub` del proveedor
   y que los permisos coinciden con el grupo mapeado.
5. Probar logout y volver a entrar con un usuario de cada rol acordado.
6. Revisar el log de arranque del backend: si aparece el `WARNING` de
   `app.services.oidc_mapping` sobre `OIDC_DEFAULT_ROLE` sin mapeo, completar
   `OIDC_ROLE_MAP_JSON` antes de seguir probando.
7. Probar explícitamente un usuario que **no** pertenezca a ningún grupo
   mapeado: debe recibir `OIDC_DEFAULT_ROLE` (o quedar sin rol si está vacío),
   nunca el rol de un grupo al que no pertenece.

Si el backend falla al arrancar, revisar primero que las tres variables OIDC
obligatorias estén completas. Si el login vuelve con error de redirect, la URI
registrada en Okta debe coincidir exactamente con `OIDC_REDIRECT_URI`.

Los secretos deben permanecer únicamente en `.env.local` o en un gestor de
secretos; no se copian a este documento ni al repositorio.
