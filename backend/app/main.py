
from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.sessions import SessionMiddleware
from urllib.parse import urlsplit

from .api.routes.activity import router as activity_router
from .api.routes.security_events import router as security_events_router
from .api.routes.auth import router as auth_router
from .api.routes.analytics import router as analytics_router
from .api.routes.catalogs import router as catalogs_router
from .api.routes.cmdb import router as cmdb_router
from .api.routes.connection_inventory import router as connection_inventory_router
from .api.routes.dashboard_preferences import router as dashboard_preferences_router
from .api.routes.events import router as events_router
from .api.routes.health import router as health_router
from .api.routes.findings import router as findings_router
from .api.routes.ingestion import router as ingestion_router
from .api.routes.search import router as search_router
from .api.routes.users import router as users_router
from .api.routes.workspace_preferences import router as workspace_preferences_router
from .api.routes.access_control import router as access_control_router
from .api.routes.safes import router as safes_router
from .auth import AUTH_MODE, OIDC_ENABLED
from .config import AppSettings, allowed_web_origins, api_docs_urls
from .lifecycle import build_lifespan
from .http_security import ApiSecurityMiddleware


SETTINGS = AppSettings.from_environment()
_API_DOCS_URLS = api_docs_urls(SETTINGS.expose_api_docs)

# Composition root: keep the public API identity and router topology in one
# place while leaving route modules responsible for their own contracts.
API_ROUTERS = (
    health_router,
    findings_router,
    events_router,
    auth_router,
    activity_router,
    security_events_router,
    analytics_router,
    catalogs_router,
    cmdb_router,
    connection_inventory_router,
    dashboard_preferences_router,
    workspace_preferences_router,
    search_router,
    ingestion_router,
    users_router,
    access_control_router,
    safes_router,
)

app = FastAPI(
    title="DS Hub API",
    version="0.1.0",
    description=(
        "API del CMDB de accesos privilegiados: ingesta, inventario de Safes, "
        "clasificación, catálogos, auditoría y cobertura PAM/SIA.\n\n"
        "La API usa sesión firmada para el frontend. Las automatizaciones sólo "
        "pueden usar X-Access-Token en operaciones de escritura autorizadas. "
        "Los endpoints de lectura no aceptan ese token. No se exponen secretos "
        "ni credenciales de cuentas."
    ),
    openapi_tags=[
        {"name": "Health y autenticación", "description": "Salud pública mínima, login, sesión y estado de autenticación."},
        {"name": "Actividad", "description": "Bitácora administrativa; disponible para administradores."},
        {"name": "Safes", "description": "Inventario, detalle, clasificación y ciclo de vida de Safes."},
        {"name": "Ingesta", "description": "Previsualización, ejecución y seguimiento de sincronizaciones."},
        {"name": "Catálogos", "description": "Unidades de negocio y responsables."},
        {"name": "Analítica", "description": "Resumen y composición del inventario."},
        {"name": "CMDB normalizado", "description": "Cobertura de objetos y relaciones PAM/SIA."},
        {"name": "Búsqueda", "description": "Búsqueda global de inventario no secreto."},
        {"name": "Hallazgos", "description": "Reglas versionadas, evidencia y estado de postura."},
        {"name": "Inventario de conexiones", "description": "Inventario importado por IP y coincidencias exactas con PAM/SIA."},
        {"name": "Usuarios y permisos", "description": "Usuarios locales, roles y permisos de administración."},
        {"name": "Acceso y permisos", "description": "Catálogo de permisos y roles internos de DS Hub."},
        {"name": "Preferencias de workspace", "description": "Accesos rápidos y workspaces recientes por usuario."},
        {"name": "Autenticación", "description": "Bootstrap inicial, login local y callbacks OIDC."},
    ],
    swagger_ui_parameters={
        "filter": True,
        "displayRequestDuration": True,
        "docExpansion": "none",
        "defaultModelsExpandDepth": 1,
    },
    docs_url=_API_DOCS_URLS["docs_url"],
    redoc_url=_API_DOCS_URLS["redoc_url"],
    openapi_url=_API_DOCS_URLS["openapi_url"],
    lifespan=build_lifespan(SETTINGS, OIDC_ENABLED),
)
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

ALLOWED_WEB_ORIGINS = allowed_web_origins(SETTINGS.web_origin)
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
    allow_headers=["Content-Type", "X-Access-Token"],
)
app.add_middleware(ApiSecurityMiddleware, allowed_origins=ALLOWED_WEB_ORIGINS, max_body_bytes=SETTINGS.api_max_body_bytes)

