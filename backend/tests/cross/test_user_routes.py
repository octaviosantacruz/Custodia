import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, PropertyMock, patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.cross.api.routes.users import UserCreate, UserUpdate, create_user_route, reissue_temp_password_route, update_user_route
from app.cross.repositories.access_delegation import DelegationCeilingError
from app.cross.repositories.user_admin import InvalidUserPassword


class UserRouteContractTests(unittest.TestCase):
    def setUp(self):
        # Direct route invocation bypasses FastAPI's permission dependency;
        # model the authorized actor state that dependency establishes.
        self.request = SimpleNamespace(state=SimpleNamespace(actor_permissions=frozenset({'access:manage'})), app=SimpleNamespace())
        self.request.app.state = SimpleNamespace(db=object())

    def test_invalid_password_on_update_keeps_422(self):
        payload = UserUpdate(password='bad')
        with patch('app.cross.services.user_management.update_user', new=AsyncMock(side_effect=InvalidUserPassword('password policy'))):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(update_user_route('target@example.com', payload, self.request, 'admin@example.com'))
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(error.exception.detail, 'password policy')

    def test_last_active_user_conflict_keeps_409(self):
        payload = UserUpdate(is_active=False)
        with patch('app.cross.services.user_management.update_user', new=AsyncMock(side_effect=ValueError('No se puede desactivar el único usuario activo'))):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(update_user_route('target@example.com', payload, self.request, 'admin@example.com'))
        self.assertEqual(error.exception.status_code, 409)

    def test_create_invalid_role_is_rejected_before_persistence(self):
        payload = UserCreate(email='new@example.com', display_name='New', role_code='owner')
        with patch('app.cross.services.user_management.role_exists', new=AsyncMock(return_value=False)), patch('app.cross.services.user_management.create_user', new=AsyncMock()) as create_mock:
            with self.assertRaises(HTTPException) as error:
                asyncio.run(create_user_route(payload, self.request, 'admin@example.com'))
        self.assertEqual(error.exception.status_code, 422)
        create_mock.assert_not_awaited()

    def test_create_user_over_ceiling_role_is_forbidden(self):
        payload = UserCreate(email='new@example.com', display_name='New', role_code='admin')
        with patch('app.cross.services.user_management.role_exists', new=AsyncMock(return_value=True)), patch(
            'app.cross.services.user_management.create_user',
            new=AsyncMock(side_effect=DelegationCeilingError('No podés asignar el rol admin: otorga permisos que no tenés (access:manage)')),
        ):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(create_user_route(payload, self.request, 'delegated@example.com'))
        self.assertEqual(error.exception.status_code, 403)
        self.assertIn('access:manage', error.exception.detail)

    def test_create_rejects_malformed_email(self):
        with self.assertRaises(ValidationError):
            UserCreate(email='not-an-email', display_name='New', role_code='reader')

    def test_create_rejects_whitespace_only_display_name(self):
        with self.assertRaises(ValidationError):
            UserCreate(email='new@example.com', display_name='   ', role_code='reader')

    def test_create_strips_display_name_and_email(self):
        payload = UserCreate(email='  new@example.com  ', display_name='  New User  ', role_code='reader')
        self.assertEqual(payload.email, 'new@example.com')
        self.assertEqual(payload.display_name, 'New User')

    def test_update_rejects_whitespace_only_display_name(self):
        with self.assertRaises(ValidationError):
            UserUpdate(display_name='   ')

    def test_update_rejects_a_payload_with_every_field_omitted(self):
        """IF-003: {} used to reach update_user() silently and report
        success without running any query. Rejected as a 422 at the
        schema layer, before any lookup."""
        with self.assertRaises(ValidationError):
            UserUpdate()
        with self.assertRaises(ValidationError):
            UserUpdate.model_validate({})

    def test_reissue_temp_password_returns_404_for_inactive_or_missing_user(self):
        with patch('app.cross.services.user_management.reissue_temporary_password', new=AsyncMock(return_value=None)):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(reissue_temp_password_route('target@example.com', self.request, 'admin@example.com'))
        self.assertEqual(error.exception.status_code, 404)

    def test_reissue_temp_password_returns_generated_password(self):
        with patch('app.cross.services.user_management.reissue_temporary_password', new=AsyncMock(return_value='Ab3!xyz9')):
            response = asyncio.run(reissue_temp_password_route('target@example.com', self.request, 'admin@example.com'))
        self.assertEqual(response, {'temporary_password': 'Ab3!xyz9'})

    def test_current_admin_can_switch_to_a_composite_role_that_keeps_access_management(self):
        payload = UserUpdate(role_code="security_lead")
        with patch("app.cross.services.user_management.role_grants_permission", new=AsyncMock(return_value=True)), patch(
            "app.cross.services.user_management.role_exists", new=AsyncMock(return_value=True)
        ), patch("app.cross.services.user_management.update_user", new=AsyncMock(return_value=True)) as update_mock:
            response = asyncio.run(update_user_route("admin@example.com", payload, self.request, "admin@example.com"))
        self.assertEqual(response, {"updated": True})
        update_mock.assert_awaited_once()

    def test_update_user_over_ceiling_role_is_forbidden(self):
        payload = UserUpdate(role_code="admin")
        with patch("app.cross.services.user_management.role_exists", new=AsyncMock(return_value=True)), patch(
            "app.cross.services.user_management.update_user",
            new=AsyncMock(side_effect=DelegationCeilingError("No podés asignar el rol admin: otorga permisos que no tenés (access:manage)")),
        ):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(update_user_route("target@example.com", payload, self.request, "delegated@example.com"))
        self.assertEqual(error.exception.status_code, 403)


