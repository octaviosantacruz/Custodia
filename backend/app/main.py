"""Punto de entrada HTTP de Custodia: compone FastAPI, middleware y routers.

Creado por Octavio Santacruz. Guía de mantenimiento: MAINTAINING.md.
Las rutas de cada herramienta se incorporan mediante sources.py; la lógica
de inventario pertenece a sus servicios, repositorios e integraciones.
"""

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.sessions import SessionMiddleware
import os
from urllib.parse import urlsplit

from app.logging_config import configure_logging

configure_logging()

from app.cross.api.routes.activity import router as activity_router
from app.cross.api.routes.security_events import router as security_events_router
from app.cross.api.routes.auth import router as auth_router
from app.cross.api.routes.chains_person import router as chains_person_router
from app.cross.api.routes.cmdb import router as cmdb_router
from app.cross.api.routes.connection_inventory import router as connection_inventory_router
from app.cross.api.routes.operational_errors import router as operational_errors_router
from app.cross.api.routes.events import router as events_router
from app.cross.api.routes.health import router as health_router
from app.cross.api.routes.ingestion import router as ingestion_router
from app.cross.api.routes.search import router as search_router
from app.cross.api.routes.users import router as users_router
from app.cross.api.routes.workspace_preferences import router as workspace_preferences_router
from app.cross.api.routes.access_control import router as access_control_router
from app.auth import AUTH_MODE, OIDC_ENABLED
from app.config import AppSettings, allowed_web_origins, api_docs_urls
from app.docs_theme import build_api_reference_html
from app.sources import TOOLS
from app.lifecycle import build_lifespan
from app.http_security import ApiSecurityMiddleware
from app.operational_errors import internal_server_error


SETTINGS = AppSettings.from_environment()
_API_DOCS_URLS = api_docs_urls(SETTINGS.expose_api_docs)

# Sidebar hierarchy for the Scalar reference: OpenAPI 3.2 `tag.parent`
# (Scalar >=1.66 nests it into a tree; other consumers fall back to
# x-tagGroups or the flat tag list). Sections carry no operations and only
# exist to order the sidebar: Uso general -> Plataforma / Operación,
# CyberArk -> PAM -> Safes/Catálogos + the other tools, Netskope.
_OPENAPI_TAG_PARENTS = {
    "General": None,
    "Plataforma": "General",
    "Operación": "General",
    "CyberArk": None,
    "Netskope": None,
    "Salud y estado": "Plataforma",
    "Autenticación": "Plataforma",
    "Usuarios y permisos": "Plataforma",
    "Acceso y permisos": "Plataforma",
    "Actividad": "Plataforma",
    "Eventos": "Plataforma",
    "Preferencias de workspace": "Plataforma",
    "Búsqueda": "Plataforma",
    "Ingesta": "Operación",
    "Analítica": "Operación",
    "Cobertura CMDB": "Operación",
    "Hallazgos": "Operación",
    "Inventario de conexiones": "Operación",
    "PAM": "CyberArk",
    "Safes": "PAM",
    "Catálogos": "PAM",
    "Cadenas PAM": "PAM",
    "Identity Administration": "CyberArk",
    "Cadenas Persona": "CyberArk",
    "SIA": "CyberArk",
    "Access space": "CyberArk",
    "CyberArk Risk Management": "CyberArk",
    "CyberArk Connector Manager": "CyberArk",
    "Inventario Netskope": "Netskope",
    "Postura Netskope": "Netskope",
    "Cadenas Netskope": "Netskope",
    "Alertas DLP Netskope": "Netskope",
    "UCI Netskope": "Netskope",
    "Administradores Netskope": "Netskope",
}

_OPENAPI_TAG_DISPLAY_NAMES = {
    "General": "Uso general",
    "Operación": "Operación y analítica",
}

