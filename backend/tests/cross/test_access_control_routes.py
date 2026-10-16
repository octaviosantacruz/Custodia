import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.cross.api.routes.access_control import (
    CompositeRolePayload,
    CompositeRoleUpdatePayload,
    PermissionPayload,
    RolePayload,
    RoleUpdatePayload,
    create_composite_role_route,
    create_permission_route,
    create_role_route,
    update_composite_role_route,
    update_role_route,
)
from app.cross.repositories.access_delegation import DelegationCeilingError


class AccessControlRouteTests(unittest.TestCase):
    def setUp(self):
        self.request = SimpleNamespace(state=SimpleNamespace(), app=SimpleNamespace())
        self.request.app.state = SimpleNamespace(db=object())

    def test_custom_role_requires_a_safe_internal_code(self):
        with self.assertRaises(ValueError):
            RolePayload(role_code='Data Reviewer', display_name='Data Reviewer', description='Review access', domain_code='platform')

    def test_custom_role_persists_the_permission_bundle(self):
        payload = RolePayload(role_code='data_reviewer', display_name='Data Reviewer', description='Revisa inventario', domain_code='pam', permission_codes=['inventory:read'])
        with patch('app.cross.services.access_management.create_role', new=AsyncMock(return_value='data_reviewer')) as create_mock:
            response = asyncio.run(create_role_route(payload, self.request, 'admin@example.com'))
        self.assertEqual(response, {'created': True, 'role_code': 'data_reviewer'})
        create_mock.assert_awaited_once()
        self.assertEqual(create_mock.await_args.kwargs['permission_codes'], ['inventory:read'])

    def test_unknown_permission_is_returned_as_validation_error(self):
        payload = RolePayload(role_code='bad_role', display_name='Bad role', description='Invalid', domain_code='platform')
        with patch('app.cross.services.access_management.create_role', new=AsyncMock(side_effect=ValueError('Permisos desconocidos: access:unknown'))):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(create_role_route(payload, self.request, 'admin@example.com'))
        self.assertEqual(error.exception.status_code, 422)

    def test_create_role_ceiling_violation_is_forbidden(self):
        payload = RolePayload(role_code='delegated_admin', display_name='Delegated admin', description='Intento de escalamiento', domain_code='platform', permission_codes=['access:manage'])
        with patch('app.cross.services.access_management.create_role', new=AsyncMock(side_effect=DelegationCeilingError('No podés otorgar permisos que no tenés: access:manage'))):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(create_role_route(payload, self.request, 'delegated@example.com'))
        self.assertEqual(error.exception.status_code, 403)
        self.assertIn('access:manage', error.exception.detail)

    def test_update_role_ceiling_violation_is_forbidden(self):
        payload = RoleUpdatePayload(display_name='Delegated admin', description='Intento de escalamiento', domain_code='platform', permission_codes=['access:manage'])
        with patch('app.cross.services.access_management.update_role', new=AsyncMock(side_effect=DelegationCeilingError('No podés otorgar permisos que no tenés: access:manage'))):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(update_role_route('delegated_admin', payload, self.request, 'delegated@example.com'))
        self.assertEqual(error.exception.status_code, 403)

    def test_create_composite_role_ceiling_violation_is_forbidden(self):
        payload = CompositeRolePayload(role_code='regional_admin', display_name='Regional admin', description='Intento de escalamiento', level_refs=[{'domain_code': 'platform', 'level_code': 'admin'}])
        with patch('app.cross.services.access_management.create_composite_role', new=AsyncMock(side_effect=DelegationCeilingError('No podés seleccionar el nivel admin en platform: supera tu nivel de delegación'))):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(create_composite_role_route(payload, self.request, 'delegated@example.com'))
        self.assertEqual(error.exception.status_code, 403)

    def test_update_composite_role_ceiling_violation_is_forbidden(self):
        payload = CompositeRoleUpdatePayload(display_name='Regional admin', description='Intento de escalamiento', level_refs=[{'domain_code': 'platform', 'level_code': 'admin'}])
        with patch('app.cross.services.access_management.update_composite_role', new=AsyncMock(side_effect=DelegationCeilingError('No podés seleccionar el nivel admin en platform: supera tu nivel de delegación'))):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(update_composite_role_route('regional_admin', payload, self.request, 'delegated@example.com'))
        self.assertEqual(error.exception.status_code, 403)

    def test_custom_permission_code_must_match_resource_and_action(self):
        payload = PermissionPayload(permission_code='safes:read', domain_code='pam', resource_code='safes', action_code='export', description='Exportar Safes')
        with self.assertRaises(HTTPException) as error:
            asyncio.run(create_permission_route(payload, self.request, 'admin@example.com'))
        self.assertEqual(error.exception.status_code, 422)

    def test_custom_permission_is_created_as_a_catalog_entry(self):
        payload = PermissionPayload(permission_code='safes:export', domain_code='pam', resource_code='safes', action_code='export', description='Exportar Safes')
        with patch('app.cross.services.access_management.create_permission', new=AsyncMock(return_value='safes:export')) as create_mock:
            response = asyncio.run(create_permission_route(payload, self.request, 'admin@example.com'))
        self.assertEqual(response, {'created': True, 'permission_code': 'safes:export'})
        create_mock.assert_awaited_once()

    def test_composite_role_persists_domain_level_references(self):
        payload = CompositeRolePayload(
            role_code="regional_security",
            display_name="Seguridad regional",
            description="Acceso combinado por producto",
            level_refs=[
                {"domain_code": "pam", "level_code": "admin"},
                {"domain_code": "dlp", "level_code": "reader"},
            ],
        )
        result = {"role_code": "regional_security", "duplicate_of": None}
        with patch("app.cross.services.access_management.create_composite_role", new=AsyncMock(return_value=result)) as create_mock:
            response = asyncio.run(create_composite_role_route(payload, self.request, "admin@example.com"))
        self.assertEqual(response["role_code"], "regional_security")
        self.assertTrue(response["created"])
        self.assertIsNone(response["warning"])
        self.assertEqual(create_mock.await_args.kwargs["level_refs"][1], {"domain_code": "dlp", "level_code": "reader"})

    def test_duplicate_composite_combination_warns_without_blocking(self):
        payload = CompositeRolePayload(
            role_code="regional_security_copy",
            display_name="Seguridad regional copia",
            description="Misma combinación permitida",
            level_refs=[{"domain_code": "pam", "level_code": "admin"}],
        )
        result = {"role_code": payload.role_code, "duplicate_of": {"role_code": "regional_security", "display_name": "Seguridad regional"}}
        with patch("app.cross.services.access_management.create_composite_role", new=AsyncMock(return_value=result)):
            response = asyncio.run(create_composite_role_route(payload, self.request, "admin@example.com"))
        self.assertTrue(response["created"])
        self.assertEqual(response["warning"]["code"], "duplicate_combination")
        self.assertEqual(response["warning"]["matching_role_code"], "regional_security")


if __name__ == '__main__':
    unittest.main()
