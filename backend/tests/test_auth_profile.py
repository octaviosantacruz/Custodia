import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.routes.auth_models import BootstrapRequest, PasswordChange, ProfileUpdate
from app.api.routes.auth_session import auth_logout, auth_status, change_password, oidc_login, update_profile
from app.auth import start_oidc_login
from app.repositories.user_admin import InvalidCurrentPassword, InvalidUserPassword


class AuthProfileRouteTests(unittest.TestCase):
    def setUp(self):
        self.db = object()
        self.request = SimpleNamespace(
            session={"user": {"actor_id": "reader-1", "name": "Old Name", "email": "reader@example.com"}},
            app=SimpleNamespace(state=SimpleNamespace(db=self.db)),
        )

    def test_profile_update_uses_authenticated_actor_and_refreshes_session_name(self):
        profile = {"actor_id": "reader-1", "display_name": "New Name", "email": "reader@example.com"}
        with patch("app.api.routes.auth_session.AUTH_MODE", "local"), patch(
            "app.api.routes.auth_session.update_own_profile",
            new=AsyncMock(return_value=profile),
        ) as update:
            response = asyncio.run(update_profile(ProfileUpdate(display_name="New Name"), self.request, "reader-1"))

        update.assert_awaited_once_with(self.db, "reader-1", "New Name")
        self.assertEqual(response["user"]["name"], "New Name")
        self.assertEqual(self.request.session["user"]["name"], "New Name")

    def test_logout_clears_session_with_api_success_response(self):
        with patch("app.api.routes.auth_session.AUTH_MODE", "local"), \
             patch("app.api.routes.auth_session.record_security_event_for_request", new=AsyncMock()) as security_event:
            response = asyncio.run(auth_logout(self.request))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.request.session, {})
        self.assertEqual(response.body, b'{"logged_out":true}')
        # PENTEST-008: logout is one of the persisted security events.
        self.assertEqual(security_event.await_args.kwargs["event_type"], "logout")
        self.assertEqual(security_event.await_args.kwargs["actor_id"], "reader-1")

    def test_hybrid_oidc_login_passes_email_as_login_hint(self):
        with patch("app.api.routes.auth_session.AUTH_MODE", "hybrid"), patch(
            "app.api.routes.auth_session.start_oidc_login",
            new=AsyncMock(return_value={"redirect": True}),
        ) as start_login:
            response = asyncio.run(oidc_login(self.request, "  user@example.com  "))

        self.assertEqual(response, {"redirect": True})
        start_login.assert_awaited_once_with(self.request, login_hint="  user@example.com  ")

    def test_oidc_status_includes_the_internal_role_for_the_profile_menu(self):
        self.request.session["user"] = {
            "actor_id": "oidc-user",
            "name": "Octavio",
            "email": "octavio@example.com",
            "auth_source": "oidc",
        }
        with patch("app.api.routes.auth_session.AUTH_MODE", "oidc"), patch(
            "app.api.routes.auth_session.LOCAL_AUTH_ENABLED", False,
        ), patch(
            "app.api.routes.auth_session.session_actor", return_value="oidc-user",
        ), patch(
            "app.api.routes.auth_session.count_local_users",
            new=AsyncMock(return_value=1),
        ), patch(
            "app.api.routes.auth_session.get_role_assignment_names",
            new=AsyncMock(return_value={"roles": ["security_lead"], "role_names": ["Responsable de seguridad"]}),
        ), patch(
            "app.api.routes.auth_session.get_actor_permissions",
            new=AsyncMock(return_value=["access:manage"]),
        ):
            response = asyncio.run(auth_status(self.request))

        self.assertEqual(response["user"]["roles"], ["security_lead"])
        self.assertEqual(response["user"]["role_names"], ["Responsable de seguridad"])
        self.assertEqual(response["permissions"], ["access:manage"])

    def test_hybrid_stays_available_for_local_login_when_oidc_is_not_configured(self):
        with patch("app.auth.OIDC_ENABLED", True), patch("app.auth.OIDC_CONFIGURED", False):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(start_oidc_login(self.request, login_hint="user@example.com"))

        self.assertEqual(error.exception.status_code, 503)

    def test_profile_update_rejects_whitespace_only_name_at_the_schema_level(self):
        with self.assertRaises(ValidationError):
            ProfileUpdate(display_name=" ")

    def test_bootstrap_rejects_malformed_email_and_blank_name(self):
        with self.assertRaises(ValidationError):
            BootstrapRequest(email="not-an-email", password="Abcdef1!", display_name="Admin")
        with self.assertRaises(ValidationError):
            BootstrapRequest(email="admin@example.com", password="Abcdef1!", display_name="   ")

    def test_bootstrap_strips_email_and_name(self):
        payload = BootstrapRequest(email="  admin@example.com  ", password="Abcdef1!", display_name="  Admin  ")
        self.assertEqual(payload.email, "admin@example.com")
        self.assertEqual(payload.display_name, "Admin")

    def test_profile_update_maps_service_value_errors_to_422(self):
        with patch("app.api.routes.auth_session.AUTH_MODE", "local"), patch(
            "app.api.routes.auth_session.update_own_profile",
            new=AsyncMock(side_effect=ValueError("El nombre es obligatorio")),
        ):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(update_profile(ProfileUpdate(display_name="Valid Name"), self.request, "reader-1"))

        self.assertEqual(error.exception.status_code, 422)

    def test_password_change_maps_wrong_current_password_without_updating_session_password(self):
        with patch("app.api.routes.auth_session.AUTH_MODE", "local"), patch(
            "app.api.routes.auth_session.change_own_password",
            new=AsyncMock(side_effect=InvalidCurrentPassword("La contraseña actual no es válida")),
        ):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(change_password(PasswordChange(current_password="wrong", new_password="Abcdef1!"), self.request, "reader-1"))

        self.assertEqual(error.exception.status_code, 401)
        self.assertNotIn("password", self.request.session["user"])

    def test_password_change_maps_policy_errors(self):
        with patch("app.api.routes.auth_session.AUTH_MODE", "local"), patch(
            "app.api.routes.auth_session.change_own_password",
            new=AsyncMock(side_effect=InvalidUserPassword("password policy")),
        ):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(change_password(PasswordChange(current_password="Abcdef1!", new_password="bad"), self.request, "reader-1"))

        self.assertEqual(error.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