# Flat fallback for consumers without nested-tag support (e.g. Redoc's
# x-tagGroups). Sections are intentionally omitted so no empty group shows up.
_OPENAPI_TAG_GROUPS = [
    {
        "name": "Uso general",
        "tags": [
            "Salud y estado", "Autenticación", "Usuarios y permisos",
            "Acceso y permisos", "Actividad", "Eventos",
            "Preferencias de workspace", "Búsqueda", "Ingesta", "Analítica",
            "Cobertura CMDB", "Hallazgos", "Inventario de conexiones",
        ],
    },
    {
        "name": "CyberArk",
        "tags": ["PAM", "Safes", "Catálogos", "Cadenas PAM", "Identity Administration", "Cadenas Persona", "SIA", "Access space", "CyberArk Risk Management", "CyberArk Connector Manager"],
    },
    {"name": "Netskope", "tags": ["Inventario Netskope", "Postura Netskope", "Cadenas Netskope", "Alertas DLP Netskope", "UCI Netskope", "Administradores Netskope"]},
]

# Curated request snippets for the operations a consumer hits first. Scalar
# renders these as ready-to-copy examples; Swagger-compatible clients ignore
# the x-codeSamples extension. Placeholders use $CUSTODIA_URL/$CUSTODIA_TOKEN so no
# credential or tenant value is ever baked into the published contract.
_OPENAPI_CODE_SAMPLES = {
    ("/api/auth/login", "post"): [{
        "lang": "Shell",
        "label": "curl (login local)",
        "source": (
            "curl -sS -X POST \"$CUSTODIA_URL/api/auth/login\" \\\n"
            "  -H 'Content-Type: application/json' \\\n"
            "  -c cookies.txt \\\n"
            "  -d '{\"email\":\"usuario@empresa.com\",\"password\":\"<tu-contraseña>\"}'"
        ),
    }],
    ("/api/auth/api-tokens", "post"): [{
        "lang": "Shell",
        "label": "curl (token personal de lectura)",
        "source": (
            "curl -sS -X POST \"$CUSTODIA_URL/api/auth/api-tokens\" \\\n"
            "  -H 'Content-Type: application/json' \\\n"
            "  -b cookies.txt \\\n"
            "  -d '{\"label\":\"reportes\",\"expires_in_minutes\":60}'"
        ),
    }],
    ("/api/safes", "get"): [{
        "lang": "Shell",
        "label": "curl (token Bearer personal)",
        "source": (
            "curl -sS \"$CUSTODIA_URL/api/safes?limit=50\" \\\n"
            "  -H \"Authorization: Bearer $CUSTODIA_TOKEN\""
        ),
    }],
    ("/api/accounts/{safe_number}/{account_id}/classification", "patch"): [{
        "lang": "Shell",
        "label": "curl (automatización de escritura)",
        "source": (
            "curl -sS -X PATCH \"$CUSTODIA_URL/api/accounts/42/7_12/classification\" \\\n"
            "  -H \"X-Access-Token: $CUSTODIA_WRITE_TOKEN\" \\\n"
            "  -H 'Content-Type: application/json' \\\n"
            "  -d '{\"inventory_account_type\":\"no_nominal\"}'"
        ),
    }],
}

_ERROR_RESPONSE_SCHEMA = {
    "type": "object",
    "description": "Error de la API con un mensaje legible para el operador.",
    "properties": {"detail": {"type": "string"}},
    "required": ["detail"],
}

# Representative payloads for the schemas a consumer fills in first. Scalar
# and Swagger UI render these in the model preview; no tenant data or real
# credential is ever used.
_OPENAPI_SCHEMA_EXAMPLES = {
    "LocalLogin": {"email": "usuario@empresa.com", "password": "<tu-contraseña>"},
    "ApiTokenCreate": {"label": "reportes", "expires_in_minutes": 60},
    "AccountInventoryClassificationUpdate": {"inventory_account_type": "no_nominal"},
    "SafeAssignmentUpdate": {"business_unit_id": 3, "responsible_id": 7},
}

# Composition root: keep the public API identity and router topology in one
# place while leaving route modules responsible for their own contracts.
SHARED_API_ROUTERS = (
    (0, health_router),
    (2, events_router),
    (3, auth_router),
    (4, activity_router),
    (5, security_events_router),
    (10, chains_person_router),
    (11, cmdb_router),
    (12, connection_inventory_router),
    (17, operational_errors_router),
    (18, workspace_preferences_router),
    (19, search_router),
    (20, ingestion_router),
    (21, users_router),
    (22, access_control_router),
)
API_ROUTERS = tuple(router for _, router in sorted(
    (*SHARED_API_ROUTERS, *(entry for tool in TOOLS for entry in tool.routers)),
    key=lambda entry: entry[0],
))

