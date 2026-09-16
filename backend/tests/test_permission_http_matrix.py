"""AUD-SEC-001: end-to-end HTTP proof that permission-gated routes really
enforce the permission through the real FastAPI/Starlette wiring.

Earlier tests (test_auth.py, test_auth_read_access.py, ...) only exercise the
`require_permission`/`require_any_permission` dependency functions directly,
never through an actual request against a mounted route. That leaves a real
gap: nothing fails if someone accidentally drops the `Depends(...)`/
`dependencies=[...]` from a route decorator.

This module drives the real app (`app.main.app`) over ASGI with
`httpx.AsyncClient` + `httpx.ASGITransport` -- not Starlette's
`TestClient`, which wraps httpx in a sync-over-async shim that is
deprecated as of Starlette 1.6 (`StarletteDeprecationWarning: Using httpx
with starlette.testclient is deprecated`) and has shown to hang outright
against some httpx/starlette version combinations in CI. Talking to the
ASGI app directly with an async client sidesteps that shim entirely and
is httpx's own documented way to test an ASGI app.

The session performs a genuine local login (so the session cookie is
signed by the real `SessionMiddleware`, not faked), and only mocks two
things that would otherwise require a live Postgres connection:
  - the repository call backing local login (`find_local_user_for_login`);
  - `get_actor_permissions`, so each scenario can control exactly which
    permissions the authenticated actor holds;
and, for the "permission granted" half of each case, the single repository
call the route would otherwise make against the (unavailable) database.

The app's lifespan (which opens a real DB pool) is intentionally never
triggered -- ASGITransport does not run lifespan by default -- so this
suite has no dependency on a running Postgres instance.
"""

import os
import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

os.environ.update({
    'DATABASE_URL': 'postgresql://test:test@127.0.0.1:5432/cmdb',
    'SESSION_SECRET': 'test-only-session-secret-at-least-32-bytes',
    'INGESTION_INTERVAL_MINUTES': '1440',
    'AUTH_MODE': 'local',
    'SESSION_HTTPS_ONLY': 'false',
})

import httpx  # noqa: E402

from app.main import app  # noqa: E402
from app.services.password_hashing import hash_password  # noqa: E402

PASSWORD = "Sample123456789!"
PASSWORD_HASH = hash_password(PASSWORD)


class _AuthenticatedSession:
    """Logs a fresh httpx.AsyncClient in as a controllable actor, without
    touching a real database. Permissions can be swapped between requests
    via `set_permissions`, so a single logged-in session can be reused to
    prove both the "missing permission -> 403" and "has permission -> not
    403" halves of a case.
    """

    SESSION_VERSION = 1

    def __init__(self, stack: ExitStack, client: httpx.AsyncClient, actor_id: str = "actor-1", must_change_password: bool = False):
        self.actor_id = actor_id
        self.client = client
        self._permissions_mock = stack.enter_context(
            patch("app.auth.get_actor_permissions", new=AsyncMock(return_value=[]))
        )
        stack.enter_context(patch.object(app.state, "db", object(), create=True))
        # PENTEST-004: require_read_access/require_write_access now also
        # check session_version against the database on every request; keep
        # it matching what login stamps into the session so the rest of
        # this matrix's route-level assertions aren't coupled to that check.
        self._session_version_mock = stack.enter_context(
            patch("app.auth.get_session_version", new=AsyncMock(return_value=_AuthenticatedSession.SESSION_VERSION))
        )
        stack.enter_context(
            patch(
                "app.api.routes.auth_session.find_local_user_for_login",
                new=AsyncMock(return_value={
                    "actor_id": actor_id,
                    "email": f"{actor_id}@example.test",
                    "display_name": "Test Actor",
                    "password_hash": PASSWORD_HASH,
                    "must_change_password": must_change_password,
                    "session_version": self.SESSION_VERSION,
                    "roles": ["reader"],
                    "role_names": ["Lector"],
                }),
            )
        )
        stack.enter_context(
            patch("app.api.routes.auth_session.verify_password_async", new=AsyncMock(return_value=True))
        )
        # PENTEST-006: login now reserves/clears its rate limit via the
        # real database; this matrix logs in through the real route to get
        # a genuinely signed session cookie, so those calls need mocking
        # like every other repository call here.
        stack.enter_context(
            patch("app.api.routes.auth_session.enforce_rate_limit", new=AsyncMock(return_value=None))
        )
        stack.enter_context(
            patch("app.api.routes.auth_session.clear_rate_limit", new=AsyncMock(return_value=None))
        )

    async def login(self) -> None:
        response = await self.client.post("/api/auth/login", json={"email": f"{self.actor_id}@example.test", "password": PASSWORD})
        assert response.status_code == 200, response.text

    def set_permissions(self, permissions: list[str]) -> None:
        self._permissions_mock.return_value = permissions


