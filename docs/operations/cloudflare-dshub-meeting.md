# Reunión: publicación privada de DS Hub con Cloudflare

> Cerrado 2026-09-10 (`DEP-001` y `DEP-002`). Este documento conserva la
> agenda y los criterios técnicos de la publicación privada; el seguimiento
> vivo está en [`TO_IMPLEMENT.md`](../TO_IMPLEMENT.md).

## Objetivo

Publicar DS Hub con el nombre:

```text
https://dshub.itti.digital
```

El servidor de DS Hub no debe necesitar una IP pública ni aceptar conexiones
entrantes directas desde Internet. El acceso debe quedar protegido por
Cloudflare Tunnel y Cloudflare Access, conservando además la autenticación y
los permisos propios de DS Hub.

## Arquitectura propuesta

```text
Usuario autorizado
        |
        v
Cloudflare Access (IdP + MFA + política de acceso)
        |
        v
Cloudflare Tunnel
        |
        v
DS Hub / Nginx en la red privada (:8080 actualmente)
```

La modalidad recomendada para comenzar es un hostname público protegido por
Access. El registro DNS será visible, pero la IP del servidor seguirá privada y
el origen no deberá ser accesible directamente. Como alternativa más estricta,
se puede evaluar una aplicación privada que requiera Cloudflare One Client/WARP
en los dispositivos.

## Solicitud para el equipo de Cloudflare

Necesitamos que confirmen y, cuando se apruebe, configuren lo siguiente:

1. Confirmar que la zona `itti.digital` está administrada por Cloudflare y que
   la cuenta dispone de Cloudflare Zero Trust/Access.
2. Crear un Cloudflare Tunnel administrado remotamente para DS Hub.
3. Instalar `cloudflared` como servicio en el servidor de DS Hub o en un host
   que tenga conectividad hacia su IP privada.
4. Crear el hostname `dshub.itti.digital` y asociarlo al túnel.
5. Configurar como origen:
   - `http://localhost:8080` si `cloudflared` corre en el mismo servidor; o
   - `http://IP_PRIVADA:8080` si el conector corre en otro host de la red.
6. Crear una aplicación Cloudflare Access de tipo **Self-hosted** que proteja
   todo el hostname `dshub.itti.digital`.
7. Aplicar una política *deny by default*. Permitir preferentemente un grupo
   corporativo específico, por ejemplo `DS Hub Users` o `PAM Administrators`,
   en lugar de habilitar indiscriminadamente todo `@itti.digital`.
8. Exigir autenticación con el proveedor de identidad corporativo y MFA.
9. No crear reglas de bypass para `/api`, `/api/health` ni para las rutas de
   autenticación. Si una automatización necesitara acceso, evaluar un Service
   Token específico en vez de un bypass general.
10. Evitar caché sobre `/api/*` y sobre respuestas autenticadas.
11. Confirmar que el firewall permite las conexiones salientes requeridas por
    `cloudflared`, incluido TCP/UDP 7844.
12. Una vez validado el túnel, bloquear el acceso entrante al puerto 8080 desde
    redes no autorizadas. Idealmente, el puerto debe quedar alcanzable solo
    desde el host o segmento donde corre el conector.
13. Confirmar que al origen llegan correctamente el hostname solicitado y el
    esquema externo HTTPS (`Host` y `X-Forwarded-Proto`).
14. Definir responsables para administrar el túnel, las políticas Access, el
    grupo autorizado y la recuperación ante una caída del conector.

## Política de acceso sugerida

```text
Acción: Allow
Include: grupo corporativo DS Hub Users o PAM Administrators
Require: proveedor de identidad corporativo
Require: MFA
Default: Deny
```

Opcionalmente, se puede exigir Cloudflare One Client/WARP o una política de
postura de dispositivo para restringir el acceso a equipos corporativos.

## Preguntas para resolver en la reunión

- ¿`itti.digital` ya usa Cloudflare como DNS autoritativo o requiere una
  configuración CNAME parcial?
- ¿Qué proveedor de identidad se integrará con Access: Google Workspace,
  Microsoft Entra ID, Okta u otro?
- ¿Qué grupo exacto recibirá acceso a DS Hub?
- ¿Se exigirá MFA desde el primer despliegue?
- ¿Será suficiente el acceso desde cualquier navegador corporativo autenticado
  o debe exigirse WARP y postura del dispositivo?
- ¿Dónde se ejecutará `cloudflared` y quién administrará su token/configuración?
- ¿Se necesita alta disponibilidad con más de un conector?
- ¿Existen automatizaciones que consuman `/api` y necesiten Service Tokens?
- ¿Cloudflare aplicará WAF, rate limiting y registros de auditoría/retención?
- ¿Quién aprobará el cambio de firewall que cierre el acceso directo a `:8080`?

## Cambios posteriores en DS Hub

Una vez que Cloudflare confirme el hostname y el túnel, el despliegue de DS Hub
deberá configurar:

```dotenv
WEB_ORIGIN=https://dshub.itti.digital
SESSION_HTTPS_ONLY=true
```

Si se habilita OIDC dentro de DS Hub:

```dotenv
AUTH_MODE=oidc
OIDC_REDIRECT_URI=https://dshub.itti.digital/api/auth/callback
```

El callback deberá registrarse exactamente con esa URL en el proveedor de
identidad. También se revisará Nginx para preservar de forma segura el esquema
HTTPS informado por Cloudflare y se validarán login, logout, cookies de sesión,
rutas protegidas y navegación directa.

Cloudflare Access no reemplaza los roles internos de DS Hub. Aunque Access
autorice a una persona a llegar a la aplicación, DS Hub seguirá aplicando sus
roles `reader`, `operator` y `admin`.

## Criterios de aceptación

- `https://dshub.itti.digital` presenta un certificado válido.
- Un usuario no autorizado no llega a la pantalla de DS Hub.
- Un usuario autorizado con MFA puede iniciar sesión y usar la aplicación.
- Las cookies de sesión se marcan como seguras.
- La IP privada y el puerto 8080 no son accesibles directamente desde Internet.
- `/api/health` funciona a través del hostname sin quedar exceptuado de Access.
- Login, logout, navegación y llamadas `/api/*` funcionan sin errores de origen
  o redirecciones HTTP.
- Los eventos de acceso quedan disponibles para auditoría en Cloudflare y los
  eventos funcionales continúan registrándose en DS Hub.
- Existe un responsable y un procedimiento para reiniciar o recuperar
  `cloudflared`.

## Referencias

- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- [Aplicaciones web self-hosted](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/)
- [Políticas de Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
- [Requisitos de firewall para Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/)
- [Aplicaciones privadas por IP o hostname](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/self-hosted-private-app/)