app = FastAPI(
    title="Custodia API",
    version="0.1.0",
    description=(
        "API del CMDB operativo de Custodia para CyberArk (Privilege Cloud/PAM, "
        "Identity Administration, SIA y Access space) y Netskope (SSE): ingesta, "
        "inventario de Safes y cuentas, clasificación, catálogos, analítica, "
        "auditoría y cobertura normalizada.\n\n"
        "La API usa sesión firmada para el frontend. Las automatizaciones sólo "
        "pueden usar X-Access-Token en operaciones de escritura autorizadas. "
        "Las lecturas también aceptan tokens Bearer personales, breves y revocables, "
        "emitidos desde una sesión legítima. No se exponen secretos "
        "ni credenciales de cuentas."
    ),
    openapi_tags=[
        {"name": "General", "description": "Plataforma Custodia: autenticación, administración, actividad y operación transversal."},
        {"name": "Plataforma", "description": "Autenticación, usuarios, permisos, actividad y preferencias de Custodia."},
        {"name": "Salud y estado", "description": "Liveness, readiness y estado de configuración de las integraciones."},
        {"name": "Autenticación", "description": "Login local, sesión, bootstrap inicial y tokens personales de API."},
        {"name": "Usuarios y permisos", "description": "Usuarios locales de Custodia y sus roles de administración."},
        {"name": "Acceso y permisos", "description": "Catálogo de permisos, roles y dominios internos de Custodia."},
        {"name": "Actividad", "description": "Bitácora administrativa, eventos de seguridad y errores operativos."},
        {"name": "Eventos", "description": "Señales livianas de refresco entre sesiones; no incluye datos de inventario."},
        {"name": "Preferencias de workspace", "description": "Accesos rápidos y workspaces recientes por usuario."},
        {"name": "Búsqueda", "description": "Búsqueda global de inventario no secreto."},
        {"name": "Operación", "description": "Ingesta, analítica, cobertura, hallazgos e inventario de conexiones (todas las fuentes)."},
        {"name": "Ingesta", "description": "Previsualización, ejecución y seguimiento de sincronizaciones por fuente."},
        {"name": "Analítica", "description": "Resumen, composición del inventario y paneles personales."},
        {"name": "Cobertura CMDB", "description": "Cobertura consolidada de objetos y relaciones normalizadas."},
        {"name": "Hallazgos", "description": "Reglas versionadas, evidencia y estado de postura."},
        {"name": "Inventario de conexiones", "description": "Inventario importado por IP y coincidencias exactas con PAM/SIA."},
        {"name": "CyberArk", "description": "Herramientas CyberArk: PAM, Identity Administration, SIA y Access space."},
        {"name": "PAM", "description": "Cadena PAM normalizada: usuarios, roles, plataformas, conectores y PSM."},
        {"name": "Safes", "description": "Inventario, detalle, clasificación y ciclo de vida de Safes CyberArk."},
        {"name": "Catálogos", "description": "Unidades de negocio, responsables y tipos de cuenta."},
        {"name": "Cadenas PAM", "description": "Explorador de accesos por eslabones: búsqueda de nodos y expansión en ambas direcciones."},
        {"name": "Identity Administration", "description": "Usuarios, roles y federaciones de CyberArk Identity."},
        {"name": "Cadenas Persona", "description": "Vista por persona: búsqueda por correo normalizado y resumen por herramienta, sólo con las fuentes que el actor puede leer."},
        {"name": "SIA", "description": "Políticas, destinos, conectores y recursos de SIA."},
        {"name": "Access space", "description": "Assets accesibles vía Access space de CyberArk."},
        {"name": "CyberArk Risk Management", "description": "Postura de riesgo calculada por CyberArk, consultada en vivo y en modo sólo lectura."},
        {"name": "CyberArk Connector Manager", "description": "Pools y redes consultados en vivo, sólo con nombres, fechas y conteos; sin valores de red ni mutaciones."},
        {"name": "Netskope", "description": "Inventario y postura de Netskope (SSE)."},
        {"name": "Inventario Netskope", "description": "Usuarios, dispositivos y agregados de alertas de Netskope."},
        {"name": "Postura Netskope", "description": "Líneas base de postura Netskope configuradas por un administrador."},
        {"name": "Cadenas Netskope", "description": "Explorador de usuarios y dispositivos por match exacto observado y agrupación por atributo."},
        {"name": "UCI Netskope", "description": "Último índice de confianza (UCI) por usuario; requiere netskope:uba_read."},
        {"name": "Administradores Netskope", "description": "Administradores del tenant, sus roles y permisos; requiere netskope:admin_inventory_read."},
        {"name": "Alertas DLP Netskope", "description": "Alertas DLP mínimas por usuario (conteos y drill-down), sin archivo, contenido ni datos del evento. Requiere netskope:dlp_read."},
    ],
    docs_url=None,  # replaced below with the Scalar reference when docs are exposed
    redoc_url=None,  # retired: the Scalar reference is the single published UI
    openapi_url=_API_DOCS_URLS["openapi_url"],
    lifespan=build_lifespan(SETTINGS, OIDC_ENABLED),
)
app.add_exception_handler(Exception, internal_server_error)
app.state.settings = SETTINGS
app.state.session_idle_timeout_seconds = SETTINGS.session_idle_timeout_seconds
app.state.session_max_age_seconds = SETTINGS.session_max_age_seconds

