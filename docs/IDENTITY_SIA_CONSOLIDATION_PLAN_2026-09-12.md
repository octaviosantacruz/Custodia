# Plan de consolidación de Identidades y SIA

**Fecha:** 2026-09-12  
**Estado:** Fase 1 (Identidades) implementada y commiteada (`c0ec96a`); Fase 2 (Hub SIA) implementada y commiteada (`5567c68`). Fase 3 (Safes/infraestructura PAM) implementada y commiteada -- navegación interna aditiva (Safes / Plataformas y cuentas / Infraestructura PAM) sin retirar `platforms`/`connectors`/`pamHealth`/`aimApplications` del switcher, a la espera de validación con usuarios antes de considerar retirarlos.
**Responsable técnico:** Codex (senior)  
**Colaboración:** agente OpenCode/Claude con revisión cruzada

## 1. Objetivo

Reducir la cantidad de workspaces operativos sin perder profundidad ni romper
URLs existentes. La navegación principal propuesta queda en seis destinos:

1. Métricas
2. Postura
3. Safes
4. Identidades
5. Cadenas
6. SIA

`Acceso` y `Actividad` continúan bajo el dominio administrativo y no compiten
con la navegación operativa PAM.

## 2. Decisiones de producto confirmadas

### 2.1 Federación esperada por dominio de correo

La organización confirma la siguiente regla de negocio:

| Dominio exacto | Federación esperada | Código estable propuesto |
|---|---|---|
| `ueno.com.py` | Okta Ueno | `okta_ueno` |
| `itti.digital` | Okta ITTI | `okta_itti` |
| `upay.com.py` | Okta UPAY | `okta_upay` |

La regla se aplica así:

1. Recortar espacios y convertir el email a minúsculas.
2. Extraer el texto posterior al último `@`.
3. Comparar el dominio por igualdad exacta.
4. Resolver la federación activa sincronizada por un catálogo central de
   alias normalizados, nunca mediante una búsqueda parcial.
5. Si el dominio está soportado pero la federación no está sincronizada,
   devolver estado `missing_federation`, no fabricar un ID.
6. Para cualquier otro dominio, devolver `unsupported_domain`.

No se debe usar `endsWith("itti.digital")`: un dominio como
`falso-itti.digital` no pertenece a ITTI.

### 2.2 Remote Access

`Remote Access` no participa actualmente del acceso de usuarios y queda fuera
del matching y de la navegación principal. No se elimina de la ingesta ni se
retira del CMDB. Puede permanecer visible únicamente en una vista avanzada de
"otras federaciones sincronizadas" si se necesita diagnóstico administrativo.

### 2.3 Naturaleza de la relación

La relación usuario-federación es una clasificación derivada por una regla de
negocio aprobada. No es una relación entregada por la API de Identity
Administration. La API de DS Hub debe indicarlo con `match_basis =
"email_domain_rule"` para evitar presentarlo como evidencia nativa de
CyberArk.

No se agrega una migración ni una fila a
`cyberark_inventory_relationships`: el resultado se calcula en lectura y se
actualiza automáticamente si cambia el email o el catálogo de federaciones.

## 3. Arquitectura de información objetivo

### 3.1 Identidades

Un solo botón principal `Identidades`, con cuatro pestañas internas:

- Usuarios
- Grupos Okta
- Roles
- Federaciones

Las rutas profundas actuales se conservan:

- `/pam/identity/users`
- `/pam/identity/groups`
- `/pam/identity/roles`
- `/pam/identity/federations`

El selector principal y el command center muestran un único destino. Las
pestañas cambian la URL para preservar enlaces directos, historial del
navegador y recarga de página.

#### Fila de usuario

Agregar una columna compacta `Federación`:

- `Okta Ueno`, `Okta ITTI` u `Okta UPAY` cuando existe match activo.
- `Esperada, no sincronizada` cuando la regla reconoce el dominio pero falta el
  objeto de federación.
- `Sin regla` para dominios no incluidos.
- `Sin email` si no existe un correo utilizable.

#### Drawer de identidad

Orden propuesto:

1. Identidad y estado.
2. Federación de ingreso, con badge `Derivada por dominio`.
3. Roles y grupos de Identity.
4. Coincidencia PAM por UUID exacto, cuando exista.
5. Referencias en políticas SIA, diferenciando match exacto de referencia por
   nombre.
6. Acción `Ver cadena de acceso`.

No se debe afirmar que una federación contiene al usuario. El texto correcto
es `Federación esperada por dominio de correo`.

### 3.2 SIA

Un solo botón principal `SIA`, con tres pestañas internas:

- Políticas
- Recursos
- Cobertura

#### Políticas

Conserva el workspace actual de políticas, sus destinatarios y los enlaces
contextuales hacia Identidades y Safes.

#### Recursos