class PermissionHttpMatrixTests(unittest.IsolatedAsyncioTestCase):
    """One representative, permission-gated route per audited surface."""

    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        transport = httpx.ASGITransport(app=app)
        self.client = httpx.AsyncClient(transport=transport, base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_user_admin_list_requires_access_manage(self):
        self.session.set_permissions(["inventory:read"])
        denied = await self.client.get("/api/auth/users")
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["access:manage"])
        with patch("app.api.routes.users.list_users", new=AsyncMock(return_value=[])):
            granted = await self.client.get("/api/auth/users")
        self.assertEqual(granted.status_code, 200)

    async def test_user_admin_create_requires_access_manage(self):
        payload = {"email": "new-user@example.test", "display_name": "Nuevo", "role_code": "reader"}
        self.session.set_permissions(["inventory:read"])
        denied = await self.client.post("/api/auth/users", json=payload)
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["access:manage"])
        with patch("app.api.routes.users.role_exists", new=AsyncMock(return_value=True)), \
             patch("app.api.routes.users.create_user", new=AsyncMock(return_value={"actor_id": "new", "email": payload["email"]})):
            granted = await self.client.post("/api/auth/users", json=payload)
        self.assertEqual(granted.status_code, 201)

    async def test_access_control_permission_catalog_requires_access_manage(self):
        self.session.set_permissions(["inventory:read"])
        denied = await self.client.get("/api/access/permissions")
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["access:manage"])
        with patch("app.api.routes.access_control.list_permissions", new=AsyncMock(return_value=[])):
            granted = await self.client.get("/api/access/permissions")
        self.assertEqual(granted.status_code, 200)

    async def test_safe_metadata_update_requires_safes_classify(self):
        payload = {"classification_status": "assigned"}
        self.session.set_permissions(["inventory:read"])
        denied = await self.client.patch("/api/safes/123/metadata", json=payload)
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["inventory:read", "safes:classify"])
        with patch("app.api.routes.safe_write.update_safe_metadata", new=AsyncMock(return_value={"safe_number": 123})):
            granted = await self.client.patch("/api/safes/123/metadata", json=payload)
        self.assertEqual(granted.status_code, 200)

    async def test_safe_bulk_assignment_requires_safes_bulk_classify(self):
        payload = {"safe_numbers": [1, 2, 3], "workflow_status": "in_progress"}
        self.session.set_permissions(["inventory:read", "safes:classify"])  # single-Safe permission is not enough here
        denied = await self.client.post("/api/safes/bulk-assignment", json=payload)
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["inventory:read", "safes:bulk_classify"])
        with patch("app.api.routes.safe_write.bulk_update_safe_assignment", new=AsyncMock(return_value={"updated": 3})):
            granted = await self.client.post("/api/safes/bulk-assignment", json=payload)
        self.assertEqual(granted.status_code, 200)

    async def test_cmdb_pam_users_requires_pam_catalog_permission(self):
        # Router-level dependency also requires inventory:read; missing both
        # the base read permission and the catalog permission must 403.
        self.session.set_permissions([])
        denied = await self.client.get("/api/cmdb/pam-users")
        self.assertEqual(denied.status_code, 403)

        # inventory:read alone (no pam:catalogs_read / access:manage) still 403s.
        self.session.set_permissions(["inventory:read"])
        still_denied = await self.client.get("/api/cmdb/pam-users")
        self.assertEqual(still_denied.status_code, 403)

        self.session.set_permissions(["inventory:read", "pam:catalogs_read"])
        with patch("app.api.routes.cmdb.list_pam_users", new=AsyncMock(return_value=[])):
            granted = await self.client.get("/api/cmdb/pam-users")
        self.assertEqual(granted.status_code, 200)

    async def test_cmdb_sia_connectors_requires_sia_catalog_permission(self):
        self.session.set_permissions(["inventory:read", "pam:catalogs_read"])
        denied = await self.client.get("/api/cmdb/sia-connectors")
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["inventory:read", "sia:catalogs_read"])
        with patch("app.api.routes.cmdb.list_sia_connectors", new=AsyncMock(return_value=[])):
            granted = await self.client.get("/api/cmdb/sia-connectors")
        self.assertEqual(granted.status_code, 200)

    async def test_security_events_requires_access_manage(self):
        """PENTEST-008: the new persisted security-events log is gated
        exactly like /api/activity -- access:manage only."""
        self.session.set_permissions(["inventory:read"])
        denied = await self.client.get("/api/security-events")
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["inventory:read", "access:manage"])
        with patch("app.repositories.security_events.fetch_all", new=AsyncMock(return_value=[])):
            granted = await self.client.get("/api/security-events")
        self.assertEqual(granted.status_code, 200)
        self.assertEqual(granted.json(), {"rows": [], "total": 0, "limit": 50, "offset": 0})

    async def test_remaining_access_control_and_user_admin_mutations_require_access_manage(self):
        """AUD-API-001 follow-up: the OpenAPI contract test only proves a
        route is *published*, which stays true even if someone removes its
        Depends(require_permission(...)) entirely -- FastAPI doesn't need a
        dependency to register a route for it to keep showing up in the
        schema. Only a real HTTP round trip proves enforcement, and the
        matrix above only exercised a handful of representative routes.
        This closes that gap for every remaining access:manage-gated route
        in access_control.py and users.py, in one batch rather than one
        near-identical test method per route.
        """
        self.session.set_permissions(["inventory:read"])  # authenticated, but no access:manage
        cases = [
            ("get", "/api/access/roles", None),
            ("get", "/api/access/domains", None),
            ("get", "/api/security-events", None),
            ("post", "/api/access/permissions", {"permission_code": "safes:export", "domain_code": "pam", "resource_code": "safes", "action_code": "export", "description": "Exportar Safes"}),
            ("post", "/api/access/roles", {"role_code": "data_reviewer", "display_name": "Data Reviewer", "description": "Revisa inventario", "domain_code": "pam"}),
            ("post", "/api/access/roles/composite", {"role_code": "regional_security", "display_name": "Seguridad regional", "description": "Acceso combinado", "level_refs": [{"domain_code": "pam", "level_code": "admin"}]}),
            ("patch", "/api/access/roles/data_reviewer", {"display_name": "Data Reviewer", "description": "Revisa inventario", "domain_code": "pam"}),
            ("patch", "/api/access/roles/regional_security/composite", {"display_name": "Seguridad regional", "description": "Acceso combinado", "level_refs": [{"domain_code": "pam", "level_code": "admin"}]}),
            ("patch", "/api/auth/users/actor-2", {"display_name": "Nuevo nombre"}),
            ("delete", "/api/auth/users/actor-2", None),
            ("post", "/api/auth/users/actor-2/reissue-temp-password", None),
        ]
        for method, path, payload in cases:
            with self.subTest(method=method, path=path):
                response = await self.client.request(method.upper(), path, json=payload)
                self.assertEqual(response.status_code, 403, f"{method.upper()} {path} did not 403 without access:manage (got {response.status_code}: {response.text})")

    async def test_remaining_safe_write_mutations_require_safes_classify(self):
        """Same follow-up as above, for every remaining safes:classify-gated
        route in safe_write.py (account classification, assignment, scope,
        account-type, quick-update -- bulk-assignment and metadata are
        already covered above)."""
        self.session.set_permissions(["inventory:read"])  # authenticated + base read, but no safes:classify
        cases = [
            ("patch", "/api/accounts/123/acc-1/classification", {"inventory_account_type": "nominal"}),
            ("patch", "/api/safes/123/assignment", {"business_unit_id": 1}),
            ("patch", "/api/safes/123/scope", {"inventory_scope": "business"}),
            ("patch", "/api/safes/123/account-type", {"account_type_classification": "nominal"}),
            ("patch", "/api/safes/123/quick-update", {"workflow_status": "in_progress"}),
        ]
        for method, path, payload in cases:
            with self.subTest(method=method, path=path):
                response = await self.client.request(method.upper(), path, json=payload)
                self.assertEqual(response.status_code, 403, f"{method.upper()} {path} did not 403 without safes:classify (got {response.status_code}: {response.text})")

    async def test_safe_lifecycle_routes_require_read_access(self):
        """AUD-SEC-002 / PENTEST-005: safe_lifecycle.py used to rely entirely
        on the `safes` router facade (api/routes/safes.py) mounting it
        behind a blanket `dependencies=[Depends(require_read_access)]`. That
        blanket dependency also applied to every write route nested under
        the same facade (safe_write.py), 401ing X-Access-Token callers
        before their own route-level permission dependency ever got a
        chance to authorize them (see the PENTEST-005 tests below). Each
        safe_lifecycle.py route now declares require_read_access directly
        instead; this proves that per-route gate is still real for both of
        its routes.
        """
        self.session.set_permissions([])
        audit_denied = await self.client.get("/api/safes/123/audit")
        self.assertEqual(audit_denied.status_code, 403)
        retired_denied = await self.client.get("/api/lifecycle/retired")
        self.assertEqual(retired_denied.status_code, 403)

        self.session.set_permissions(["inventory:read"])
        with patch("app.api.routes.safe_lifecycle.list_safe_audit", new=AsyncMock(return_value=[])):
            audit_granted = await self.client.get("/api/safes/123/audit")
        self.assertEqual(audit_granted.status_code, 200)

        with patch("app.api.routes.safe_lifecycle.get_retired_candidates", new=AsyncMock(return_value=[])), \
             patch("app.api.routes.safe_lifecycle.count_retired_candidates", new=AsyncMock(return_value=0)):
            retired_granted = await self.client.get("/api/lifecycle/retired")
        self.assertEqual(retired_granted.status_code, 200)