class CreateUserDuplicateEmailTests(unittest.TestCase):
    """IF-021: duplicate-email detection now matches on the driver's actual
    SQLSTATE (23505, UniqueViolation) and this table's specific constraint
    names, not on whether the exception's string happens to contain
    "duplicate key" -- a driver upgrade, a different locale, or an
    unrelated future unique constraint on the same table used to be able
    to silently misclassify (or fall through to an opaque 500 the moment
    the message text ever changed)."""

    def setUp(self):
        self.request = SimpleNamespace(state=SimpleNamespace(actor_permissions=frozenset({'access:manage'})), app=SimpleNamespace())
        self.request.app.state = SimpleNamespace(db=object())
        self.payload = UserCreate(email="new@example.com", display_name="New", role_code="reader")

    def _unique_violation(self, constraint_name: str):
        from psycopg.errors import UniqueViolation

        exc = UniqueViolation("duplicate key value violates unique constraint")
        patcher = patch.object(type(exc), "diag", new_callable=PropertyMock, return_value=SimpleNamespace(constraint_name=constraint_name))
        patcher.start()
        self.addCleanup(patcher.stop)
        return exc

    def test_duplicate_primary_key_maps_to_409(self):
        with patch("app.cross.services.user_management.role_exists", new=AsyncMock(return_value=True)), \
             patch("app.cross.services.user_management.create_user", new=AsyncMock(side_effect=self._unique_violation("access_users_pkey"))):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(create_user_route(self.payload, self.request, "admin@example.com"))
        self.assertEqual(error.exception.status_code, 409)

    def test_duplicate_case_insensitive_email_index_maps_to_409(self):
        with patch("app.cross.services.user_management.role_exists", new=AsyncMock(return_value=True)), \
             patch("app.cross.services.user_management.create_user", new=AsyncMock(side_effect=self._unique_violation("uq_access_users_email_lower"))):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(create_user_route(self.payload, self.request, "admin@example.com"))
        self.assertEqual(error.exception.status_code, 409)

    def test_an_unrelated_unique_violation_is_not_misclassified_as_a_duplicate_email(self):
        with patch("app.cross.services.user_management.role_exists", new=AsyncMock(return_value=True)), \
             patch("app.cross.services.user_management.create_user", new=AsyncMock(side_effect=self._unique_violation("some_other_constraint"))):
            with self.assertRaises(Exception) as error:
                asyncio.run(create_user_route(self.payload, self.request, "admin@example.com"))
        self.assertNotIsInstance(error.exception, HTTPException)


if __name__ == '__main__':
    unittest.main()
