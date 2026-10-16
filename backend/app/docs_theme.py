"""Branded API reference served at /docs.

The route used to render Swagger UI with a custom stylesheet. It now serves
Scalar (MIT, pinned to a known version) themed to the DS Hub dark/green
identity: tag groups per platform, multi-language code samples and a modern
request client, without the generic Swagger shell.

Pure presentation: the OpenAPI contract built in main.py (tags, tag groups,
security schemes, summaries, errors, x-codeSamples) is unchanged.
"""

import json

from fastapi.responses import HTMLResponse

# Same 32x32 mark as frontend/public/favicon.svg, inlined so /docs never
# depends on the frontend's static host (they're separate deployments).
DOCS_FAVICON_DATA_URI = (
    "data:image/svg+xml,"
    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
    "%3Crect width='32' height='32' rx='7' fill='%230d1712'/%3E"
    "%3Cpath d='M16 16 8.5 8.5M16 16l7.5-7.5M16 16v9' stroke='%2383e6a8' "
    "stroke-width='1.7' stroke-linecap='round'/%3E"
    "%3Ccircle cx='16' cy='16' r='4.2' fill='%2383e6a8'/%3E"
    "%3Ccircle cx='8' cy='8' r='2.8' fill='%23f2f4f5'/%3E"
    "%3Ccircle cx='24' cy='8' r='2.8' fill='%23f2f4f5'/%3E"
    "%3Ccircle cx='16' cy='25' r='2.8' fill='%23f2f4f5'/%3E"
    "%3C/svg%3E"
)

# Pinned so a CDN release cannot silently change the published reference.
# Bump together with the HTTP tests that assert this exact URL.
SCALAR_JS_URL = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.1"

# Token values copied from frontend/src/styles.css' dark :root block, kept
# as plain hex here since this HTML has no access to that stylesheet. Scalar
# exposes its palette as --scalar-* variables; the .dark-mode scope is the
# one that applies because darkMode is enabled below.
DOCS_CUSTOM_CSS = """
:root {
  --scalar-font: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}
.dark-mode {
  --scalar-color-1: #f2f4f5;
  --scalar-color-2: #9ba1a6;
  --scalar-color-3: #6b7175;
  --scalar-color-accent: #35c477;
  --scalar-background-1: #0a0b0c;
  --scalar-background-2: #111214;
  --scalar-background-3: #1d2125;
  --scalar-background-accent: rgba(53, 196, 119, 0.12);
  --scalar-border-color: #232426;
}
body { background: #0a0b0c; }
.sidebar, .toc { border-color: #232426; }
""".strip()


def build_api_reference_html(*, openapi_url: str, title: str) -> HTMLResponse:
    """Render the Scalar reference pointed at the app's OpenAPI schema.

    Scalar is loaded from a pinned jsDelivr build (the same CDN strategy the
    previous Swagger UI/Redoc routes used); the schema itself is always
    fetched same-origin from `openapi_url`.
    """
    configuration = {
        "url": openapi_url,
        "darkMode": True,
        "theme": "default",
        "customCss": DOCS_CUSTOM_CSS,
        # Telemetry would phone home from a security product's docs page.
        "telemetry": False,
        # No AI assistant and no Scalar cloud toolbar on an internal
        # security reference: the schema must not be uploaded anywhere.
        "agent": {"disabled": True},
        "showDeveloperTools": "never",
        "mcp": {"disabled": True},
        "hideClientButton": True,
        # Models live in the operation schemas; the flat "Models" index only
        # adds noise to an operator-facing reference.
        "hideModels": True,
        "metaData": {"title": title},
    }
    configuration_json = json.dumps(configuration, ensure_ascii=False).replace("</", "<\\/")
    html = f"""<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>{title}</title>
    <link rel="icon" href="{DOCS_FAVICON_DATA_URI}" />
  </head>
  <body>
    <div id="app"></div>
    <script src="{SCALAR_JS_URL}"></script>
    <script>
      Scalar.createApiReference('#app', {configuration_json})
    </script>
  </body>
</html>
"""
    return HTMLResponse(content=html)