class MustChangePasswordEnforcementHttpTests(unittest.IsolatedAsyncioTestCase):
    """PENTEST-002: reproduces, over real ASGI HTTP, the exact scenario the
    pentest finding used to confirm the bypass -- log in with a temporary
    password, then call an ordinary read endpoint directly instead of going
    through the frontend's blocking screen. That request used to succeed
    (200); it must now 403 regardless of the actor's actual permissions.
    """

    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        transport = httpx.ASGITransport(app=app)
        self.client = httpx.AsyncClient(transport=transport, base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client, must_change_password=True)
        await self.session.login()
        # Full read+admin permissions -- proves the block is unconditional,
        # not just "this actor happens to lack a permission".
        self.session.set_permissions(["inventory:read", "access:manage"])

    async def test_an_ordinary_read_route_is_blocked_while_password_change_is_pending(self):
        response = await self.client.get("/api/summary")
        self.assertEqual(response.status_code, 403)

    async def test_an_ordinary_write_route_is_blocked_while_password_change_is_pending(self):
        response = await self.client.get("/api/auth/users")
        self.assertEqual(response.status_code, 403)

    async def test_the_password_change_route_itself_remains_reachable(self):
        with patch("app.api.routes.auth_session.change_own_password", new=AsyncMock(return_value=_AuthenticatedSession.SESSION_VERSION)):
            response = await self.client.post(
                "/api/auth/password",
                json={"current_password": "Sample123!", "new_password": "NewPassw0rd!"},
            )
        self.assertEqual(response.status_code, 200)

    async def test_status_and_logout_remain_reachable(self):
        with patch(
            "app.api.routes.auth_session.get_local_account_status",
            new=AsyncMock(return_value={"must_change_password": True, "roles": ["reader"], "role_names": ["Lector"]}),
        ), patch("app.api.routes.auth_session.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"])):
            status_response = await self.client.get("/api/auth/status")
        self.assertEqual(status_response.status_code, 200)
        self.assertTrue(status_response.json()["user"]["must_change_password"])

        logout_response = await self.client.post("/api/auth/logout")
        self.assertEqual(logout_response.status_code, 200)

    async def test_block_is_lifted_once_the_password_is_changed(self):
        with patch("app.api.routes.auth_session.change_own_password", new=AsyncMock(return_value=_AuthenticatedSession.SESSION_VERSION)):
            change_response = await self.client.post(
                "/api/auth/password",
                json={"current_password": "Sample123!", "new_password": "NewPassw0rd!"},
            )
        self.assertEqual(change_response.status_code, 200)

        with patch("app.api.routes.users.list_users", new=AsyncMock(return_value=[])):
            response = await self.client.get("/api/auth/users")
        self.assertEqual(response.status_code, 200)