if AUTH_MODE in {"local", "oidc", "hybrid"}:
    app.add_middleware(
        SessionMiddleware,
        secret_key=SETTINGS.session_secret,
        max_age=SETTINGS.session_max_age_seconds,
        https_only=SETTINGS.session_https_only,
        same_site="lax",
    )

ALLOWED_WEB_ORIGINS = allowed_web_origins(SETTINGS.web_origin, os.environ.get("WEB_ORIGINS"))
TRUSTED_HOSTS = {"localhost", "127.0.0.1", "testserver"}
if SETTINGS.web_origin:
    parsed_origin = urlsplit(SETTINGS.web_origin)
    if parsed_origin.scheme not in {"http", "https"} or not parsed_origin.hostname:
        raise RuntimeError("WEB_ORIGIN debe ser un origen HTTP o HTTPS válido")
    TRUSTED_HOSTS.add(parsed_origin.hostname)

app.add_middleware(TrustedHostMiddleware, allowed_hosts=sorted(TRUSTED_HOSTS))

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_WEB_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "X-Access-Token"],
)
app.add_middleware(ApiSecurityMiddleware, allowed_origins=ALLOWED_WEB_ORIGINS, max_body_bytes=SETTINGS.api_max_body_bytes)

for router in API_ROUTERS:
    app.include_router(router)

_DOCS_URL = _API_DOCS_URLS["docs_url"]
_OPENAPI_URL = _API_DOCS_URLS["openapi_url"]
if _DOCS_URL and _OPENAPI_URL:
    @app.get(_DOCS_URL, include_in_schema=False)
    async def api_reference_html():
        assert _OPENAPI_URL is not None  # guarded by the branch above
        return build_api_reference_html(
            openapi_url=_OPENAPI_URL,
            title=f"{app.title} — Referencia",
        )


PUBLIC_OPENAPI_OPERATIONS = {
    ("/health", "get"),
    ("/api/health", "get"),
    ("/health/live", "get"),
    ("/api/health/live", "get"),
    ("/health/ready", "get"),
    ("/api/health/ready", "get"),
    ("/api/auth/status", "get"),
    ("/api/auth/setup-status", "get"),
    ("/api/auth/login", "get"),
    ("/api/auth/login", "post"),
    ("/api/auth/oidc/login", "get"),
    ("/api/auth/callback", "get"),
    ("/api/auth/register", "post"),
}


