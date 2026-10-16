from __future__ import annotations

from collections.abc import Iterable
from uuid import uuid4

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.logging_config import reset_request_id, set_request_id


UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


async def _read_body_within_limit(receive: Receive, limit: int) -> tuple[bytes, bool]:
    """Drains the real ASGI body, bounded at ``limit + 1`` bytes.

    ``Content-Length`` is caller-supplied and is entirely absent under
    chunked transfer encoding, so it can never be trusted as the sole size
    gate (PENTEST-007: a declared/omitted length let bodies past the
    configured limit reach downstream handlers uncounted). This reads the
    actual bytes the client sends instead, and never buffers more than one
    byte past the limit before giving up -- a hostile body cannot force
    unbounded memory use here even while the check is in progress.

    Returns ``(body, oversized)``. When ``oversized`` is True, ``body`` is a
    partial, limit+1-byte prefix only good for diagnostics; the caller must
    reject the request and must not hand it to the downstream app.
    """
    chunks = bytearray()
    while True:
        message = await receive()
        if message["type"] != "http.request":
            # e.g. http.disconnect -- nothing more will arrive; stop here.
            break
        chunks.extend(message.get("body", b""))
        if len(chunks) > limit:
            return bytes(chunks[: limit + 1]), True
        if not message.get("more_body", False):
            break
    return bytes(chunks), False


def _replay_receive(body: bytes, original_receive: Receive) -> Receive:
    """Wraps ``receive`` so the already-drained body is replayed once."""
    delivered = False

    async def receive() -> Message:
        nonlocal delivered
        if not delivered:
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}
        return await original_receive()

    return receive


class ApiSecurityMiddleware:
    """Defense-in-depth for the HTTP API.

    Authentication and authorization remain route dependencies. This layer
    rejects browser mutations from unknown origins and adds non-cacheable,
    non-embeddable response defaults without trusting caller-supplied IDs.
    Requests without an Origin header remain valid for server-to-server tools;
    those still need their normal token or session authentication.
    """

    def __init__(self, app: ASGIApp, allowed_origins: Iterable[str], max_body_bytes: int = 8 * 1024 * 1024):
        self.app = app
        self.allowed_origins = frozenset(origin.rstrip("/") for origin in allowed_origins if origin)
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Bound before any early rejection so every log line of this request,
        # including uvicorn's access line, carries the X-Request-ID it returns.
        request_id = str(uuid4())
        request_context = set_request_id(request_id)
        try:
            await self._handle_http(scope, receive, send, request_id)
        finally:
            reset_request_id(request_context)

    async def _handle_http(self, scope: Scope, receive: Receive, send: Send, request_id: str) -> None:
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        origin = headers.get(b"origin", b"").decode("latin-1").rstrip("/")
        host = headers.get(b"host", b"").decode("latin-1").strip()
        same_origin = f"{scope.get('scheme', 'http')}://{host}" if host else ""
        scope.setdefault("state", {})["request_id"] = request_id

        async def secured_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers = list(message.get("headers", []))
                names = {key.lower() for key, _value in response_headers}
                additions = {
                    b"x-content-type-options": b"nosniff",
                    b"x-frame-options": b"DENY",
                    b"referrer-policy": b"no-referrer",
                    b"permissions-policy": b"camera=(), microphone=(), geolocation=()",
                    b"cross-origin-resource-policy": b"same-origin",
                    b"x-request-id": request_id.encode("ascii"),
                }
                if scope.get("scheme") == "https":
                    additions[b"strict-transport-security"] = b"max-age=31536000; includeSubDomains"
                if str(scope.get("path", "")).startswith("/api/"):
                    additions.update({
                        b"cache-control": b"no-store",
                        b"content-security-policy": b"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
                    })
                response_headers.extend((key, value) for key, value in additions.items() if key not in names)
                message = {**message, "headers": response_headers}
            await send(message)

        path = str(scope.get("path", ""))
        is_api_path = path.startswith("/api/")
        is_api_mutation = is_api_path and str(scope.get("method", "GET")).upper() in UNSAFE_METHODS
        content_length = headers.get(b"content-length", b"")
        try:
            body_bytes = int(content_length) if content_length else 0
        except ValueError:
            body_bytes = self.max_body_bytes + 1
        if is_api_path and body_bytes > self.max_body_bytes:
            response = JSONResponse({"detail": "El cuerpo de la solicitud supera el límite permitido"}, status_code=413)
            await response(scope, receive, secured_send)
            return

        body = b""
        if is_api_path:
            # PENTEST-007: Content-Length is caller-supplied and is entirely
            # absent under chunked transfer encoding (it computed to 0 above
            # in that case), so a declared/omitted length must never be the
            # only gate. Verify the real bytes the client actually sends,
            # bounded so we never buffer past the limit, and replay them
            # unchanged for the downstream app once confirmed within range.
            body, oversized = await _read_body_within_limit(receive, self.max_body_bytes)
            if oversized:
                response = JSONResponse({"detail": "El cuerpo de la solicitud supera el límite permitido"}, status_code=413)
                await response(scope, receive, secured_send)
                return
            receive = _replay_receive(body, receive)

        # All API mutations currently accept JSON payloads. Rejecting browser
        # form encodings prevents a cross-site form from reaching a cookie-
        # authenticated write endpoint, while body-less POSTs such as logout
        # remain valid.
        if is_api_mutation and body:
            content_type = headers.get(b"content-type", b"").decode("latin-1").lower()
            if not content_type.startswith("application/json"):
                response = JSONResponse({"detail": "Las mutaciones de la API requieren Content-Type application/json"}, status_code=415)
                await response(scope, receive, secured_send)
                return

        if is_api_mutation and origin and origin not in self.allowed_origins and origin != same_origin:
            response = JSONResponse({"detail": "Origen de solicitud no permitido"}, status_code=403)
            await response(scope, receive, secured_send)
            return

        await self.app(scope, receive, secured_send)