class SessionRevocationHttpTests(unittest.IsolatedAsyncioTestCase):
    """PENTEST-004: reproduces, over real ASGI HTTP, the exact scenario the
    pentest finding used -- a session cookie that's still validly signed and
    unexpired must stop working the moment the account's password changes,
    without the cookie itself ever being touched.
    """

    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        transport = httpx.ASGITransport(app=app)
        self.client = httpx.AsyncClient(transport=transport, base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()
        self.session.set_permissions(["inventory:read"])

    async def test_a_stolen_cookie_stops_working_once_the_password_changes_elsewhere(self):
        # The cookie works while the account's session_version (1) still
        # matches what login stamped into it.
        with patch("app.api.routes.analytics.get_summary", new=AsyncMock(return_value={})):
            response = await self.client.get("/api/summary")
        self.assertEqual(response.status_code, 200)

        # Something else bumps the account's session_version (a real
        # password change/reset would do this via an UPDATE ... RETURNING;
        # here that's simulated by making the database report the new
        # value on the *next* lookup, exactly as it would after a real
        # UPDATE committed). The stolen cookie was never touched.
        self.session._session_version_mock.return_value = _AuthenticatedSession.SESSION_VERSION + 1

        stale_cookie_response = await self.client.get("/api/summary")
        self.assertEqual(stale_cookie_response.status_code, 401)

        # The session was cleared server-side too, not just this one
        # response rejected -- a follow-up request with the same (now
        # session-less) cookie still 401s rather than silently working
        # again through some cached state.
        follow_up_response = await self.client.get("/api/summary")
        self.assertEqual(follow_up_response.status_code, 401)

    async def test_auth_status_clears_and_reports_a_revoked_session_as_unauthenticated(self):
        self.session._session_version_mock.return_value = _AuthenticatedSession.SESSION_VERSION + 1

        response = await self.client.get("/api/auth/status")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["authenticated"])
        self.assertIsNone(response.json()["user"])

    async def test_legacy_unversioned_local_cookie_is_rejected(self):
        import json
        import time
        from base64 import b64encode

        from itsdangerous import TimestampSigner

        from app.auth import SESSION_LAST_ACTIVITY_AT, SESSION_STARTED_AT

        self.client.cookies.clear()
        legacy_session = {
            "user": {"actor_id": self.session.actor_id, "roles": ["reader"]},
            SESSION_STARTED_AT: time.time(),
            SESSION_LAST_ACTIVITY_AT: time.time(),
        }
        payload = b64encode(json.dumps(legacy_session).encode("utf-8"))
        cookie = TimestampSigner("test-only-session-secret-at-least-32-bytes").sign(payload).decode("utf-8")
        self.client.cookies.set("session", cookie)

        response = await self.client.get("/api/summary")

        self.assertEqual(response.status_code, 401)


