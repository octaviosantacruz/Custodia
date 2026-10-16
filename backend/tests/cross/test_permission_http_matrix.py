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
from app.cross.services.password_hashing import hash_password  # noqa: E402

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
                "app.cross.services.local_authentication.find_local_user_for_login",
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
            patch("app.cross.services.local_authentication.verify_password_async", new=AsyncMock(return_value=True))
        )
        # PENTEST-006: login now reserves/clears its rate limit via the
        # real database; this matrix logs in through the real route to get
        # a genuinely signed session cookie, so those calls need mocking
        # like every other repository call here.
        stack.enter_context(
            patch("app.cross.api.routes.auth_session.enforce_rate_limit", new=AsyncMock(return_value=None))
        )
        stack.enter_context(
            patch("app.cross.api.routes.auth_session.clear_rate_limit", new=AsyncMock(return_value=None))
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
        # The typed directory contracts (AUD-API-002) require the full page
        # shape; this test only exercises the permission gate.
        with patch("app.cross.services.user_management.list_users", new=AsyncMock(
                return_value={"rows": [], "total": 0, "limit": 50, "offset": 0})):
            granted = await self.client.get("/api/auth/users")
        self.assertEqual(granted.status_code, 200)

        self.session.set_permissions(["inventory:read"])
        denied_people = await self.client.get("/api/auth/people")
        self.assertEqual(denied_people.status_code, 403)
        self.session.set_permissions(["access:manage"])
        with patch("app.cross.services.user_management.list_people", new=AsyncMock(
                return_value={"rows": [], "total": 0, "limit": 50, "offset": 0})):
            granted_people = await self.client.get("/api/auth/people")
        self.assertEqual(granted_people.status_code, 200)

    async def test_people_project_observed_groups_only_with_mapping_read_permission(self):
        identity = {
            "actor_id": "okta-observed", "email": "observed@example.test", "display_name": "Observed",
            "is_active": True, "must_change_password": False, "auth_source": "oidc",
            "last_login_at": None, "roles": ["reader"], "role_assignments": [{"role_code": "reader", "source": "oidc"}],
        }
        def directory(*args, **kwargs):
            return {"rows": [{"key": "observed@example.test", "email": "observed@example.test", "display_name": "Observed", "identities": [dict(identity)]}], "total": 1, "limit": 50, "offset": 0}
        with patch("app.cross.services.user_management.list_people", new=AsyncMock(side_effect=directory)), \
             patch("app.cross.repositories.oidc_groups.fetch_all", new=AsyncMock(return_value=[{
                 "actor_id": "okta-observed", "observed_groups": ["team-readers"], "groups_observed_at": "2026-10-11T12:00:00Z",
             }])) as observations:
            self.session.set_permissions(["access:directory_read"])
            hidden = await self.client.get("/api/auth/people")
            self.assertEqual(hidden.status_code, 200)
            self.assertIsNone(hidden.json()["rows"][0]["identities"][0].get("observed_groups"))
            observations.assert_not_awaited()
            self.session.set_permissions(["access:directory_read", "access:oidc_mappings_read"])
            visible = await self.client.get("/api/auth/people")
        self.assertEqual(visible.status_code, 200)
        observed = visible.json()["rows"][0]["identities"][0]
        self.assertEqual(observed.get("observed_groups"), ["team-readers"])
        self.assertEqual(observed.get("groups_observed_at"), "2026-10-11T12:00:00Z")

    async def test_observed_oidc_members_require_directory_and_mapping_permissions(self):
        payload = {"rows": [], "source": "environment", "observed_identities": 0, "unobserved_identities": 0}
        with patch("app.cross.api.routes.users.list_observed_oidc_groups", new=AsyncMock(return_value=payload)) as service:
            for permissions in ([], ["access:directory_read"], ["access:oidc_mappings_read"]):
                self.session.set_permissions(permissions)
                response = await self.client.get("/api/auth/oidc-groups")
                self.assertEqual(response.status_code, 403)
            service.assert_not_awaited()
            for permissions in (["access:directory_read", "access:oidc_mappings_read"], ["access:manage"]):
                self.session.set_permissions(permissions)
                response = await self.client.get("/api/auth/oidc-groups")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), payload)
            self.session.set_permissions(["inventory:read"])
            response = await self.client.get("/api/auth/oidc-groups")
            self.assertEqual(response.status_code, 403)

    async def test_identity_role_member_matches_requires_identity_catalog_permission(self):
        self.session.set_permissions(['inventory:read'])
        denied = await self.client.get('/api/cmdb/identity-roles/member-matches')
        self.assertEqual(denied.status_code, 403)
        # Baseline read plus the narrow catalog permission, the same contract
        # as PAM (pam:catalogs_read) and SIA (sia:catalogs_read).
        self.session.set_permissions(['inventory:read', 'identity:catalogs_read'])
        with patch('app.cyberark.identity_administration.api.routes.cmdb_identity.get_identity_role_review_data', new=AsyncMock(return_value=([], [], {'status': 'completed', 'completed_at': None}))), \
             patch('app.cyberark.identity_administration.api.routes.cmdb_identity.review_role_memberships_detailed', return_value={
                 'same_direct_members': [], 'same_user_references': [], 'roles_with_incomplete_user_paths': [], 'permissions_status': 'not_collected',
                 'roles_excluded_count': 0,
             }):
            granted = await self.client.get('/api/cmdb/identity-roles/member-matches')
        self.assertEqual(granted.status_code, 200)
        self.assertEqual(granted.json()['permissions_status'], 'not_collected')

    async def test_user_admin_create_requires_access_manage(self):
        payload = {"email": "new-user@example.test", "display_name": "Nuevo", "role_code": "reader"}
        self.session.set_permissions(["inventory:read"])
        denied = await self.client.post("/api/auth/users", json=payload)
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["access:manage"])
        # create_user returns (user_id, temporary_password); the mock used to
        # return a dict, which only unpacked by accident.
        with patch("app.cross.services.user_management.role_exists", new=AsyncMock(return_value=True)), \
             patch("app.cross.services.user_management.create_user", new=AsyncMock(return_value=("new", "TempPassw0rd!"))):
            granted = await self.client.post("/api/auth/users", json=payload)
        self.assertEqual(granted.status_code, 201)

    async def test_oidc_health_accepts_the_narrow_oidc_mapping_permission(self):
        """ACCESS-OIDC-HEALTH-001: the diagnostic is a read-only admin
        surface, so access:oidc_mappings_read alone must unlock it and
        inventory:read alone must not."""
        payload = {
            "mode": "local", "enabled": False, "configured": False, "issuer": None,
            "scopes": "openid profile email", "redirect_uri_configured": False,
            "group_claim": None, "group_claim_effective": "groups", "default_role": None,
            "default_role_status": None, "default_role_display_name": None, "role_map_source": "environment", "role_map": [],
            "last_oidc_login_at": None, "oidc_identity_count": 0, "warnings": [],
        }
        self.session.set_permissions(["inventory:read"])
        denied = await self.client.get("/api/access/oidc-health")
        self.assertEqual(denied.status_code, 403)

        with patch("app.cross.api.routes.access_control.collect_oidc_health", new=AsyncMock(return_value=payload)):
            self.session.set_permissions(["access:oidc_mappings_read"])
            granted = await self.client.get("/api/access/oidc-health")
            self.session.set_permissions(["access:manage"])
            superpermission = await self.client.get("/api/access/oidc-health")
        self.assertEqual(granted.status_code, 200)
        self.assertEqual(granted.json()["mode"], "local")
        self.assertEqual(superpermission.status_code, 200)

    async def test_narrow_admin_read_permissions_are_independent(self):
        self.session.set_permissions(["access:directory_read"])
        with patch("app.cross.services.user_management.list_users", new=AsyncMock(
                return_value={"rows": [], "total": 0, "limit": 50, "offset": 0})):
            directory = await self.client.get("/api/auth/users")
        self.assertEqual(directory.status_code, 200)
        self.assertEqual((await self.client.get("/api/access/permissions")).status_code, 403)

        self.session.set_permissions(["access:roles_read"])
        with patch("app.cross.services.access_management.list_permissions", new=AsyncMock(return_value=[])):
            roles = await self.client.get("/api/access/permissions")
        self.assertEqual(roles.status_code, 200)
        self.assertEqual((await self.client.get("/api/activity")).status_code, 403)

        self.session.set_permissions(["access:roles_manage"])
        with patch("app.cross.services.access_management.list_permissions", new=AsyncMock(return_value=[])):
            role_manager_catalog = await self.client.get("/api/access/permissions")
        self.assertEqual(role_manager_catalog.status_code, 200)

        self.session.set_permissions(["access:local_users_manage"])
        with patch("app.cross.services.user_management.list_users", new=AsyncMock(
                return_value={"rows": [], "total": 0, "limit": 50, "offset": 0})):
            local_manager_directory = await self.client.get("/api/auth/users")
        self.assertEqual(local_manager_directory.status_code, 200)

        self.session.set_permissions(["audit:read"])
        with patch("app.cross.api.routes.activity.list_activity", new=AsyncMock(
                return_value={"rows": [], "total": 0, "limit": 50, "offset": 0})):
            audit = await self.client.get("/api/activity")
        self.assertEqual(audit.status_code, 200)
        self.assertEqual((await self.client.get("/api/security-events")).status_code, 403)

        self.session.set_permissions(["security:events_read"])
        with patch("app.cross.repositories.security_events.fetch_all", new=AsyncMock(return_value=[])):
            events = await self.client.get("/api/security-events")
        self.assertEqual(events.status_code, 200)

    async def test_role_chips_need_role_assignment_and_never_change_own_or_okta_roles(self):
        """ACCESS-UI-001: add/remove one DS Hub role per identity."""
        self.session.set_permissions(["access:directory_read", "access:local_users_manage"])
        denied = await self.client.post("/api/auth/users/okta-1/roles", json={"role_code": "reader"})
        self.assertEqual(denied.status_code, 403)
        self.assertEqual((await self.client.delete("/api/auth/users/okta-1/roles/reader")).status_code, 403)

        self.session.set_permissions(["access:role_assignments_manage"])
        own = await self.client.post(f"/api/auth/users/{self.session.actor_id}/roles", json={"role_code": "reader"})
        self.assertEqual(own.status_code, 409)
        with patch("app.cross.services.user_management.role_exists", new=AsyncMock(return_value=True)), \
             patch("app.cross.services.user_management.grant_user_role", new=AsyncMock(return_value=True)) as grant:
            granted = await self.client.post("/api/auth/users/okta-1/roles", json={"role_code": "reader"})
        self.assertEqual(granted.status_code, 201)
        grant.assert_awaited_once()
        self.assertEqual(grant.await_args.args[1:], ("okta-1", "reader", self.session.actor_id))

        from app.cross.repositories.user_admin import OidcManagedRoleError
        with patch("app.cross.services.user_management.revoke_user_role", new=AsyncMock(side_effect=OidcManagedRoleError("Este rol viene de un grupo de Okta; se quita en Okta"))):
            okta_role = await self.client.delete("/api/auth/users/okta-1/roles/reader")
        self.assertEqual(okta_role.status_code, 409)
        self.assertIn("Okta", okta_role.json()["detail"])
        with patch("app.cross.services.user_management.revoke_user_role", new=AsyncMock(return_value=True)):
            revoked = await self.client.delete("/api/auth/users/okta-1/roles/reader")
        self.assertEqual(revoked.json(), {"revoked": True, "actor_id": "okta-1", "role_code": "reader"})

    async def test_okta_group_roles_need_assignment_and_mapping_read(self):
        """ACCESS-UI-001 phase 2: editing a group's roles is a role assignment that also reads the mapping."""
        body = {"group": "sg_ds-hub_lectores", "role_codes": ["reader", "sia_reader"]}
        for permissions in (["access:oidc_mappings_read"], ["access:role_assignments_manage"]):
            self.session.set_permissions(permissions)
            self.assertEqual((await self.client.put("/api/access/oidc-group-roles", json=body)).status_code, 403)

        self.session.set_permissions(["access:role_assignments_manage", "access:oidc_mappings_read"])
        with patch("app.cross.api.routes.access_control.change_oidc_group_roles", new=AsyncMock(return_value=["reader", "sia_reader"])) as change:
            granted = await self.client.put("/api/access/oidc-group-roles", json=body)
        self.assertEqual(granted.json(), {"group": "sg_ds-hub_lectores", "role_codes": ["reader", "sia_reader"]})
        self.assertEqual(change.await_args.args[1:], ("sg_ds-hub_lectores", ["reader", "sia_reader"], self.session.actor_id))

        from app.cross.repositories.access_delegation import DelegationCeilingError
        with patch("app.cross.api.routes.access_control.change_oidc_group_roles", new=AsyncMock(side_effect=DelegationCeilingError("No podés asignar el rol admin"))):
            over = await self.client.put("/api/access/oidc-group-roles", json={"group": "g", "role_codes": ["admin"]})
        self.assertEqual(over.status_code, 403)

    async def test_create_user_requires_both_narrow_write_permissions(self):
        payload = {"email": "delegated-user@example.test", "display_name": "Delegated", "role_code": "reader"}
        self.session.set_permissions(["access:local_users_manage"])
        missing_assignment = await self.client.post("/api/auth/users", json=payload)
        self.assertEqual(missing_assignment.status_code, 403)

        self.session.set_permissions(["access:local_users_manage", "access:role_assignments_manage"])
        with patch("app.cross.services.user_management.role_exists", new=AsyncMock(return_value=True)), \
             patch("app.cross.services.user_management.create_user", new=AsyncMock(return_value=("delegated", "Temporary-Passphrase-123"))):
            granted = await self.client.post("/api/auth/users", json=payload)
        self.assertEqual(granted.status_code, 201)

    async def test_user_update_applies_field_specific_narrow_permissions(self):
        self.session.set_permissions(["access:role_assignments_manage"])
        with patch("app.cross.services.user_management.role_exists", new=AsyncMock(return_value=True)), \
             patch("app.cross.services.user_management.update_user", new=AsyncMock(return_value=True)):
            role_update = await self.client.patch("/api/auth/users/actor-2", json={"role_code": "reader"})
        self.assertEqual(role_update.status_code, 200)
        denied_profile = await self.client.patch("/api/auth/users/actor-2", json={"display_name": "Nuevo"})
        self.assertEqual(denied_profile.status_code, 403)

        self.session.set_permissions(["access:local_users_manage"])
        with patch("app.cross.services.user_management.update_user", new=AsyncMock(return_value=True)):
            profile_update = await self.client.patch("/api/auth/users/actor-2", json={"display_name": "Nuevo"})
        self.assertEqual(profile_update.status_code, 200)
        denied_role = await self.client.patch("/api/auth/users/actor-2", json={"role_code": "reader"})
        self.assertEqual(denied_role.status_code, 403)

    async def test_narrow_role_and_permission_writes_are_independent(self):
        self.session.set_permissions(["access:roles_manage"])
        with patch("app.cross.services.access_management.create_role", new=AsyncMock(return_value="delegated_role")):
            role = await self.client.post("/api/access/roles", json={
                "role_code": "delegated_role",
                "display_name": "Delegated role",
                "description": "Rol delegado",
                "domain_code": "platform",
                "permission_codes": [],
            })
        self.assertEqual(role.status_code, 201)
        denied_permission = await self.client.post("/api/access/permissions", json={
            "permission_code": "custom:read",
            "domain_code": "platform",
            "resource_code": "custom",
            "action_code": "read",
            "description": "Permiso custom",
        })
        self.assertEqual(denied_permission.status_code, 403)

        self.session.set_permissions(["access:permissions_manage"])
        with patch("app.cross.services.access_management.create_permission", new=AsyncMock(return_value="custom:read")):
            permission = await self.client.post("/api/access/permissions", json={
                "permission_code": "custom:read",
                "domain_code": "platform",
                "resource_code": "custom",
                "action_code": "read",
                "description": "Permiso custom",
            })
        self.assertEqual(permission.status_code, 201)

    async def test_dashboard_template_publish_requires_role_management(self):
        payload = {"widgets": [{"id": "users_total", "size": "sm", "filters": {}}]}
        self.session.set_permissions(["netskope:read"])
        denied = await self.client.put("/api/dashboard/netskope/preferences/templates/netskope_reader", json=payload)
        self.assertEqual(denied.status_code, 403)
        self.session.set_permissions(["access:manage"])
        broad_admin_denied = await self.client.put("/api/dashboard/netskope/preferences/templates/netskope_reader", json=payload)
        self.assertEqual(broad_admin_denied.status_code, 403)

        self.session.set_permissions(["netskope:read", "access:roles_manage"])
        with patch("app.netskope.sse.api.routes.netskope_dashboard_preferences.publish_dashboard_template", new=AsyncMock(return_value={
            "role_code": "netskope_reader", "role_name": "Netskope Reader", "version": 2,
            "widgets": payload["widgets"], "published_at": "2026-09-30T12:00:00Z",
        })):
            granted = await self.client.put("/api/dashboard/netskope/preferences/templates/netskope_reader", json=payload)
        self.assertEqual(granted.status_code, 200)
        self.assertEqual(granted.json()["version"], 2)

    async def test_access_control_permission_catalog_requires_access_manage(self):
        self.session.set_permissions(["inventory:read"])
        denied = await self.client.get("/api/access/permissions")
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["access:manage"])
        with patch("app.cross.services.access_management.list_permissions", new=AsyncMock(return_value=[])):
            granted = await self.client.get("/api/access/permissions")
        self.assertEqual(granted.status_code, 200)

    async def test_safe_metadata_update_requires_safes_manage(self):
        payload = {"classification_status": "assigned"}
        self.session.set_permissions(["inventory:read"])
        denied = await self.client.patch("/api/safes/123/metadata", json=payload)
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["inventory:read", "safes:classify"])  # legacy code: no route enforces it any more
        legacy = await self.client.patch("/api/safes/123/metadata", json=payload)
        self.assertEqual(legacy.status_code, 403)

        self.session.set_permissions(["inventory:read", "safes:manage"])
        with patch("app.cyberark.pam.services.safe_classification.update_safe_metadata", new=AsyncMock(return_value={"safe_number": 123})):
            granted = await self.client.patch("/api/safes/123/metadata", json=payload)
        self.assertEqual(granted.status_code, 200)

    async def test_safe_bulk_assignment_requires_safes_manage(self):
        payload = {"safe_numbers": [1, 2, 3], "workflow_status": "in_progress"}
        self.session.set_permissions(["inventory:read", "safes:classify", "safes:bulk_classify"])  # legacy codes are not enough
        denied = await self.client.post("/api/safes/bulk-assignment", json=payload)
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["inventory:read", "safes:manage"])
        with patch(
            "app.cyberark.pam.services.safe_classification.bulk_update_safe_assignment",
            new=AsyncMock(return_value={"updated": 3, "updated_safe_numbers": [1, 2, 3], "missing_safe_numbers": []}),
        ):
            granted = await self.client.post("/api/safes/bulk-assignment", json=payload)
        self.assertEqual(granted.status_code, 200)

    async def test_cyberark_risk_requires_its_narrow_read_permission(self):
        self.session.set_permissions(["inventory:read", "access:manage"])
        denied = await self.client.get("/api/cyberark-risk/overview")
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["pam:risk_read"])
        public_overview = {
            "source": "cyberark_risk_management",
            "fetched_at": "2026-10-01T12:00:00+00:00",
            "summary": {"total_findings_by_severity": {}, "entity_types": []},
            "risk_types": [], "remediations": [],
            "progress": {"total_onboarded_current": 0, "total_onboarded_through_discovery_current": 0, "points": []},
            "recommendations_status": "catalog_options_only",
        }
        with patch("app.cyberark.risk_management.api.routes.cyberark_risk.RiskManagementSettings.from_environment"), \
             patch("app.cyberark.risk_management.api.routes.cyberark_risk.RiskManagementClient"), \
             patch("app.cyberark.risk_management.api.routes.cyberark_risk.get_public_overview", new=AsyncMock(return_value=public_overview)), \
             patch("app.cyberark.risk_management.api.routes.cyberark_risk.record_audit", new=AsyncMock()) as audit:
            granted = await self.client.get("/api/cyberark-risk/overview")
        self.assertEqual(granted.status_code, 200)
        self.assertEqual(granted.json()["source"], "cyberark_risk_management")
        audit.assert_awaited_once()

    async def test_cyberark_risk_findings_name_permission_is_additive_and_audited_as_boolean(self):
        self.session.set_permissions(["pam:risk_read"])
        remote_findings = [{
            "findingId": "finding-1",
            "riskTypeId": "risk-1",
            "entityId": "opaque-entity-1",
            "entityType": "identity",
            "entityDisplayName": "Visible only with the narrow permission",
            "severity": "high",
            "status": "open",
            "createdAt": "2026-09-01T00:00:00Z",
            "updatedAt": "2026-10-01T00:00:00Z",
        }]
        risk_client = AsyncMock()
        risk_client.__aenter__.return_value = risk_client
        risk_client.get_findings_page.return_value = {"findings": remote_findings, "isLastPage": True}
        entity_permission = AsyncMock(return_value=[])

        with patch("app.cyberark.risk_management.api.routes.cyberark_risk.RiskManagementSettings.from_environment"), \
             patch("app.cyberark.risk_management.api.routes.cyberark_risk.RiskManagementClient", return_value=risk_client), \
             patch("app.cyberark.risk_management.api.routes.cyberark_risk.get_actor_permissions", new=entity_permission), \
             patch("app.cyberark.risk_management.api.routes.cyberark_risk.record_audit", new=AsyncMock()) as audit:
            without_entity_permission = await self.client.get("/api/cyberark-risk/findings")
            entity_permission.return_value = ["pam:risk_entities_read"]
            with_entity_permission = await self.client.get("/api/cyberark-risk/findings")

            self.session.set_permissions([])
            without_risk_read = await self.client.get("/api/cyberark-risk/findings")

        self.assertEqual(without_entity_permission.status_code, 200)
        self.assertIsNone(without_entity_permission.json()["rows"][0]["entity_name"])
        self.assertFalse(without_entity_permission.json()["entity_names_visible"])
        self.assertEqual(with_entity_permission.status_code, 200)
        self.assertEqual(
            with_entity_permission.json()["rows"][0]["entity_name"],
            "Visible only with the narrow permission",
        )
        self.assertTrue(with_entity_permission.json()["entity_names_visible"])
        self.assertEqual(without_risk_read.status_code, 403)
        self.assertEqual(audit.await_count, 2)
        self.assertEqual(audit.await_args_list[0].kwargs["after_data"]["entity_names"], False)
        self.assertEqual(audit.await_args_list[1].kwargs["after_data"]["entity_names"], True)
        self.assertNotIn("Visible only with the narrow permission", str(audit.await_args_list))

    async def test_cyberark_risk_grouped_findings_keep_the_page_allowlist_and_bound(self):
        from app.cyberark.risk_management.integrations.risk_management import RiskManagementLimitError

        self.session.set_permissions(["pam:risk_read"])
        risk_client = AsyncMock()
        risk_client.__aenter__.return_value = risk_client
        risk_client.get_all_findings.return_value = [{
            "findingId": "finding-1", "riskTypeId": "risk-1", "entityId": "opaque-entity-1",
            "entityType": "identity", "entityDisplayName": "Hidden without the narrow permission",
            "severity": "high", "status": "open", "unexpected": "dropped",
        }]

        with patch("app.cyberark.risk_management.api.routes.cyberark_risk.RiskManagementSettings.from_environment"), \
             patch("app.cyberark.risk_management.api.routes.cyberark_risk.RiskManagementClient", return_value=risk_client), \
             patch("app.cyberark.risk_management.api.routes.cyberark_risk.get_actor_permissions", new=AsyncMock(return_value=[])), \
             patch("app.cyberark.risk_management.api.routes.cyberark_risk.record_audit", new=AsyncMock()) as audit:
            granted = await self.client.get("/api/cyberark-risk/findings/all")
            risk_client.get_all_findings.side_effect = RiskManagementLimitError("too many")
            over_bound = await self.client.get("/api/cyberark-risk/findings/all")
            self.session.set_permissions([])
            denied = await self.client.get("/api/cyberark-risk/findings/all")

        self.assertEqual(granted.status_code, 200)
        body = granted.json()
        self.assertTrue(body["complete"])
        self.assertIsNone(body["rows"][0]["entity_name"])
        self.assertNotIn("unexpected", body["rows"][0])
        self.assertEqual(over_bound.status_code, 422)
        self.assertEqual(denied.status_code, 403)
        audit.assert_awaited_once()
        self.assertEqual(audit.await_args.kwargs["entity_id"], "live:all")
        self.assertEqual(audit.await_args.kwargs["after_data"], {"count": 1, "complete": True, "entity_names": False})

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
        # The typed PamUsersResponse contract (AUD-API-002) requires the full
        # page shape; this test only exercises the permission gate.
        with patch("app.cyberark.pam.api.routes.cmdb_pam.list_pam_users", new=AsyncMock(
                return_value={"rows": [], "total": 0, "limit": 50, "offset": 0,
                              "search": "", "standard_seat": "", "status": ""})):
            granted = await self.client.get("/api/cmdb/pam-users")
        self.assertEqual(granted.status_code, 200)

    async def test_pam_cleanup_signals_requires_a_pam_catalog_read_permission(self):
        path = "/api/cmdb/pam-cleanup-signals"
        self.session.set_permissions(["inventory:read"])
        denied = await self.client.get(path)
        self.assertEqual(denied.status_code, 403)

        signal = {
            "count": 0, "denominator": 0, "items": [],
            "computed_at": "2026-10-01T12:00:00Z",
            "inventory_runs": [{"family": "pam_inventory", "latest_attempt": {
                "run_id": "cleanup-run", "source_system": "cyberark", "source_file": "cyberark-api",
                "status": "failed", "enqueued_at": "2026-10-01T10:00:00Z",
                "started_at": "2026-10-01T10:01:00Z", "completed_at": "2026-10-01T10:02:00Z",
                "inventory_refreshed": False, "error_details": ["private"], "run_options": {"private": True},
                "triggered_by": "private",
            }, "last_completed_inventory": None}],
        }
        payload = {
            "empty_groups": signal,
            "identical_member_groups": signal,
            "redundant_groups_with_access_peer": signal,
            "orphan_psm": signal,
            "platforms_without_accounts": signal,
            "safes_without_active_users": signal,
        }
        with patch("app.cyberark.pam.api.routes.cmdb_pam.get_pam_cleanup_signals", new=AsyncMock(return_value=payload)) as query:
            self.session.set_permissions(["inventory:read", "pam:catalogs_read"])
            granted = await self.client.get(path)
            self.session.set_permissions(["inventory:read", "access:manage"])
            admin_granted = await self.client.get(path)

        self.assertEqual(granted.status_code, 200)
        self.assertEqual(admin_granted.status_code, 200)
        run = granted.json()["empty_groups"]["inventory_runs"][0]["latest_attempt"]
        self.assertEqual(set(run), {"run_id", "source_system", "source_file", "status", "enqueued_at",
                                    "started_at", "completed_at", "inventory_refreshed"})
        self.assertEqual(query.await_count, 2)

    async def test_cmdb_sia_connectors_requires_sia_catalog_permission(self):
        self.session.set_permissions(["inventory:read", "pam:catalogs_read"])
        denied = await self.client.get("/api/cmdb/sia-connectors")
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["inventory:read", "sia:catalogs_read"])
        # The typed SiaConnectorsResponse contract (AUD-API-002) requires the
        # full page shape; this test only exercises the permission gate.
        with patch("app.cyberark.sia.api.routes.cmdb_sia.list_sia_connectors", new=AsyncMock(
                return_value={"rows": [], "total": 0, "limit": 50, "offset": 0, "search": ""})):
            granted = await self.client.get("/api/cmdb/sia-connectors")
        self.assertEqual(granted.status_code, 200)

    async def test_security_events_requires_access_manage(self):
        """PENTEST-008: the new persisted security-events log is gated
        exactly like /api/activity -- access:manage only."""
        self.session.set_permissions(["inventory:read"])
        denied = await self.client.get("/api/security-events")
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["inventory:read", "access:manage"])
        with patch("app.cross.repositories.security_events.fetch_all", new=AsyncMock(return_value=[])):
            granted = await self.client.get("/api/security-events")
        self.assertEqual(granted.status_code, 200)
        self.assertEqual(granted.json(), {"rows": [], "total": 0, "limit": 50, "offset": 0})

    async def test_operational_errors_require_access_manage(self):
        self.session.set_permissions(["inventory:read"])
        denied = await self.client.get("/api/operational-errors")
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["inventory:read", "access:manage"])
        with patch("app.cross.api.routes.operational_errors.list_operational_errors", new=AsyncMock(return_value={"rows": [], "total": 0, "limit": 50, "offset": 0})):
            granted = await self.client.get("/api/operational-errors")
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

    async def test_remaining_safe_write_mutations_require_safes_manage(self):
        """Same follow-up as above, for every remaining safes:manage-gated
        route in safe_write.py (account classification, assignment, scope,
        account-type, quick-update -- bulk-assignment and metadata are
        already covered above)."""
        self.session.set_permissions(["inventory:read"])  # authenticated + base read, but no safes:manage
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
                self.assertEqual(response.status_code, 403, f"{method.upper()} {path} did not 403 without safes:manage (got {response.status_code}: {response.text})")

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
        with patch("app.cyberark.pam.services.safe_classification.list_safe_audit", new=AsyncMock(return_value=[])):
            audit_granted = await self.client.get("/api/safes/123/audit")
        self.assertEqual(audit_granted.status_code, 200)

        with patch("app.cyberark.pam.services.safe_classification.get_retired_candidates", new=AsyncMock(return_value=[])), \
             patch("app.cyberark.pam.services.safe_classification.count_retired_candidates", new=AsyncMock(return_value=0)):
            retired_granted = await self.client.get("/api/lifecycle/retired")
        self.assertEqual(retired_granted.status_code, 200)

    async def test_account_management_analytics_requires_inventory_read(self):
        self.session.set_permissions([])
        denied = await self.client.get('/api/analytics/account-management')
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(['inventory:read'])
        payload = {
            'accounts_active': 0, 'automatic_enabled': 0, 'automatic_disabled': 0,
            'management_unknown': 0, 'status_success': 0, 'status_failure': 0,
            'status_in_process': 0, 'status_unknown': 0, 'changed_30d': 0,
            'changed_90d': 0, 'changed_365d': 0, 'changed_older': 0,
            'changed_unknown': 0,
        }
        with patch('app.cyberark.pam.api.routes.analytics.get_account_management_summary', new=AsyncMock(return_value=[payload])) as summary:
            granted = await self.client.get('/api/analytics/account-management?include_internal=false')
        self.assertEqual(granted.status_code, 200)
        self.assertEqual(granted.json(), payload)
        self.assertEqual(summary.await_args.args[1], False)


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
        with patch("app.cross.api.routes.auth_session.change_own_password", new=AsyncMock(return_value=_AuthenticatedSession.SESSION_VERSION)):
            response = await self.client.post(
                "/api/auth/password",
                json={"current_password": "Sample123!", "new_password": "NewPassw0rd!"},
            )
        self.assertEqual(response.status_code, 200)

    async def test_status_and_logout_remain_reachable(self):
        with patch(
            "app.cross.services.session_view.get_local_account_status",
            new=AsyncMock(return_value={"must_change_password": True, "roles": ["reader"], "role_names": ["Lector"]}),
        ), patch("app.cross.api.routes.auth_session.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"])):
            status_response = await self.client.get("/api/auth/status")
        self.assertEqual(status_response.status_code, 200)
        self.assertTrue(status_response.json()["user"]["must_change_password"])

        logout_response = await self.client.post("/api/auth/logout")
        self.assertEqual(logout_response.status_code, 200)

    async def test_block_is_lifted_once_the_password_is_changed(self):
        with patch("app.cross.api.routes.auth_session.change_own_password", new=AsyncMock(return_value=_AuthenticatedSession.SESSION_VERSION)):
            change_response = await self.client.post(
                "/api/auth/password",
                json={"current_password": "Sample123!", "new_password": "NewPassw0rd!"},
            )
        self.assertEqual(change_response.status_code, 200)

        with patch("app.cross.services.user_management.list_users", new=AsyncMock(
                return_value={"rows": [], "total": 0, "limit": 50, "offset": 0})):
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
        # The typed SummaryResponse contract (AUD-API-002) requires the full
        # shape; this test only exercises session revocation.
        with patch("app.cyberark.pam.api.routes.analytics.get_summary", new=AsyncMock(return_value={
            "safes": 1, "business_safes": 0, "internal_safes": 0, "scope_pending_safes": 0,
            "scope_candidate_safes": 0, "clean_business_safes": 0, "obsolete_safes": 0,
            "duplicate_safes": 0, "accounts": 0, "pending_classification": 0, "assigned": 0,
            "review": 0,
            "safe_health": {"denominator": 0, "missing_cpm": 0, "no_accounts": 0,
                            "olac_disabled": 0, "retention_unconfigured": 0,
                            "manage_safe_concentration": 0},
            "latest_run": None,
        })):
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
    matches the runtime contract. GET routes may use a browser session or the
    newer personal read-only Bearer token, but never X-Access-Token;
    POST/PATCH/DELETE retain their separate session/X-Access-Token contract.

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
            "/api/access/oidc-health",
            "/api/cmdb/netskope/investigations",
            "/api/cmdb/netskope/incidents/summary",
            "/api/cmdb/netskope/users/alerts/summary",
            "/api/cmdb/netskope/dlp/status",
            "/api/cmdb/netskope/dlp/policies",
            "/api/cmdb/pam-platforms",
            "/api/cmdb/sia-connectors",
            "/api/accounts/export.csv",
            "/api/analytics/account-management",
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
            "ingestion:run", "catalogs:manage", "safes:manage",
        ]
        with patch(
            "app.cross.services.sync_control.enqueue_sync_run",
            new=AsyncMock(return_value={"run_id": "11111111-1111-1111-1111-111111111111", "status": "queued"}),
        ), patch.object(app.state, "sync_coordinator", type("_Coordinator", (), {"wake": lambda self: None})(), create=True):
            response = await self.client.post("/api/ingestion/runs", json={}, headers=self._headers())
        self.assertEqual(response.status_code, 202, response.text)

        with patch(
            "app.cyberark.pam.services.catalog_admin.create_business_unit",
            new=AsyncMock(return_value={"id": 1, "unit_code": "IT", "unit_name": "IT"}),
        ):
            response = await self.client.post(
                "/api/business-units", json={"unit_code": "IT", "unit_name": "IT"}, headers=self._headers(),
            )
        self.assertEqual(response.status_code, 201, response.text)

        with patch("app.cyberark.pam.services.safe_classification.update_safe_quick", new=AsyncMock(return_value={"safe_number": 123})):
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
        for path in ("/api/ingestion/runs", "/api/ingestion/schedule", "/api/ingestion/schedules", "/api/catalogs", "/api/safes", "/api/findings", "/api/connection-inventory"):
            with self.subTest(path=path):
                response = await self.client.get(path, headers=self._headers())
                self.assertEqual(response.status_code, 401, f"GET {path} with only a technical token did not 401 (got {response.status_code}: {response.text})")

    async def test_sync_schedule_edit_requires_access_manage_and_sync_now_requires_ingestion_run(self):
        self._permissions_mock.return_value = ["ingestion:run"]
        denied_edit = await self.client.put(
            "/api/ingestion/schedules/netskope_inventory", json={"interval_minutes": 30}, headers=self._headers(),
        )
        self.assertEqual(denied_edit.status_code, 403)

        self._permissions_mock.return_value = ["access:manage"]
        with patch("app.cross.api.routes.ingestion.set_sync_schedule_override", new=AsyncMock()) as save, \
             patch.object(app.state, "sync_coordinator", type("_Coordinator", (), {"wake": lambda self: None})(), create=True):
            allowed_edit = await self.client.put(
                "/api/ingestion/schedules/netskope_inventory", json={"interval_minutes": 30}, headers=self._headers(),
            )
        self.assertEqual(allowed_edit.status_code, 200, allowed_edit.text)
        save.assert_awaited_once()

        self._permissions_mock.return_value = ["access:manage"]
        denied_run = await self.client.post("/api/ingestion/schedules/netskope_inventory/runs", headers=self._headers())
        self.assertEqual(denied_run.status_code, 403)

        self._permissions_mock.return_value = ["ingestion:run"]
        with patch("app.cross.api.routes.ingestion.enqueue_sync_runs", new=AsyncMock(return_value=[])), \
             patch.object(app.state, "sync_coordinator", type("_Coordinator", (), {"wake": lambda self: None})(), create=True):
            # The request passes authorization; an active task is reported as a conflict.
            allowed_run = await self.client.post("/api/ingestion/schedules/netskope_inventory/runs", headers=self._headers())
        self.assertEqual(allowed_run.status_code, 409)


if __name__ == "__main__":
    unittest.main()