OPENAPI_OPERATION_OVERRIDES = {
    ("/health", "get"): ("Health del servicio", "Comprueba que la API puede consultar la base de datos.") ,
    ("/api/health", "get"): ("Health del servicio", "Comprueba que la API puede consultar la base de datos.") ,
    ("/health/live", "get"): ("Liveness del servicio", "Comprueba que el proceso está activo sin depender de PostgreSQL.") ,
    ("/api/health/live", "get"): ("Liveness del servicio", "Comprueba que el proceso está activo sin depender de PostgreSQL.") ,
    ("/health/ready", "get"): ("Readiness del servicio", "Comprueba que la API puede consultar la base de datos.") ,
    ("/api/health/ready", "get"): ("Readiness del servicio", "Comprueba que la API puede consultar la base de datos.") ,
    ("/api/integrations/status", "get"): ("Estado de integraciones", "Muestra sólo el estado de configuración de las integraciones; requiere una sesión con acceso de lectura."),
    ("/api/auth/me", "get"): ("Consultar mi identidad", "Devuelve el actor y los permisos efectivos de la sesión o del token Bearer personal."),
    ("/api/auth/setup-status", "get"): ("Consultar estado de configuración inicial", "Indica si todavía se puede crear el primer usuario local."),
    ("/api/auth/login", "get"): ("Obtener método de login", "Indica si el acceso local está habilitado o inicia el flujo OIDC configurado."),
    ("/api/auth/login", "post"): ("Iniciar sesión local", "Valida las credenciales y crea una sesión firmada. El endpoint aplica rate limiting por IP y email."),
    ("/api/auth/oidc/login", "get"): ("Iniciar login corporativo", "Comienza el flujo OIDC cuando está habilitado y configurado."),
    ("/api/auth/password", "post"): ("Cambiar mi contraseña", "Cambia la contraseña del actor autenticado y aplica la política local vigente."),
    ("/api/auth/callback", "get"): ("Completar callback OIDC", "Completa el callback del proveedor OIDC y crea la sesión de Custodia."),
    ("/api/auth/logout", "post"): ("Cerrar sesión", "Invalida la sesión actual."),
    ("/api/auth/status", "get"): ("Consultar estado de sesión", "Devuelve autenticación, usuario, permisos y disponibilidad del bootstrap."),
    ("/api/auth/register", "post"): ("Crear primer usuario", "Crea el primer administrador local sin token, sólo cuando no existe ningún usuario y ALLOW_SELF_REGISTER_SETUP=true. Deshabilitado por defecto; ver AUTH_BOOTSTRAP_TOKEN para el camino recomendado."),
    ("/api/auth/bootstrap", "post"): ("Crear administrador por bootstrap", "Crea el primer administrador usando el token temporal de bootstrap configurado."),
    ("/api/catalogs", "get"): ("Listar catálogos", "Devuelve unidades de negocio, responsables y tipos de cuenta disponibles."),
    ("/api/business-units/{business_unit_id}", "patch"): ("Actualizar unidad de negocio", "Activa, desactiva o modifica una unidad de negocio; requiere catalogs:write."),
    ("/api/responsibles/{responsible_id}", "patch"): ("Actualizar responsable", "Activa, desactiva o modifica un responsable; requiere catalogs:write."),
    ("/api/auth/users", "get"): ("Listar usuarios de Custodia", "Devuelve usuarios locales y sus roles; requiere access:manage."),
    ("/api/auth/users", "post"): ("Crear usuario de Custodia", "Crea un usuario local y asigna su rol inicial; requiere access:manage."),
    ("/api/auth/users/{user_id}", "patch"): ("Actualizar usuario de Custodia", "Modifica el estado, nombre o roles de un usuario; requiere access:manage."),
    ("/api/auth/users/{user_id}", "delete"): ("Eliminar usuario de Custodia", "Elimina un usuario y sus asignaciones; requiere access:manage."),
    ("/api/auth/users/{user_id}/reissue-temp-password", "post"): ("Regenerar contraseña temporal", "Genera una contraseña temporal de un usuario; requiere access:manage."),
    ("/api/access/permissions", "get"): ("Listar permisos", "Devuelve el catálogo de permisos internos de Custodia."),
    ("/api/access/roles", "get"): ("Listar roles internos", "Devuelve roles, permisos, estado y cantidad de usuarios."),
    ("/api/access/domains", "get"): ("Listar dominios y niveles", "Devuelve los dominios funcionales y niveles de acceso disponibles."),
    ("/api/safes/{safe_number}", "get"): ("Consultar detalle de Safe", "Devuelve el detalle, miembros, cuentas y auditoría asociada a una Safe."),
    ("/api/safes/{safe_number}/audit", "get"): ("Consultar auditoría de Safe", "Devuelve cambios administrativos registrados para una Safe."),
    ("/api/lifecycle/retired", "get"): ("Listar Safes retiradas", "Devuelve candidatos retirados detectados por una corrida completa."),
}