class TechnicalTokenScopeHttpTests(unittest.IsolatedAsyncioTestCase):
    """PENTEST-005: over real ASGI HTTP, proves the boundary between the
    browser session and the X-Access-Token automation credential now
    matches what the OpenAPI contract documents (`app/main.py`'s
    custom_openapi(): GET routes list only sessionCookie; POST/PATCH/DELETE
    routes list both).

    Before this fix: GET /api/auth/users (and several other administrative/
    catalog reads) accepted the technical token via require_permission's
    require_write_access fallback, despite the docs saying reads never
    accept it. Separately, POST /api/ingestion/runs (and other writes
    mounted under a router that also serves reads) 401'd a valid technical
    token outright, because a router-level `require_read_access` (session
    only) ran before the route's own permission dependency ever got a
    chance to authorize it -- despite the docs saying those writes accept
    the token.
    """

    TOKEN = "technical-token-for-pentest-005-tests"

    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(os.environ, {"APP_WRITE_TOKEN": self.TOKEN, "APP_ACTOR_ID": "automation-actor"}))
        self.stack.enter_context(patch.object(app.state, "db", object(), create=True))
        self._permissions_mock = self.stack.enter_context(
            patch("app.auth.get_actor_permissions", new=AsyncMock(return_value=[]))
        )
        transport = httpx.ASGITransport(app=app)
        self.client = httpx.AsyncClient(transport=transport, base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)

    def _headers(self):
        return {"X-Access-Token": self.TOKEN}

    async def test_read_only_routes_never_accept_the_technical_token(self):
        # No session at all -- only a valid technical token, with every
        # permission it could conceivably need. Every one of these read
        # routes must still 401 exactly like an unauthenticated request
        # would, matching the documented contract.
        self._permissions_mock.return_value = [
            "access:manage", "pam:catalogs_read", "sia:catalogs_read",
            "identity:catalogs_read", "inventory:export", "inventory:read",
        ]
        cases = [
            "/api/activity",
            "/api/security-events",
            "/api/auth/users",
            "/api/access/permissions",
            "/api/access/roles",
            "/api/access/domains",
            "/api/cmdb/pam-platforms",
            "/api/cmdb/sia-connectors",
            "/api/accounts/export.csv",
            "/api/safes/export.csv",
        ]
        for path in cases:
            with self.subTest(path=path):
                response = await self.client.get(path, headers=self._headers())
                self.assertEqual(response.status_code, 401, f"GET {path} with only a technical token did not 401 (got {response.status_code}: {response.text})")

    async def test_writes_documented_as_token_compatible_now_accept_it(self):
        # These previously 401'd because a router-level require_read_access
        # (session-only) ran before the route's own require_permission
        # dependency ever got a chance to authorize the token.
        self._permissions_mock.return_value = [
            "ingestion:run", "catalogs:manage", "safes:classify",
        ]
        with patch(
            "app.api.routes.ingestion.enqueue_sync_run",
            new=AsyncMock(return_value={"run_id": "11111111-1111-1111-1111-111111111111", "status": "queued"}),
        ), patch.object(app.state, "sync_coordinator", type("_Coordinator", (), {"wake": lambda self: None})(), create=True):
            response = await self.client.post("/api/ingestion/runs", json={}, headers=self._headers())
        self.assertEqual(response.status_code, 202, response.text)

        with patch(
            "app.api.routes.catalogs.create_business_unit",
            new=AsyncMock(return_value={"id": 1, "unit_code": "IT", "unit_name": "IT"}),
        ):
            response = await self.client.post(
                "/api/business-units", json={"unit_code": "IT", "unit_name": "IT"}, headers=self._headers(),
            )
        self.assertEqual(response.status_code, 201, response.text)

        with patch("app.api.routes.safe_write.update_safe_quick", new=AsyncMock(return_value={"safe_number": 123})):
            response = await self.client.patch(
                "/api/safes/123/quick-update", json={"workflow_status": "in_progress"}, headers=self._headers(),
            )
        self.assertEqual(response.status_code, 200, response.text)

    async def test_read_routes_still_require_a_session_regardless_of_the_token(self):
        # GET /api/ingestion/runs (and /api/catalogs, /api/safes, etc.) used
        # to rely on a router-level require_read_access; each now declares
        # it per-route instead. The technical token alone (no session)
        # must still 401 there too -- this fix must not have accidentally
        # made the token a universal credential.
        self._permissions_mock.return_value = ["ingestion:run", "inventory:read"]
        for path in ("/api/ingestion/runs", "/api/catalogs", "/api/safes", "/api/findings", "/api/connection-inventory"):
            with self.subTest(path=path):
                response = await self.client.get(path, headers=self._headers())
                self.assertEqual(response.status_code, 401, f"GET {path} with only a technical token did not 401 (got {response.status_code}: {response.text})")


if __name__ == "__main__":
    unittest.main()
