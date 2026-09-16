import asyncio
import unittest

from app.http_security import ApiSecurityMiddleware


async def call_middleware(method="GET", path="/api/summary", headers=None, body_chunks=None):
    called = False
    received_body = bytearray()

    async def application(_scope, receive, send):
        nonlocal called
        called = True
        while True:
            message = await receive()
            if message["type"] != "http.request":
                break
            received_body.extend(message.get("body", b""))
            if not message.get("more_body", False):
                break
        await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": b"{}"})

    middleware = ApiSecurityMiddleware(application, ["https://dshub.example"])
    messages = []

    chunks = list(body_chunks) if body_chunks is not None else [b""]

    async def receive():
        if chunks:
            chunk = chunks.pop(0)
            return {"type": "http.request", "body": chunk, "more_body": bool(chunks)}
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    scope = {
        "type": "http", "method": method, "path": path,
        "headers": [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()],
    }
    await middleware(scope, receive, send)
    return called, messages, bytes(received_body)


class ApiSecurityMiddlewareTests(unittest.TestCase):
    def test_api_responses_receive_security_and_trace_headers(self):
        called, messages, _body = asyncio.run(call_middleware())
        response = next(message for message in messages if message["type"] == "http.response.start")
        headers = dict(response["headers"])

        self.assertTrue(called)
        self.assertEqual(headers[b"cache-control"], b"no-store")
        self.assertEqual(headers[b"x-content-type-options"], b"nosniff")
        self.assertEqual(headers[b"x-frame-options"], b"DENY")
        self.assertIn(b"x-request-id", headers)
        self.assertNotEqual(headers[b"x-request-id"], b"caller-controlled")

    def test_https_api_responses_advertise_transport_and_cross_origin_defaults(self):
        # The helper defaults to HTTP, so exercise the middleware directly for
        # the production-only HSTS branch without changing local-dev behavior.
        async def run_https():
            called, messages = False, []

            async def application(_scope, _receive, send):
                nonlocal called
                called = True
                await send({"type": "http.response.start", "status": 200, "headers": []})
                await send({"type": "http.response.body", "body": b"{}"})

            middleware = ApiSecurityMiddleware(application, ["https://dshub.example"])
            async def receive():
                return {"type": "http.request", "body": b"", "more_body": False}
            async def send(message):
                messages.append(message)
            await middleware({"type": "http", "method": "GET", "path": "/api/summary", "scheme": "https", "headers": []}, receive, send)
            return called, messages

        called, messages = asyncio.run(run_https())
        headers = dict(next(message for message in messages if message["type"] == "http.response.start")["headers"])
        self.assertTrue(called)
        self.assertEqual(headers[b"strict-transport-security"], b"max-age=31536000; includeSubDomains")
        self.assertEqual(headers[b"cross-origin-resource-policy"], b"same-origin")

    def test_rejects_cross_origin_api_mutation_before_route(self):
        called, messages, _body = asyncio.run(call_middleware("PATCH", headers={"origin": "https://evil.example"}))
        response = next(message for message in messages if message["type"] == "http.response.start")

        self.assertFalse(called)
        self.assertEqual(response["status"], 403)

    def test_rejects_non_json_api_mutations(self):
        called, messages, _body = asyncio.run(call_middleware("POST", headers={"content-length": "3", "content-type": "application/x-www-form-urlencoded"}, body_chunks=[b"abc"]))
        response = next(message for message in messages if message["type"] == "http.response.start")

        self.assertFalse(called)
        self.assertEqual(response["status"], 415)

    def test_rejects_chunked_non_json_api_mutations_without_content_length(self):
        called, messages, _body = asyncio.run(
            call_middleware(
                "POST",
                headers={"content-type": "application/x-www-form-urlencoded"},
                body_chunks=[b"email=a", b"&password=b"],
            )
        )
        response = next(message for message in messages if message["type"] == "http.response.start")

        self.assertFalse(called)
        self.assertEqual(response["status"], 415)

    def test_rejects_oversized_api_bodies_before_route(self):
        called, messages, _body = asyncio.run(call_middleware("POST", headers={"content-length": str(9 * 1024 * 1024), "content-type": "application/json"}))
        response = next(message for message in messages if message["type"] == "http.response.start")

        self.assertFalse(called)
        self.assertEqual(response["status"], 413)

    def test_allows_configured_browser_origin_and_server_to_server_requests(self):
        allowed, allowed_messages, _body1 = asyncio.run(call_middleware("PUT", headers={"origin": "https://dshub.example"}))
        no_origin, no_origin_messages, _body2 = asyncio.run(call_middleware("POST"))

        self.assertTrue(allowed)
        self.assertEqual(allowed_messages[0]["status"], 200)
        self.assertTrue(no_origin)
        self.assertEqual(no_origin_messages[0]["status"], 200)

    def test_rejects_oversized_bodies_sent_without_a_content_length_header(self):
        # PENTEST-007: chunked transfer encoding omits Content-Length
        # entirely. A caller-supplied header can never be the only gate --
        # the real bytes streamed through receive() must be counted too.
        limit = ApiSecurityMiddleware(None, []).max_body_bytes
        oversized_chunks = [b"a" * 1024 for _ in range((limit // 1024) + 2)]
        called, messages, _body = asyncio.run(
            call_middleware(
                "POST",
                headers={"content-type": "application/json"},
                body_chunks=oversized_chunks,
            )
        )
        response = next(message for message in messages if message["type"] == "http.response.start")

        self.assertFalse(called)
        self.assertEqual(response["status"], 413)

    def test_rejects_bodies_larger_than_a_lying_content_length_header(self):
        # A caller can also declare a small Content-Length and then stream
        # more bytes than promised -- the real count must still catch it.
        limit = ApiSecurityMiddleware(None, []).max_body_bytes
        oversized_chunks = [b"a" * 1024 for _ in range((limit // 1024) + 2)]
        called, messages, _body = asyncio.run(
            call_middleware(
                "POST",
                headers={"content-length": "1", "content-type": "application/json"},
                body_chunks=oversized_chunks,
            )
        )
        response = next(message for message in messages if message["type"] == "http.response.start")

        self.assertFalse(called)
        self.assertEqual(response["status"], 413)

    def test_accepts_and_forwards_a_chunked_body_within_the_limit(self):
        # No Content-Length header at all (as with real chunked transfer
        # encoding), body well within the limit -- must reach the app intact.
        called, messages, received_body = asyncio.run(
            call_middleware(
                "POST",
                headers={"content-type": "application/json"},
                body_chunks=[b'{"a":', b'1}'],
            )
        )
        response = next(message for message in messages if message["type"] == "http.response.start")

        self.assertTrue(called)
        self.assertEqual(response["status"], 200)
        self.assertEqual(received_body, b'{"a":1}')


if __name__ == "__main__":
    unittest.main()
