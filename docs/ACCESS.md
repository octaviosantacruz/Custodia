---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Acceso: Switchboard, OIDC y pruebas

**Recomendación pendiente de aceptación técnica:** usar Switchboard como
entrada para la instalación del dueño; ofrecer OIDC genérico para una
instalación independiente. No portar el acoplamiento a Okta, grupos laborales
ni el modo híbrido de la versión anterior. Ninguno de los modos siguientes
está implementado en el producto Go.

## Tres contextos explícitos

| Contexto | Autenticación propuesta | Qué conserva Custodia |
|---|---|---|
| Demo pública | Sin login, sólo datos sintéticos y estado local del ejemplo. | Ningún acceso a cuentas, inventario o backend privado. |
| Instalación detrás de Switchboard | Modo `switchboard`, identidad verificable por petición. | Usuarios locales de autorización, permisos, alcances por conexión y auditoría. |
| Instalación independiente | Modo `oidc`, Custodia como cliente de un proveedor compatible. | Sus propias sesiones revocables, permisos y auditoría. |

El modo se selecciona al configurar la instalación; no se mezclan mecanismos
ni se activa login local cuando falla el gateway o el proveedor. Elegir
Switchboard no requiere que Custodia implemente OIDC para ese recorrido.

## Switchboard: situación comprobada y contrato por construir

En el checkout revisado de Switchboard, las rutas protegidas del proceso
integrado autentican y autorizan antes del túnel. La identidad viaja por
`X-Switchboard-Visitor-User` y `X-Switchboard-Visitor-Email` dentro del túnel
mTLS; el conector valida esos campos y entrega a la app
`X-Auth-Request-User` y `X-Auth-Request-Email`.

Esto autentica el tramo edge–conector; los headers recibidos por Custodia
**no son una aserción firmada verificable por la aplicación**. No basta
confiar en ellos porque provengan de loopback o una IP privada: hay que
autenticar y restringir también el salto conector–app y cerrar acceso directo.
El certificado del conector tampoco identifica al usuario.

Para el primer recorrido recomiendo la aserción firmada propuesta por
Switchboard en `docs/architecture/identity-integration.md`, opción C:

1. Switchboard autentica al visitante, aplica su política y emite una aserción
   breve y específica para Custodia en cada petición. Elimina todas las
   variantes de headers de identidad enviados por el cliente.
2. Custodia valida firma, algoritmo permitido, clave configurada, emisor,
   audiencia, sujeto, vigencia y unicidad de `jti`. Nunca obtiene claves de
   una URL indicada por el propio token. Configurar claves y rotación fuera
   del flujo de la petición; definir tolerancia de reloj acotada.
3. Vincula el par emisor/sujeto a un usuario de autorización habilitado.
   Correo y nombre sólo sirven para presentación. Un usuario nuevo no recibe
   privilegios por entrar al gateway; un administrador concede su alcance.
4. Evalúa permiso y conexión en cada operación. No crea una sesión de app
   que permita seguir operando al margen de las decisiones del gateway.
5. La instalación cierra bypass directo IPv4/IPv6; el backend rechaza también
   peticiones sin aserción válida. Ningún token, cookie o secreto va al log.

Antes de programar hay que fijar emisión por petición, TTL, almacenamiento
compartido y acotado de replay, rotación/revocación, reintentos y auditoría
con un ID de correlación seguro. Empezar con HTTP normal; conexiones largas
requieren su propio contrato de revalidación. No convertir una propuesta JWT
en una promesa de SSO ya disponible.

La alternativa de headers sobre un salto autenticado hasta la app puede
evaluarse si hay una topología concreta; no habilitar un modo genérico de
«confiar en cualquier proxy». El trabajo está en `PROD-SB-001`.

Referencias del checkout vecino: `internal/pipeline/visitor.go`,
`internal/proxy/connector_test.go` y
`docs/architecture/tunnel-persistent.md`. La decisión `ARCH-009` sigue
pendiente. Su tracker llama `ID-004` al futuro proveedor OIDC completo;
el documento del túnel lo cita también para aserciones. Hay que resolver esa
atribución en Switchboard antes de asignar implementación: no son la misma
capacidad. Esta revisión no modifica ese repositorio.

Si Switchboard implementa y acepta su proveedor OIDC completo en el futuro,
Custodia podría usar el modo `oidc` con ese emisor. Eso permitiría retirar
el adaptador de aserciones tras probar paridad; no justifica construir un
proveedor de identidad para destrabar la demo inicial.

## Qué sería «OIDC propio» en Custodia

Custodia sería **cliente OIDC**, también llamado relying party. El proveedor
gestiona contraseña/passkey/MFA y entrega la identidad; Custodia no crea un
servidor de identidad. La configuración usa emisor, client ID, referencia al
secreto y callback registrados; ningún nombre de fabricante forma parte del
dominio del producto.

Flujo objetivo: navegador → proveedor → callback de Custodia. Authorization
Code con PKCE S256; `state` y `nonce` de un solo uso y con vencimiento.
El backend canjea el código, valida firma mediante claves del emisor
configurado, `iss`, `aud`, `exp`, `nonce` y `azp` cuando corresponde. No
autentica con un access token sin validar su propósito ni acepta un issuer
elegido libremente por el navegador.

La identidad persistida es emisor + `sub`, nunca sólo email. Después de
autenticar, Custodia crea una sesión opaca revocable en servidor: cookie
Secure/HttpOnly/SameSite compatible con el callback, rotación, expiración y
CSRF en mutaciones. Tokens y secretos permanecen en backend. Validar destinos
de retorno y distinguir logout local de cierre de sesión del proveedor.
No enlazar automáticamente cuentas de OIDC y Switchboard por email.

Validar con un proveedor simulado: código repetido, state/nonce ausentes,
firma/emisor/audiencia incorrectos, expiración, rotación de claves, usuario
deshabilitado, revocación local y permisos insuficientes. Un proveedor real
se acepta después con su configuración de laboratorio. Alcance:
`PROD-OIDC-001`, posterior al camino inicial con Switchboard.

Referencias: [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html)
y [OAuth Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html).
Seleccionar una librería Go mantenida al implementar; no escribir verificación
criptográfica ni un protocolo OAuth a mano.

## Login local de QA

La versión anterior tiene un endpoint local condicionado por su modo de
autenticación. No se probó la configuración que está corriendo. Ocultar el
botón no establece que el endpoint esté deshabilitado.

En el producto nuevo, las pruebas automatizadas pueden inyectar un proveedor
de identidad falso desde el harness. Para QA manual, si hace falta un login
local, usar un modo `local-dev` explícito, datos ficticios y escucha loopback;
rechazar su arranque fuera del entorno de desarrollo. En los modos reales no
se registra ese endpoint y no se distribuyen credenciales predeterminadas.
Probar peticiones directas al endpoint y el rechazo de configuración inválida,
además de la UI. Este diseño no añade una cuenta de emergencia productiva.