Agrupa mediante pestañas secundarias o filtros de tipo:

- Máquinas virtuales SIA (`sia_resource`).
- Cuentas fuertes de base de datos (`sia_database_account`).
- Assets de Access Space (`access_asset`).
- Conectores SIA, como infraestructura relacionada.

`Cuentas fuertes de BD SIA` y `Assets de Access` dejan de aparecer como
botones principales. Sus rutas actuales siguen funcionando y abren SIA en la
sección correspondiente.

Access Space debe conservar su etiqueta de fuente. Sólo se muestra una
plataforma PAM asociada cuando `access_asset.attributes.platform_id` coincide
exactamente con el `source_id` de una plataforma PAM, relación que ya está
implementada. No se crea un vínculo Access-SIA por similitud de nombre.

#### Cobertura

Absorbe el workspace actual `Activos y conexiones` y presenta por conexión:

- cobertura PAM;
- cobertura SIA;
- Safe o plataforma relacionada cuando la evidencia actual lo permita;
- asset de Access relacionado únicamente mediante una clave confirmada;
- motivo de ausencia o ambigüedad.

En una primera fase esta sección reutiliza la vista existente. La unificación
de filas de fuentes distintas se posterga hasta definir una clave compartida
real y una estrategia de paginación consistente.

### 3.3 Safes

`Safes` permanece como botón principal. Los workspaces técnicos se agrupan
como navegación interna o acceso avanzado:

- Safes
- Plataformas y cuentas
- Infraestructura PAM: conectores PSM, salud PAM y aplicaciones AIM

Esta parte no es necesaria para el primer incremento de Identidades/SIA y no
debe bloquearlo.

## 4. Contrato backend propuesto

Crear un módulo puro, por ejemplo
`backend/app/services/identity_federation_resolution.py`, con:

```python
class FederationResolution(TypedDict):
    status: Literal["matched", "missing_federation", "unsupported_domain", "missing_email", "ambiguous"]
    match_basis: Literal["email_domain_rule"]
    email_domain: str | None
    federation_code: str | None
    expected_name: str | None
    object_id: int | None
    source_id: str | None
    display_name: str | None
    active: bool | None
```

El módulo debe exponer funciones puras para:

- normalizar y extraer el dominio;
- resolver el código estable;
- normalizar alias de nombres de federación;
- elegir sólo una federación activa;
- reportar ambigüedad como estado explícito si dos objetos coinciden.

El repositorio de Identity obtiene las federaciones activas una vez por
request y enriquece la página de usuarios en memoria. No debe hacer una query
por usuario. El detalle de usuario usa el mismo servicio y contrato.

No incluir certificados, `Config`, `Domains`, `Apps` ni
`CyberarkServices`. La nueva regla no cambia la allowlist de ingesta existente.

## 5. Cambios frontend propuestos

1. Extender `IdentitySection` con `federations`.
2. Renderizar `IdentityFederationsWorkspace` dentro de
   `IdentityWorkspace` como cuarta pestaña.
3. Mantener `identityFederations` como `WorkspaceView` de compatibilidad, pero
   quitarlo de la lista de destinos principales y del comando independiente.
4. Hacer que `/pam/identity/federations` seleccione la pestaña interna.
5. Mostrar `federation_resolution` en filas y drawer de usuarios con copy que
   indique que es una asociación derivada.
6. Crear un wrapper `SiaHubWorkspace` o ampliar `SiaWorkspace` para resolver
   las tres pestañas por ruta.
7. Reutilizar los componentes actuales de recursos, cuentas fuertes, Access
   assets y conexiones. No copiar sus tablas.
8. Canonicalizar preferencias recientes: cualquier subvista de Identidades se
   registra como `identity`; cualquier subvista SIA se registra como `sia`.

## 6. Compatibilidad y permisos

- No borrar `WorkspaceView` existentes durante el primer incremento.
- No cambiar ni eliminar endpoints actuales.
- Mantener redirects y deep links de rutas existentes.
- El hub Identidades debe mostrar únicamente pestañas permitidas. Federaciones
  conserva `identity:catalogs_read` o `access:manage`.
- Recursos SIA conserva los permisos estrechos de cada fuente. No elevar a un
  usuario sólo porque puede abrir el contenedor visual.
- Una pestaña sin permiso no se muestra y su ruta directa redirige a la primera
  pestaña autorizada.

## 7. Estados de UI obligatorios

Cada pestaña conserva loading, error con reintento, empty y no-results. Para la
federación derivada:

- matched: badge normal con el nombre de federación;
- missing_federation: warning accionable para revisar sincronización;
- unsupported_domain: texto neutral `Sin regla de federación`;
- missing_email: texto neutral `Sin email`;
- ambiguous: warning `Más de una federación coincide`, sin elegir una.

Remote Access no aparece como opción asignada ni como badge de usuario.