def _error_response(description: str) -> dict:
    return {
        "description": description,
        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}},
    }


def custom_openapi():
    """Publish the real authentication contract in the reference without
    changing runtime authorization, which remains enforced by route
    dependencies."""
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes, tags=app.openapi_tags)
    schema.setdefault("components", {}).setdefault("securitySchemes", {}).update({
        "sessionCookie": {
            "type": "apiKey",
            "in": "cookie",
            "name": "session",
            "description": "Cookie de sesión firmada. Se obtiene mediante el login del frontend.",
        },
        "accessToken": {
            "type": "apiKey",
            "in": "header",
            "name": "X-Access-Token",
            "description": "Token técnico para automatizaciones autorizadas. Sólo aplica a operaciones de escritura que lo acepten; nunca lo compartas ni lo uses en lectura.",
        },
        "bootstrapToken": {
            "type": "apiKey",
            "in": "header",
            "name": "X-Bootstrap-Token",
            "description": "Token temporal para crear el primer administrador cuando el bootstrap está habilitado.",
        },
        "apiBearer": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "Custodia personal read token",
            "description": "Token personal opaco, de sólo lectura y corta duración. Se emite desde POST /api/auth/api-tokens con una sesión válida.",
        },
    })
    components = schema.setdefault("components", {})
    components.setdefault("schemas", {}).setdefault("ErrorResponse", _ERROR_RESPONSE_SCHEMA)
    for model_name, example in _OPENAPI_SCHEMA_EXAMPLES.items():
        component = components["schemas"].get(model_name)
        if component is not None:
            component["example"] = example
    # Scalar and Redoc render x-tagGroups as the sidebar hierarchy; other
    # OpenAPI consumers ignore the extension and fall back to the flat tags.
    schema["x-tagGroups"] = _OPENAPI_TAG_GROUPS
    for tag in schema.get("tags", []):
        name = tag.get("name", "")
        if name in _OPENAPI_TAG_PARENTS and _OPENAPI_TAG_PARENTS[name]:
            tag["parent"] = _OPENAPI_TAG_PARENTS[name]
        if name in _OPENAPI_TAG_DISPLAY_NAMES:
            tag["x-displayName"] = _OPENAPI_TAG_DISPLAY_NAMES[name]
    for path, path_item in schema.get("paths", {}).items():
        for method, operation in path_item.items():
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            if (path, method) in OPENAPI_OPERATION_OVERRIDES:
                summary, description = OPENAPI_OPERATION_OVERRIDES[(path, method)]
                operation["summary"] = summary
                operation["description"] = description
            if (path, method) in _OPENAPI_CODE_SAMPLES:
                operation["x-codeSamples"] = _OPENAPI_CODE_SAMPLES[(path, method)]
            if (path, method) in PUBLIC_OPENAPI_OPERATIONS:
                operation["security"] = []
                continue
            if path == "/api/auth/bootstrap" and method == "post":
                operation["security"] = [{"bootstrapToken": []}]
            elif path == "/api/auth/api-tokens" or path.startswith("/api/auth/api-tokens/"):
                operation["security"] = [{"sessionCookie": []}]
            # GET endpoints use the signed browser session or a personal,
            # read-only Bearer token. Writes may use either a session or the
            # pre-existing X-Access-Token where their dependency allows it;
            # route-level permissions remain the source of truth.
            elif path == "/api/auth/me" and method == "get":
                operation["security"] = [{"sessionCookie": []}, {"apiBearer": []}]
            elif method == "get":
                operation["security"] = [{"sessionCookie": []}, {"apiBearer": []}]
            elif path in {"/api/auth/password", "/api/auth/me", "/api/auth/logout"}:
                operation["security"] = [{"sessionCookie": []}]
            else:
                operation["security"] = [{"sessionCookie": []}, {"accessToken": []}]
            # Every non-public operation can reject an absent/expired
            # credential (401) or an authenticated actor without the route's
            # permission (403); documenting them per operation is what turns
            # the reference into an authorization map.
            responses = operation.setdefault("responses", {})
            responses.setdefault("401", _error_response("Credencial ausente, inválida o expirada."))
            responses.setdefault("403", _error_response("El actor autenticado no tiene el permiso requerido."))
    app.openapi_schema = schema
    return app.openapi_schema


app.openapi = custom_openapi