for router in API_ROUTERS:
    app.include_router(router)


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
    ("/api/auth/me", "get"): ("Consultar mi sesión", "Devuelve el actor y los permisos efectivos de la sesión o del token técnico."),
    ("/api/auth/setup-status", "get"): ("Consultar estado de configuración inicial", "Indica si todavía se puede crear el primer usuario local."),
    ("/api/auth/login", "get"): ("Obtener método de login", "Indica si el acceso local está habilitado o inicia el flujo OIDC configurado."),
    ("/api/auth/login", "post"): ("Iniciar sesión local", "Valida las credenciales y crea una sesión firmada. El endpoint aplica rate limiting por IP y email."),
    ("/api/auth/oidc/login", "get"): ("Iniciar login corporativo", "Comienza el flujo OIDC cuando está habilitado y configurado."),
    ("/api/auth/password", "post"): ("Cambiar mi contraseña", "Cambia la contraseña del actor autenticado y aplica la política local vigente."),
    ("/api/auth/callback", "get"): ("Completar callback OIDC", "Completa el callback del proveedor OIDC y crea la sesión de DS Hub."),
    ("/api/auth/logout", "post"): ("Cerrar sesión", "Invalida la sesión actual."),
    ("/api/auth/status", "get"): ("Consultar estado de sesión", "Devuelve autenticación, usuario, permisos y disponibilidad del bootstrap."),
    ("/api/auth/register", "post"): ("Crear primer usuario", "Crea el primer administrador local sin token, sólo cuando no existe ningún usuario y ALLOW_SELF_REGISTER_SETUP=true. Deshabilitado por defecto; ver AUTH_BOOTSTRAP_TOKEN para el camino recomendado."),
    ("/api/auth/bootstrap", "post"): ("Crear administrador por bootstrap", "Crea el primer administrador usando el token temporal de bootstrap configurado."),
    ("/api/catalogs", "get"): ("Listar catálogos", "Devuelve unidades de negocio, responsables y tipos de cuenta disponibles."),
    ("/api/business-units/{business_unit_id}", "patch"): ("Actualizar unidad de negocio", "Activa, desactiva o modifica una unidad de negocio; requiere catalogs:write."),
    ("/api/responsibles/{responsible_id}", "patch"): ("Actualizar responsable", "Activa, desactiva o modifica un responsable; requiere catalogs:write."),
    ("/api/auth/users", "get"): ("Listar usuarios de DS Hub", "Devuelve usuarios locales y sus roles; requiere access:manage."),
    ("/api/auth/users", "post"): ("Crear usuario de DS Hub", "Crea un usuario local y asigna su rol inicial; requiere access:manage."),
    ("/api/auth/users/{user_id}", "patch"): ("Actualizar usuario de DS Hub", "Modifica el estado, nombre o roles de un usuario; requiere access:manage."),
    ("/api/auth/users/{user_id}", "delete"): ("Eliminar usuario de DS Hub", "Elimina un usuario y sus asignaciones; requiere access:manage."),
    ("/api/auth/users/{user_id}/reissue-temp-password", "post"): ("Regenerar contraseña temporal", "Genera una contraseña temporal de un usuario; requiere access:manage."),
    ("/api/access/permissions", "get"): ("Listar permisos", "Devuelve el catálogo de permisos internos de DS Hub."),
    ("/api/access/roles", "get"): ("Listar roles internos", "Devuelve roles, permisos, estado y cantidad de usuarios."),
    ("/api/access/domains", "get"): ("Listar dominios y niveles", "Devuelve los dominios funcionales y niveles de acceso disponibles."),
    ("/api/safes/{safe_number}", "get"): ("Consultar detalle de Safe", "Devuelve el detalle, miembros, cuentas y auditoría asociada a una Safe."),
    ("/api/safes/{safe_number}/audit", "get"): ("Consultar auditoría de Safe", "Devuelve cambios administrativos registrados para una Safe."),
    ("/api/lifecycle/retired", "get"): ("Listar Safes retiradas", "Devuelve candidatos retirados detectados por una corrida completa."),
}


def custom_openapi():
    """Publish the real authentication contract in Swagger without changing
    runtime authorization, which remains enforced by route dependencies."""
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
    })
    for path, path_item in schema.get("paths", {}).items():
        for method, operation in path_item.items():
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            if (path, method) in OPENAPI_OPERATION_OVERRIDES:
                summary, description = OPENAPI_OPERATION_OVERRIDES[(path, method)]
                operation["summary"] = summary
                operation["description"] = description
            if (path, method) in PUBLIC_OPENAPI_OPERATIONS:
                operation["security"] = []
                continue
            if path == "/api/auth/bootstrap" and method == "post":
                operation["security"] = [{"bootstrapToken": []}]
                continue
            # Read endpoints use the signed browser session. Write endpoints
            # may use either an authenticated session or the technical token;
            # route-level permissions remain the source of truth.
            if path == "/api/auth/me" and method == "get":
                operation["security"] = [{"sessionCookie": []}, {"accessToken": []}]
            elif method == "get":
                operation["security"] = [{"sessionCookie": []}]
            elif path in {"/api/auth/password", "/api/auth/me", "/api/auth/logout"}:
                operation["security"] = [{"sessionCookie": []}]
            else:
                operation["security"] = [{"sessionCookie": []}, {"accessToken": []}]
    app.openapi_schema = schema
    return app.openapi_schema


app.openapi = custom_openapi