## 8. Pruebas y criterios de aceptación

### Backend unitario

- Mayúsculas y espacios se normalizan.
- Cada uno de los tres dominios exactos resuelve su código correcto.
- Subdominios y dominios parecidos no hacen match.
- Email inválido o ausente produce estado explícito.
- Federación ausente e inactiva no se presentan como match.
- Dos federaciones compatibles producen ambigüedad.
- La lista ejecuta un número constante de queries, sin N+1.

### Backend HTTP

- Lista y detalle de usuarios incluyen `federation_resolution`.
- No se exponen certificados, configuración SAML ni campos excluidos.
- Los permisos existentes siguen devolviendo 401/403 correctamente.

### Frontend unitario

- Alias de rutas seleccionan la pestaña correcta.
- Subvistas se canonicalizan para preferencias recientes.
- Badges muestran cada estado con copy correcto.

### E2E

- El selector principal tiene un único botón Identidades.
- Usuarios, Grupos, Roles y Federaciones son navegables con teclado.
- Recargar `/pam/identity/federations` conserva la pestaña.
- Un usuario `@itti.digital` muestra Okta ITTI y abre su detalle.
- Remote Access no se asigna ni aparece en la navegación principal.
- El selector principal tiene un único botón SIA.
- Strong Accounts y Access Assets abren como secciones internas de SIA.
- Back/forward conserva pestaña y filtros esperados.
- Axe sin violaciones críticas en ambos temas.

### Gate final

- `npm run verify`
- `npm run verify:e2e`
- `npm run verify:supply-chain`
- Revisión manual de rutas antiguas y roles con permisos estrechos.

## 9. Fases de implementación

### Fase 1: Identidades y federación derivada

1. Servicio puro de resolución backend.
2. Enriquecimiento de lista y detalle de usuarios.
3. Pestaña Federaciones dentro de Identidades.
4. Un solo destino principal y un solo comando Identidades.
5. Pruebas unitarias, HTTP y E2E.

Esta fase entrega valor completo y puede desplegarse de forma independiente.

### Fase 2: Hub SIA

1. Wrapper de rutas y pestañas Políticas, Recursos y Cobertura.
2. Strong Accounts, SIA Resources y Access Assets como secciones internas.
3. Activos y conexiones como sección Cobertura.
4. Limpieza del selector principal y command center.
5. Pruebas de permisos, rutas, navegación y accesibilidad.

### Fase 3: Safes e infraestructura PAM

Agrupar plataformas, conectores, salud y AIM bajo Safes o un subgrupo PAM.
Debe validarse con usuarios antes de retirar esos destinos del selector.

## 10. Reparto de trabajo

### Codex, responsable senior

- fijar el contrato `FederationResolution` y las reglas de seguridad;
- implementar y probar el servicio backend de matching;
- revisar queries para impedir N+1;
- integrar permisos y compatibilidad de rutas;
- revisar el trabajo del agente y ejecutar el gate completo;
- decidir si un cambio requiere migración. El diseño actual no la requiere.

### Agente OpenCode/Claude

- implementar exclusivamente la Fase 1 frontend:
  - cuarta pestaña Federaciones dentro de `IdentityWorkspace`;
  - reutilización de `IdentityFederationsWorkspace`, sin duplicarlo;
  - simplificación del switcher y command center a un solo Identidades;
  - badges de resolución en tabla y drawer siguiendo el contrato acordado;
  - pruebas frontend unitarias y E2E;
- no modificar el mapping de ingesta ni agregar campos de CyberArk;
- no implementar todavía el Hub SIA hasta que Codex cierre y revise Fase 1;
- documentar archivos tocados, tests y decisiones en `TO_CODEX.md`;
- no hacer commit mientras Codex esté integrando cambios concurrentes.

## 11. Riesgos y controles

- **Dominio falsificado:** igualdad exacta y normalización centralizada.
- **Federación renombrada:** alias explícitos con estado missing/ambiguous; no
  coincidencia difusa.
- **Relación presentada como evidencia CyberArk:** badge y campo
  `match_basis` obligatorios.
- **N+1:** federaciones cargadas una vez por request.
- **Permisos mezclados al agrupar UI:** cada pestaña conserva su gate real.
- **URLs y favoritos rotos:** rutas existentes permanecen como deep links.
- **Remote Access perdido:** sigue ingerido, sólo queda excluido del matching y
  navegación normal.

## 12. Fuera de alcance inicial

- Inferir federación por nombre de usuario, grupo, IP o dominio parcial.
- Persistir relaciones usuario-federación.
- Exponer certificados o configuración SAML/SSO.
- Crear relaciones Access-SIA sin una clave confirmada.
- Unificar físicamente datasets paginados de fuentes diferentes.
- Eliminar endpoints, tipos o rutas existentes.
