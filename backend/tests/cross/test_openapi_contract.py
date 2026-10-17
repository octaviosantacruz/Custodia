import os
import re
import unittest
from datetime import datetime, timezone
from uuid import uuid4

os.environ.update({
    'DATABASE_URL': 'postgresql://test:test@127.0.0.1:5432/cmdb',
    'SESSION_SECRET': 'test-only-session-secret-at-least-32-bytes',
    'INGESTION_INTERVAL_MINUTES': '1440',
    'AUTH_MODE': 'local',
    'SESSION_HTTPS_ONLY': 'false',
})

from app.main import app
from app.cross.api.routes.activity_models import (
    ActivityEventsResponse,
    ActivityResponse,
    OperationalErrorsResponse,
    OperationalLogsResponse,
    SecurityEventsResponse,
)
from app.cyberark.pam.api.routes.safe_lifecycle_models import SafeAuditResponse, RetiredCandidatesResponse
from app.cyberark.pam.api.routes.safe_read_models import AccountListResponse, SafeDetailResponse, SafeListResponse
from app.cyberark.pam.api.routes.findings_models import FindingRow, FindingsRefreshResponse, FindingsResponse
from app.cyberark.pam.api.routes.analytics_models import (
    AccessConcentrationResponse,
    AccountManagementSummaryResponse,
    AccountPlatformCoverageResponse,
    AnalyticsResponse,
    ExecutiveAnalyticsResponse,
    InventoryFreshnessResponse,
    LicenseReconciliationResponse,
    SummaryResponse,
)
from app.cross.api.routes.users_models import (
    PeopleResponse,
    TemporaryPasswordResponse,
    UserCreatedResponse,
    UserDeletedResponse,
    UsersResponse,
    UserUpdatedResponse,
)
from app.cyberark.pam.api.routes.preferences_models import DashboardPreferencesPreviewResponse, DashboardPreferencesResponse
from app.netskope.sse.api.routes.preferences_models import NetskopeDashboardPreferencesResponse
from app.cross.api.routes.preferences_models import WorkspacePreferencesResponse
from app.cross.api.routes.connection_inventory_models import (
    ConnectionInventoryImportedResponse,
    ConnectionInventoryResponse,
)
from app.cross.api.routes.ingestion_models import (
    IngestionAllEnqueuedResponse,
    IngestionEnqueuedResponse,
    IngestionPreviewResponse,
    IngestionRunRow,
    IngestionRunsResponse,
    IngestionScheduleResponse,
)
from app.cyberark.identity_administration.api.routes.cmdb_identity_models import (
    IdentityFederationDetailRow,
    IdentityFederationsResponse,
    IdentityPamChainResponse,
    IdentityRoleDetailResponse,
    IdentityRolesResponse,
    IdentityUserDetailResponse,
    IdentityUsersResponse,
)
from app.cyberark.sia.api.routes.cmdb_sia_models import (
    SiaConnectorsResponse,
    SiaDatabaseAccountsResponse,
    SiaDestinationsResponse,
    SiaPoliciesResponse,
    SiaPolicyDetailResponse,
    SiaResourcesResponse,
    SiaTargetSetsResponse,
)
from app.cyberark.pam.api.routes.cmdb_pam_models import (
    PamComponentsResponse,
    PamCleanupSignalsResponse,
    PamConnectorsResponse,
    PamPlatformCatalogsResponse,
    PamPlatformsResponse,
    PamPlatformTargetsResponse,
    PamRoleDetailResponse,
    PamRolesResponse,
    PamUserChainResponse,
    PamUsersResponse,
    PsmConnectorTypesResponse,
)
from app.cyberark.access.api.routes.cmdb_access_models import AccessAssetsResponse
from app.netskope.sse.api.routes.netskope_dlp_models import (
    NetskopeDlpAlertsResponse,
    NetskopeDlpStatusResponse,
)
from app.netskope.sse.api.routes.cmdb_netskope_models import (
    NetskopeAlertsResponse,
    NetskopeClientComplianceResponse,
    NetskopeClientEventsResponse,
    NetskopeDeviceChangesResponse,
    NetskopeDeviceFacetsResponse,
    NetskopeDeviceFreshnessResponse,
    NetskopeDeviceHistoryResponse,
    NetskopeDuplicatesResponse,
    NetskopeFleetResponse,
    NetskopeMetricsResponse,
    NetskopeObjectsResponse,
)


class OpenApiContractTests(unittest.TestCase):
    def test_inventory_and_export_routes_are_published(self):
        paths = app.openapi()['paths']
        expected = {
            '/api/accounts',
            '/api/accounts/export.csv',
            '/api/analytics/account-platform-coverage',
            '/api/analytics/account-management',
            '/api/analytics/executive',
            '/api/connection-inventory',
            '/api/search',
            '/api/safes/export.csv',
            '/api/safes/{safe_number}/accounts',
            '/api/cmdb/coverage',
            '/api/cmdb/netskope/users',
            '/api/cmdb/netskope/devices',
            '/api/cmdb/netskope/devices/{device_id}/history',
            '/api/cmdb/netskope/devices/facets',
            '/api/cmdb/netskope/devices/freshness',
            '/api/cmdb/netskope/devices/client-events',
            '/api/cmdb/netskope/devices/changes',
            '/api/cmdb/netskope/devices/client-compliance',
            '/api/cmdb/netskope/devices/fleet',
            '/api/cmdb/netskope/devices/duplicates',
            '/api/netskope/baselines',
            '/api/cmdb/netskope/metrics',
            '/api/cmdb/netskope/alerts',
            '/api/cmdb/netskope/observed-policies',
            '/api/cmdb/pam-roles',
            '/api/cmdb/pam-cleanup-signals',
            '/api/cmdb/pam-roles/{object_id}',
            '/api/cmdb/pam-users',
            '/api/cmdb/pam-users/{object_id}/chain',
            '/api/findings',
            '/api/findings/refresh',
            '/api/findings/{finding_id}',
            '/api/dashboard/preferences',
            '/api/dashboard/netskope/preferences',
            '/api/operational-errors',
            '/api/workspaces/preferences',
            '/api/ingestion/schedule',
            '/api/auth/api-tokens',
            '/api/auth/api-tokens/{token_id}',
        }
        self.assertTrue(expected.issubset(paths))
        for path in expected - {'/api/findings/refresh', '/api/findings/{finding_id}', '/api/auth/api-tokens/{token_id}'}:
            self.assertIn('get', paths[path])
        self.assertIn('post', paths['/api/findings/refresh'])
        self.assertIn('patch', paths['/api/findings/{finding_id}'])
        self.assertIn('put', paths['/api/dashboard/preferences'])
        self.assertIn('put', paths['/api/dashboard/netskope/preferences'])
        self.assertIn('put', paths['/api/workspaces/preferences'])

    def test_logout_is_post_only(self):
        logout = app.openapi()['paths']['/api/auth/logout']
        self.assertIn('post', logout)
        self.assertNotIn('get', logout)

    def test_retired_netskope_dlp_routes_are_not_published(self):
        # NSK-DLP-001 revived the alert list, status and policies for
        # netskope:dlp_read. The per-device summary stays retired (no device
        # field) and NSK-INV-002 retired the global and per-user summaries;
        # the 410-only routes still answer 410 through the real FastAPI wiring
        # (test_netskope_alert_routes.py).
        schema = app.openapi()
        paths = schema['paths']
        for path in (
            '/api/cmdb/netskope/devices/alerts/summary',
            '/api/cmdb/netskope/incidents/summary',
            '/api/cmdb/netskope/users/alerts/summary',
        ):
            self.assertNotIn(path, paths)
        for path in (
            '/api/cmdb/netskope/investigations',
            '/api/cmdb/netskope/dlp/status',
            '/api/cmdb/netskope/dlp/policies',
        ):
            self.assertIn(path, paths)
        component_names = set(schema['components']['schemas'])
        for model_name in (
            'NetskopeInvestigationsResponse', 'NetskopeIncidentSummaryResponse',
            'NetskopeDeviceAlertSummaryResponse', 'NetskopeUserAlertSummaryResponse',
        ):
            self.assertNotIn(model_name, component_names)

    def test_deterministic_auth_routes_publish_response_models(self):
        paths = app.openapi()['paths']
        expected_models = {
            '/api/auth/me': ('get', 'AuthMeResponse'),
            '/api/auth/setup-status': ('get', 'SetupStatusResponse'),
            '/api/auth/password': ('post', 'PasswordUpdatedResponse'),
            '/api/auth/status': ('get', 'AuthStatusResponse'),
        }
        for path, (method, model_name) in expected_models.items():
            response = paths[path][method]['responses']['200']
            schema = response['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

        response = paths['/api/auth/me']['get']['responses']['200']
        self.assertEqual(
            response['content']['application/json']['schema']['$ref'],
            '#/components/schemas/AuthMeResponse',
        )

    def test_catalog_routes_publish_response_models(self):
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/catalogs', 'get'): 'CatalogsResponse',
            ('/api/business-units', 'post'): 'BusinessUnitResponse',
            ('/api/business-units/{business_unit_id}', 'patch'): 'BusinessUnitResponse',
            ('/api/responsibles', 'post'): 'ResponsibleResponse',
            ('/api/responsibles/{responsible_id}', 'patch'): 'ResponsibleResponse',
        }
        for (path, method), model_name in expected_models.items():
            response = paths[path][method]['responses']['200' if method == 'get' else ('201' if path in {'/api/business-units', '/api/responsibles'} else '200')]
            schema = response['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

    def test_access_catalog_routes_publish_response_models(self):
        paths = app.openapi()['paths']
        expected_models = {
            '/api/access/permissions': 'PermissionsResponse',
            '/api/access/roles': 'RolesResponse',
            '/api/access/domains': 'DomainsResponse',
            '/api/access/oidc-health': 'OidcHealthResponse',
        }
        for path, model_name in expected_models.items():
            schema = paths[path]['get']['responses']['200']['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

    def test_access_mutation_routes_publish_response_models(self):
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/access/permissions', 'post'): ('201', 'CreatedPermissionResponse'),
            ('/api/access/roles', 'post'): ('201', 'CreatedRoleResponse'),
            ('/api/access/roles/composite', 'post'): ('201', 'CompositeRoleResponse'),
            ('/api/access/roles/{role_code}', 'patch'): ('200', 'UpdatedResponse'),
            ('/api/access/roles/{role_code}/composite', 'patch'): ('200', 'CompositeRoleResponse'),
        }
        for (path, method), (status_code, model_name) in expected_models.items():
            schema = paths[path][method]['responses'][status_code]['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

    def test_inventory_mutation_routes_publish_response_models(self):
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/accounts/{safe_number}/{account_id}/classification', 'patch'): 'AccountClassificationResponse',
            ('/api/safes/{safe_number}/assignment', 'patch'): 'SafeMutationResponse',
            ('/api/safes/{safe_number}/scope', 'patch'): 'SafeMutationResponse',
            ('/api/safes/{safe_number}/account-type', 'patch'): 'SafeMutationResponse',
            ('/api/safes/bulk-assignment', 'post'): 'BulkAssignmentResponse',
            ('/api/safes/{safe_number}/metadata', 'patch'): 'SafeMutationResponse',
            ('/api/safes/{safe_number}/quick-update', 'patch'): 'SafeMutationResponse',
        }
        for (path, method), model_name in expected_models.items():
            schema = paths[path][method]['responses']['200']['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')
        schemas = app.openapi()['components']['schemas']
        self.assertIn('grantee_links', schemas['SiaPolicyRow']['properties'])
        self.assertIn('grantee_links', schemas['SiaPolicyDetailRow']['properties'])
        self.assertEqual(
            set(schemas['SiaPolicyGranteeLink']['properties']),
            {'value', 'identity', 'pam'},
        )

    def test_audit_and_lifecycle_routes_publish_response_models(self):
        """AUD-API-002 (blocks 1-2): the audit/log/events reads, the Safe
        lifecycle reads and the Safe/account inventory reads used to publish
        untyped dictionaries."""
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/activity', 'get'): 'ActivityResponse',
            ('/api/security-events', 'get'): 'SecurityEventsResponse',
            ('/api/operational-errors', 'get'): 'OperationalErrorsResponse',
            ('/api/operational-logs', 'get'): 'OperationalLogsResponse',
            ('/api/events', 'get'): 'ActivityEventsResponse',
            ('/api/safes/{safe_number}/audit', 'get'): 'SafeAuditResponse',
            ('/api/lifecycle/retired', 'get'): 'RetiredCandidatesResponse',
            ('/api/safes', 'get'): 'SafeListResponse',
            ('/api/safes/{safe_number}', 'get'): 'SafeDetailResponse',
            ('/api/accounts', 'get'): 'AccountListResponse',
            ('/api/safes/{safe_number}/accounts', 'get'): 'AccountListResponse',
        }
        for (path, method), model_name in expected_models.items():
            schema = paths[path][method]['responses']['200']['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

    def test_audit_lifecycle_and_inventory_examples_validate_against_published_models(self):
        """AUD-API-002 blocks 1-2: OpenAPI refs must also accept the shapes
        returned by their repositories, not merely exist in the schema."""
        now = datetime.now(timezone.utc)
        run_id = str(uuid4())
        activity_row = {
            'audit_id': 1, 'actor_id': 'admin', 'actor_name': 'Admin',
            'action': 'update', 'entity_type': 'safe', 'entity_id': '42',
            'entity_name': 'Finance', 'before_data': {}, 'after_data': {}, 'created_at': now,
        }
        account_row = {
            'safe_number': 42, 'safe_name': 'Finance', 'account_id': 'acc-1',
            'account_name': 'svc-finance', 'user_name': 'svc-finance', 'address': '10.0.0.1',
            'platform_id': 'Unix', 'platform_name': 'Unix', 'lifecycle_status': 'active',
            'last_seen_at': now, 'attributes': {}, 'inventory_account_type': 'nominal',
        }
        safe_list_row = {
            'safe_number': 42, 'safe_name': 'Finance', 'safe_url_id': 'Finance',
            'member_count': 1, 'account_count': 1, 'cpm_configured': True,
            'manage_safe_principal_count': 1, 'account_type_counts': {'NOMINAL': 1},
            'classification_status': 'assigned', 'inventory_scope': 'business',
            'data_quality_status': 'clean', 'workflow_status': 'pending',
        }
        safe_detail_row = {
            **safe_list_row,
            'location': None, 'creator_id': None, 'creator_name': 'System',
            'olac_enabled': True, 'retention_configured': True,
            'number_of_versions_retention': 5, 'number_of_days_retention': 30,
            'auto_purge_enabled': True, 'creation_time': now, 'last_modification_time': now,
            'is_expired_member': False, 'first_seen_at': now, 'last_seen_at': now,
            'source_run_id': run_id, 'lifecycle_status': 'active', 'retired_at': None,
            'internal_name': None, 'business_unit_id': 3, 'responsible_id': 7,
            'account_type_classification': 'nominal', 'next_action': None,
            'scope_hint': None, 'business_unit_name': 'Finanzas', 'responsible_name': 'Ada',
            'notes': None, 'assigned_at': now, 'assigned_by': 'admin',
        }
        examples = [
            (ActivityResponse, {'rows': [activity_row], 'total': 1, 'limit': 50, 'offset': 0}),
            (SecurityEventsResponse, {'rows': [{'event_id': 1, 'occurred_at': now, 'event_type': 'login_success', 'result': 'success'}], 'total': 1, 'limit': 50, 'offset': 0}),
            (OperationalErrorsResponse, {'rows': [{'event_id': 1, 'occurred_at': now, 'request_id': 'req-1', 'method': 'GET', 'path': '/api/safes', 'error_kind': 'TimeoutError', 'status_code': 500}], 'total': 1, 'limit': 50, 'offset': 0}),
            (OperationalLogsResponse, {'rows': [{'log_id': 1, 'occurred_at': now, 'level': 'INFO', 'source_system': 'cyberark', 'event': 'sync_complete', 'message': 'ok', 'run_id': run_id}], 'total': 1, 'limit': 100, 'offset': 0}),
            (ActivityEventsResponse, {'rows': [{'event_id': 1, 'kind': 'sync', 'actor_id': 'admin', 'created_at': now}]}),
            (SafeAuditResponse, {'rows': [{'audit_id': 1, 'actor_id': 'admin', 'action': 'update', 'entity_type': 'safe', 'entity_id': '42', 'created_at': now}]}),
            (RetiredCandidatesResponse, {'rows': [{'safe_number': 41, 'safe_name': 'Old', 'safe_url_id': 'Old', 'retired_at': now, 'retired_member_count': 0}], 'total': 1}),
            (SafeListResponse, {'rows': [safe_list_row], 'total': 1, 'classification_counts': {'assigned': 1, 'review': 0, 'pending': 0}, 'limit': 50, 'offset': 0, 'search': '', 'workflow_status': '', 'classification_status': '', 'account_type': '', 'inventory_scope': '', 'data_quality_status': '', 'scope_hint': '', 'health_filter': '', 'next_action': '', 'business_unit': '', 'responsible': '', 'include_accounts': False}),
            (SafeDetailResponse, {'safe': safe_detail_row, 'members': [{'member_id': 'm-1', 'member_name': 'Admin', 'member_type': 'User', 'lifecycle_status': 'active', 'permissions': {}}]}),
            (AccountListResponse, {'rows': [account_row], 'total': 1, 'limit': 50, 'offset': 0}),
        ]
        for model, payload in examples:
            with self.subTest(model=model.__name__):
                model.model_validate(payload)

    def test_findings_and_analytics_routes_publish_response_models(self):
        """AUD-API-002 (block 3): the findings and analytics reads used to
        publish untyped dictionaries."""
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/findings', 'get'): 'FindingsResponse',
            ('/api/findings/refresh', 'post'): 'FindingsRefreshResponse',
            ('/api/findings/{finding_id}', 'patch'): 'FindingRow',
            ('/api/summary', 'get'): 'SummaryResponse',
            ('/api/analytics', 'get'): 'AnalyticsResponse',
            ('/api/analytics/concentration', 'get'): 'AccessConcentrationResponse',
            ('/api/analytics/license-reconciliation', 'get'): 'LicenseReconciliationResponse',
            ('/api/analytics/executive', 'get'): 'ExecutiveAnalyticsResponse',
            ('/api/analytics/freshness', 'get'): 'InventoryFreshnessResponse',
            ('/api/analytics/account-platform-coverage', 'get'): 'AccountPlatformCoverageResponse',
            ('/api/analytics/account-management', 'get'): 'AccountManagementSummaryResponse',
        }
        for (path, method), model_name in expected_models.items():
            schema = paths[path][method]['responses']['200']['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

        coverage_props = app.openapi()['components']['schemas']['ConnectionCoverageResponse']['properties']
        self.assertIn('import', coverage_props)

    def test_findings_and_analytics_examples_validate_against_published_models(self):
        """AUD-API-002 block 3: the published refs must accept the exact shapes
        the repositories return, including the `import` key of the executive
        coverage (a Python keyword, mapped through a field alias)."""
        now = datetime.now(timezone.utc)
        run_id = uuid4()
        finding_row = {
            'finding_id': 1, 'rule_id': 'ACCOUNT_PLATFORM_MISSING', 'rule_version': '1',
            'source_system': 'cyberark', 'subject_type': 'account', 'subject_id': 'account-24',
            'title': 'Cuenta sin plataforma informada', 'severity': 'medium',
            'category': 'data_quality', 'status': 'open',
            'evidence': {'account_id': 'account-24', 'safe_number': 24},
            'source_run_id': run_id, 'first_detected_at': now, 'last_detected_at': now,
            'resolved_at': None, 'exception_reason': None, 'exception_until': None, 'updated_at': now,
        }
        concentration = {
            'users': [{'name': 'ada@itti.digital', 'safe_count': 9}],
            'roles': [{'name': 'Operations', 'safe_count': 5}],
            'totals': {'users': 108, 'roles': 79, 'safes': 436},
        }
        coverage = {
            'totals': {'total': 12, 'both': 7, 'pam_only': 2, 'sia_only': 1, 'none': 2,
                       'zsp_implemented': 9, 'zsp_pending': 2, 'zsp_unknown': 1},
            'by_environment': [{'environment': 'PROD', 'total': 8, 'both': 5, 'pam_only': 1,
                                'sia_only': 1, 'none': 1, 'zsp_implemented': 6, 'zsp_pending': 1, 'zsp_unknown': 1}],
            'import': {'import_id': run_id, 'file_name': 'conexiones.csv', 'row_count': 12, 'imported_at': now},
        }
        examples = [
            (FindingsResponse, {'rows': [finding_row], 'total': 1, 'limit': 50, 'offset': 0}),
            (FindingRow, {**finding_row, 'created_at': now}),
            (FindingsRefreshResponse, {'status': 'completed', 'current_findings': 3}),
            (SummaryResponse, {
                'safes': 465, 'business_safes': 400, 'internal_safes': 10, 'scope_pending_safes': 55,
                'scope_candidate_safes': 6, 'clean_business_safes': 350, 'obsolete_safes': 2,
                'duplicate_safes': 1, 'accounts': 900, 'pending_classification': 104, 'assigned': 300,
                'review': 5,
                'safe_health': {'denominator': 465, 'missing_cpm': 3, 'no_accounts': 12,
                                'olac_disabled': 4, 'retention_unconfigured': 8, 'manage_safe_concentration': 2},
                'latest_run': {'run_id': run_id, 'source_system': 'cyberark', 'source_file': 'safes.json',
                               'status': 'completed', 'started_at': now, 'completed_at': now,
                               'expected_safe_count': 465, 'received_safe_count': 465,
                               'received_member_count': 950, 'error_count': 0},
            }),
            (AnalyticsResponse, {
                'workflow_status': [{'key': 'pending', 'count': 104}],
                'next_actions': [{'key': 'Sin definir', 'count': 104}],
                'account_types': [{'key': 'Nominal', 'count': 300}],
                'business_units': [{'key': '3', 'label': 'Finanzas', 'count': 40}],
                'responsibles': [{'key': 'unassigned', 'label': 'Sin responsable', 'count': 10}],
            }),
            (AccessConcentrationResponse, concentration),
            (LicenseReconciliationResponse, {
                'totals': {'standard_users': 47, 'reconciled_users': 47, 'only_user_type': 0,
                           'only_role_members': 0, 'confirmed': True},
                'rows': [{'object_id': 8, 'display_name': 'Ada', 'source_id': 'u-8', 'user_id': '12',
                          'license_roles': ['Privilege Cloud Users'], 'okta_groups': ['sg_okta']}],
            }),
            (ExecutiveAnalyticsResponse, {'connection_coverage': coverage, 'access_concentration': concentration}),
            (InventoryFreshnessResponse, {
                'safes': 465, 'last_mod_unknown': 20, 'last_mod_30d': 100, 'last_mod_90d': 150,
                'last_mod_365d': 150, 'last_mod_over_year': 45, 'safes_without_accounts': 12,
                'accounts_active': 900, 'accounts_retired': 30, 'accounts_not_seen_30d': 40,
            }),
            (AccountPlatformCoverageResponse, {
                'accounts_active': 900, 'accounts_with_platform': 880, 'accounts_without_platform': 10,
                'accounts_with_partial_platform': 10, 'platforms_observed': 75, 'safes_without_accounts': 12,
            }),
            (AccountManagementSummaryResponse, {
                'accounts_active': 900, 'automatic_enabled': 700, 'automatic_disabled': 100,
                'management_unknown': 100, 'status_success': 850, 'status_failure': 10,
                'status_in_process': 5, 'status_unknown': 35, 'changed_30d': 100,
                'changed_90d': 200, 'changed_365d': 300, 'changed_older': 200,
                'changed_unknown': 100,
            }),
        ]
        for model, payload in examples:
            with self.subTest(model=model.__name__):
                model.model_validate(payload)

        executive = ExecutiveAnalyticsResponse.model_validate(
            {'connection_coverage': coverage, 'access_concentration': concentration}
        )
        self.assertIn('import', executive.model_dump(by_alias=True)['connection_coverage'])

    def test_user_admin_routes_publish_response_models(self):
        """AUD-API-002 (block 4): the user administration routes used to
        publish untyped dictionaries."""
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/auth/users', 'get'): ('200', 'UsersResponse'),
            ('/api/auth/people', 'get'): ('200', 'PeopleResponse'),
            ('/api/auth/users', 'post'): ('201', 'UserCreatedResponse'),
            ('/api/auth/users/{user_id}', 'patch'): ('200', 'UserUpdatedResponse'),
            ('/api/auth/users/{user_id}/reissue-temp-password', 'post'): ('200', 'TemporaryPasswordResponse'),
            ('/api/auth/users/{user_id}', 'delete'): ('200', 'UserDeletedResponse'),
        }
        for (path, method), (status, model_name) in expected_models.items():
            schema = paths[path][method]['responses'][status]['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

    def test_user_admin_examples_validate_against_published_models(self):
        """AUD-API-002 block 4: the published refs must accept the exact rows
        `user_admin.list_users` / `list_people` build, including the OIDC row
        whose `updated_at` mirrors `last_login_at`, and the tuple unpacked by
        the create route."""
        now = datetime.now(timezone.utc)
        local_user = {
            'actor_id': 'ana', 'email': 'ana@example.test', 'display_name': 'Ana',
            'is_active': True, 'must_change_password': False,
            'created_at': now, 'updated_at': now, 'auth_source': 'local',
            'last_login_at': None, 'roles': ['reader'],
        }
        oidc_user = {
            'actor_id': 'oidc:sub-1', 'email': 'ana@example.test', 'display_name': 'Ana',
            'is_active': True, 'must_change_password': False,
            'created_at': now, 'updated_at': now, 'auth_source': 'oidc',
            'last_login_at': now, 'roles': ['operator'],
        }
        person_identities = [
            {k: v for k, v in oidc_user.items() if k not in ('created_at', 'updated_at')},
            {k: v for k, v in local_user.items() if k not in ('created_at', 'updated_at')},
        ]
        person = {
            'key': 'ana@example.test', 'email': 'ana@example.test',
            'display_name': 'Ana', 'identities': person_identities,
        }
        examples = [
            (UsersResponse, {'rows': [local_user, oidc_user], 'total': 2, 'limit': 50, 'offset': 0}),
            (PeopleResponse, {'rows': [person], 'total': 1, 'limit': 50, 'offset': 0}),
            (UserCreatedResponse, {'created': True, 'actor_id': 'new-user', 'temporary_password': 'TempPassw0rd!'}),
            (UserUpdatedResponse, {'updated': True}),
            (TemporaryPasswordResponse, {'temporary_password': 'TempPassw0rd!'}),
            (UserDeletedResponse, {'deleted': True, 'actor_id': 'new-user'}),
        ]
        for model, payload in examples:
            with self.subTest(model=model.__name__):
                model.model_validate(payload)

    def test_preferences_routes_publish_response_models(self):
        """AUD-API-002 (block 5): the personal preference routes used to
        publish untyped dictionaries."""
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/dashboard/preferences', 'get'): 'DashboardPreferencesResponse',
            ('/api/dashboard/preferences', 'put'): 'DashboardPreferencesResponse',
            ('/api/dashboard/preferences/preview', 'post'): 'DashboardPreferencesPreviewResponse',
            ('/api/dashboard/netskope/preferences', 'get'): 'NetskopeDashboardPreferencesResponse',
            ('/api/dashboard/netskope/preferences', 'put'): 'NetskopeDashboardPreferencesResponse',
            ('/api/workspaces/preferences', 'get'): 'WorkspacePreferencesResponse',
            ('/api/workspaces/preferences', 'put'): 'WorkspacePreferencesResponse',
        }
        for (path, method), model_name in expected_models.items():
            schema = paths[path][method]['responses']['200']['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

    def test_preferences_examples_serialize_exactly_as_the_routes_return_them(self):
        """AUD-API-002 block 5: the dashboard widget extras only exist for the
        evaluating branch that produced them, so the declared optional fields
        must serialize with `exclude_unset` and never invent a `null` -- the
        preferences payload is persisted and diffed by the frontend."""
        def widget(**overrides):
            value = {
                'widget_id': 'widget', 'title': 'Widget', 'kind': 'goal', 'measure': 'safes',
                'value_format': 'count',
                'filters': {'workflow_status': '', 'classification_status': '',
                            'inventory_scope': 'business', 'data_quality_status': 'clean',
                            'health_filter': ''},
                'chart': None, 'target_value': 400, 'target_direction': 'at_least',
                'period_label': 'Q4 2026', 'baseline_value': None, 'size': 'sm', 'position': None,
            }
            value.update(overrides)
            return value

        evaluated = [
            {**widget(), 'value': 315},
            {**widget(widget_id='count', kind='count', target_value=None, target_direction=None,
                      period_label=None), 'value': 12},
            {**widget(widget_id='coverage', kind='count', measure='safe_account_coverage',
                      value_format='percentage', target_value=None, target_direction=None,
                      period_label=None),
             'value': 87.84, 'data_status': 'available', 'covered_count': 383, 'total_count': 436},
            {**widget(widget_id='by-unit', kind='chart', measure='safes',
                      chart={'style': 'pie', 'group_by': 'business_unit'},
                      target_value=None, target_direction=None, period_label=None),
             'buckets': [{'key': 'Pagos', 'filter_value': 'Pagos', 'count': 12},
                         {'key': 'Otros', 'count': 3}],
             'value': 15},
            {**widget(widget_id='heatmap', kind='chart', measure='safes',
                      chart={'style': 'heatmap', 'group_by': 'business_unit_workflow'},
                      target_value=None, target_direction=None, period_label=None),
             'buckets': [], 'value': 7,
             'chart_data': {'x_labels': ['UENO'], 'y_labels': ['pending'],
                            'cells': [{'x': 0, 'y': 0, 'value': 7,
                                       'filter_value': '{"business_unit": "4", "workflow_status": "pending"}'}]}},
            {**widget(widget_id='degraded', kind='chart', measure='safes',
                      chart={'style': 'bars', 'group_by': 'next_action'},
                      target_value=None, target_direction=None, period_label=None),
             'value': 0, 'buckets': [], 'chart_data': None, 'data_status': 'unavailable'},
        ]
        response = DashboardPreferencesResponse.model_validate({'widgets': evaluated, 'is_default': False})
        self.assertEqual(response.model_dump(exclude_unset=True)['widgets'], evaluated)
        DashboardPreferencesPreviewResponse.model_validate({'widgets': evaluated})

        netskope = {
            'widgets': [{'id': 'users_total', 'size': 'sm', 'filters': {}},
                        {'id': 'devices_by_os', 'size': 'md', 'filters': {'os': 'Windows'}}],
            'data_widgets': ['users_total'],
            'chart_widgets': ['devices_by_os'],
            'is_default': False,
        }
        self.assertEqual(NetskopeDashboardPreferencesResponse.model_validate(netskope).model_dump(exclude_none=True), netskope)

        workspace = {
            'visible_workspaces': ['general', 'safes'],
            'hidden_workspaces': [],
            'recent_workspaces': ['safes'],
            'updated_at': datetime.now(timezone.utc),
        }
        self.assertEqual(
            set(WorkspacePreferencesResponse.model_validate(workspace).model_dump()),
            set(workspace),
        )
        WorkspacePreferencesResponse.model_validate({**workspace, 'updated_at': None})

    def test_connection_inventory_routes_publish_response_models(self):
        """AUD-API-002 (block 6): the connection inventory routes used to
        publish untyped dictionaries."""
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/connection-inventory', 'get'): 'ConnectionInventoryResponse',
            ('/api/connection-inventory/import', 'post'): 'ConnectionInventoryImportedResponse',
        }
        for (path, method), model_name in expected_models.items():
            schema = paths[path][method]['responses']['200']['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

        inventory_props = app.openapi()['components']['schemas']['ConnectionInventoryResponse']['properties']
        self.assertIn('import', inventory_props)

    def test_connection_inventory_examples_validate_against_published_models(self):
        """AUD-API-002 block 6: the list projection joins the current import
        into every row and exposes the envelope `import` key through an alias
        (`import` is a Python keyword)."""
        now = datetime.now(timezone.utc)
        import_id = uuid4()
        row = {
            'inventory_id': 7, 'source_row_number': 8, 'instance_name': 'srv-01',
            'environment': 'PROD', 'private_ip': '10.0.0.7', 'port': 443,
            'ca_sia': True, 'ca_dba': None, 'zsp_implemented': False,
            'access_available': True, 'description': '',
            'import_id': import_id, 'file_name': 'conexiones.csv', 'row_count': 12,
            'imported_at': now,
            'safe_matches': [{'safe_number': 42, 'safe_name': 'SAFE-A', 'account_id': 'a-1',
                              'account_name': 'svc', 'address': '10.0.0.7',
                              'platform_name': 'Unix', 'platform_id': 'unix-1'}],
            'sia_matches': [{'object_id': 5, 'display_name': 'Policy A', 'source_id': 'p-5'}],
            'safe_match_count': 1, 'sia_match_count': 1,
        }
        payload = {
            'rows': [row], 'total': 1, 'limit': 50, 'offset': 0, 'search': '10.0.0',
            'filters': {'environment': 'PROD', 'coverage': 'both'},
            'import': {'import_id': import_id, 'file_name': 'conexiones.csv',
                       'row_count': 12, 'imported_at': now},
        }
        response = ConnectionInventoryResponse.model_validate(payload)
        self.assertEqual(response.model_dump(by_alias=True)['import']['import_id'], import_id)
        # An empty import is a valid contract state, not a missing response.
        ConnectionInventoryResponse.model_validate({**payload, 'rows': [], 'total': 0, 'import': None})
        ConnectionInventoryImportedResponse.model_validate(
            {'imported': True, 'import_id': str(import_id), 'row_count': 12, 'mode': 'update',
             'counts': {'incoming': 12, 'new': 1, 'changed': 2, 'unchanged': 9, 'missing': 0, 'already_retired': 0}}
        )

    def test_ingestion_routes_publish_response_models(self):
        """AUD-API-002 (block 7): the ingestion routes used to publish
        untyped dictionaries."""
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/ingestion/preview', 'post'): ('200', 'IngestionPreviewResponse'),
            ('/api/ingestion/runs', 'get'): ('200', 'IngestionRunsResponse'),
            ('/api/ingestion/schedule', 'get'): ('200', 'IngestionScheduleResponse'),
            ('/api/ingestion/runs/{run_id}', 'get'): ('200', 'IngestionRunRow'),
            ('/api/ingestion/runs', 'post'): ('202', 'IngestionEnqueuedResponse'),
            ('/api/ingestion/pam-connectors/runs', 'post'): ('202', 'IngestionEnqueuedResponse'),
            ('/api/ingestion/all/runs', 'post'): ('202', 'IngestionAllEnqueuedResponse'),
            ('/api/ingestion/sia/runs', 'post'): ('202', 'IngestionEnqueuedResponse'),
            ('/api/ingestion/identity-admin/runs', 'post'): ('202', 'IngestionEnqueuedResponse'),
            ('/api/ingestion/access/runs', 'post'): ('202', 'IngestionEnqueuedResponse'),
            ('/api/ingestion/netskope/runs', 'post'): ('202', 'IngestionEnqueuedResponse'),
        }
        for (path, method), (status, model_name) in expected_models.items():
            schema = paths[path][method]['responses'][status]['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

    def test_ingestion_examples_validate_against_published_models(self):
        """AUD-API-002 block 7: the run row mirrors `_RUN_COLUMNS` (nullable
        lease/trigger fields, NOT NULL counters), and the preview keeps
        `reported_safe_count` optional because CyberArk can omit the total."""
        now = datetime.now(timezone.utc)
        run_id = uuid4()
        completed_run = {
            'run_id': run_id, 'source_system': 'cyberark', 'source_file': 'cyberark-api',
            'status': 'completed', 'enqueued_at': now, 'started_at': now, 'completed_at': now,
            'status_message': None, 'attempt_count': 0, 'worker_id': None,
            'heartbeat_at': None, 'lease_expires_at': None, 'expected_safe_count': 465,
            'received_safe_count': 465, 'received_member_count': 950,
            'received_object_count': 465, 'received_relationship_count': 950,
            'retired_object_count': 2, 'retired_relationship_count': 4,
            'error_count': 1, 'error_details': [{'safeName': 'SAFE-X', 'error': 'timeout'}],
            'triggered_by': 'operator@example.test', 'safes_created': 5, 'safes_updated': 3,
            'safes_retired': 2, 'members_created': 10, 'members_updated': 4,
            'members_retired': 4, 'pam_synced': True,
        }
        queued_run = {
            **completed_run, 'run_id': uuid4(), 'source_file': None, 'status': 'queued',
            'completed_at': None, 'expected_safe_count': None, 'error_count': 0,
            'error_details': [], 'triggered_by': None, 'safes_created': 0, 'safes_updated': 0,
            'safes_retired': 0, 'members_created': 0, 'members_updated': 0,
            'members_retired': 0, 'pam_synced': False,
        }
        counts = {'incoming': 465, 'current': 460, 'new': 5, 'changed': 3, 'unchanged': 452, 'retired': 2}
        preview = {
            'safe_counts': counts,
            'member_counts': counts,
            'samples': {
                'new_safes': [{'safe_number': 500, 'safe_name': 'NEW'}],
                'changed_safes': [{'safe_number': 42, 'safe_name': 'SAFE-A',
                                   'changes': [{'field': 'Nombre', 'before': 'A', 'after': 'B'}]}],
                'retired_safes': [{'safe_number': 9, 'safe_name': 'OLD'}],
                'new_members': [{'safe_number': 42, 'member_id': 'm-1', 'member_name': 'Ada'}],
                'changed_members': [{'safe_number': 42, 'member_id': 'm-2', 'member_name': 'Bob',
                                     'changes': [{'field': 'Permiso · UseAccounts',
                                                  'before': False, 'after': True}],
                                     'security_relevant': True}],
                'retired_members': [{'safe_number': 42, 'member_id': 'm-3', 'member_name': 'Eve'}],
            },
            'reported_safe_count': 465, 'complete_snapshot': True, 'can_reconcile': True,
            'warning': None,
        }
        examples = [
            (IngestionRunRow, completed_run),
            (IngestionRunRow, queued_run),
            (IngestionRunsResponse, {'rows': [completed_run, queued_run]}),
            (IngestionScheduleResponse, {'enabled': True, 'interval_minutes': 1440,
                                         'last_scheduled_at': now, 'next_scheduled_at': now}),
            (IngestionScheduleResponse, {'enabled': False, 'interval_minutes': 0,
                                         'last_scheduled_at': None, 'next_scheduled_at': None}),
            (IngestionEnqueuedResponse, {'run_id': run_id, 'status': 'queued'}),
            (IngestionAllEnqueuedResponse, {'runs': [{'run_id': run_id, 'status': 'queued',
                                                      'source_system': 'cyberark'}]}),
            (IngestionPreviewResponse, preview),
            (IngestionPreviewResponse, {**preview, 'samples': {
                'new_safes': [], 'changed_safes': [], 'retired_safes': [],
                'new_members': [], 'changed_members': [], 'retired_members': [],
            }, 'reported_safe_count': None, 'complete_snapshot': False,
                'can_reconcile': False, 'warning': 'La corrida limitada no puede marcar ausencias como retiradas.'}),
        ]
        for model, payload in examples:
            with self.subTest(model=model.__name__):
                model.model_validate(payload)

    def test_cmdb_identity_routes_publish_response_models(self):
        """AUD-API-002 (block 8a): the Identity Administration CMDB routes
        used to publish untyped dictionaries."""
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/cmdb/identity-users', 'get'): 'IdentityUsersResponse',
            ('/api/cmdb/identity-users/{object_id}', 'get'): 'IdentityUserDetailResponse',
            ('/api/cmdb/identity-users/{object_id}/pam-chain', 'get'): 'IdentityPamChainResponse',
            ('/api/cmdb/identity-roles', 'get'): 'IdentityRolesResponse',
            ('/api/cmdb/identity-roles/member-matches', 'get'): 'IdentityRoleMatchesResponse',
            ('/api/cmdb/identity-roles/{object_id}', 'get'): 'IdentityRoleDetailResponse',
            ('/api/cmdb/identity-federations', 'get'): 'IdentityFederationsResponse',
            ('/api/cmdb/identity-federations/{object_id}', 'get'): 'IdentityFederationDetailRow',
        }
        for (path, method), model_name in expected_models.items():
            schema = paths[path][method]['responses']['200']['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

    def test_cmdb_identity_examples_validate_against_published_models(self):
        """AUD-API-002 block 8a: the list envelopes carry the resolved
        federation rule and the Standard-seat annotation; the PAM chain keeps
        its nested roles -> Safes -> platforms -> PSM shape and always
        publishes match_basis/status, including the unmatched case."""
        now = datetime.now(timezone.utc)
        user_row = {
            'object_id': 7, 'display_name': 'Ada', 'source_id': 'uuid-7',
            'attributes': {'user_name': 'ada@itti.digital', 'email': 'ada@itti.digital',
                           'active': True, 'service_user': False, 'oauth_client': False,
                           'last_login_date': '2026-09-20T00:00:00Z',
                           'last_modified': '2026-09-20T00:00:00Z'},
            'role_count': 2,
            'standard_seat_reconciled': True,
            'federation_resolution': {
                'status': 'matched', 'match_basis': 'email_domain_rule',
                'email_domain': 'itti.digital', 'federation_code': 'okta_itti',
                'expected_name': 'Okta ITTI', 'object_id': 3, 'source_id': 'fed-3',
                'display_name': 'Okta ITTI', 'active': True,
            },
        }
        role_row = {
            'object_id': 11, 'display_name': 'Admins', 'source_id': 'r-11',
            'attributes': {'last_modified': '2026-09-20T00:00:00Z'}, 'member_count': 4,
        }
        federation_row = {
            'object_id': 3, 'display_name': 'Okta ITTI', 'source_id': 'fed-3',
            'attributes': {'federation_type': 'SAML', 'active': True,
                           'role': 'user', 'usage': 'login'},
        }
        chain = {
            'matched': True,
            'pam_user': {'object_id': 42, 'display_name': 'ada@itti.digital', 'source_id': 'uuid-7'},
            'roles': [{'object_id': 11, 'display_name': 'Admins', 'source_id': 'r-11',
                       'safe_count': 2,
                       'safes': [{'object_id': 100, 'display_name': 'SAFE-A', 'safe_number': '42',
                                  'account_count': 3, 'platform_count': 1,
                                  'platforms': [{'object_id': 200, 'display_name': 'Unix',
                                                 'source_id': 'unix-1',
                                                 'psms': [{'object_id': 300,
                                                           'display_name': 'PSM-1',
                                                           'source_id': 'psm-1'}]}]}]}],
            'roles_omitted': 0,
            'totals': {'roles': 1, 'safes': 1, 'platforms': 1, 'psms': 1, 'accounts': 3},
            'match_basis': 'uuid', 'status': 'matched',
        }
        examples = [
            (IdentityUsersResponse, {'rows': [user_row], 'total': 1, 'limit': 50, 'offset': 0,
                                     'search': '', 'active_filter': 'active',
                                     'standard_seat': 'reconciled'}),
            (IdentityUserDetailResponse, {
                'user': {**user_row, 'first_seen_at': now, 'last_seen_at': now},
                'roles': [{'object_id': 11, 'display_name': 'Admins', 'source_id': 'r-11'}],
            }),
            (IdentityPamChainResponse, chain),
            (IdentityPamChainResponse, {
                'matched': False, 'pam_user': None, 'roles': [], 'roles_omitted': 0,
                'totals': {'roles': 0, 'safes': 0, 'platforms': 0, 'psms': 0, 'accounts': 0},
                'match_basis': None, 'status': 'unmatched',
            }),
            (IdentityRolesResponse, {'rows': [role_row], 'total': 1, 'limit': 50, 'offset': 0,
                                     'search': ''}),
            (IdentityRoleDetailResponse, {
                'role': {**role_row, 'first_seen_at': now, 'last_seen_at': now},
                'members': [{'object_id': 7, 'display_name': 'Ada', 'source_id': 'uuid-7'}],
            }),
            (IdentityFederationsResponse, {'rows': [federation_row], 'total': 1, 'limit': 50,
                                           'offset': 0, 'search': ''}),
            (IdentityFederationDetailRow, {**federation_row,
                                           'first_seen_at': now, 'last_seen_at': now}),
        ]
        for model, payload in examples:
            with self.subTest(model=model.__name__):
                model.model_validate(payload)

    def test_cmdb_sia_routes_publish_response_models(self):
        """AUD-API-002 (block 8b): the SIA CMDB routes used to publish
        untyped dictionaries."""
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/cmdb/sia-policies', 'get'): 'SiaPoliciesResponse',
            ('/api/cmdb/sia-policies/{object_id}', 'get'): 'SiaPolicyDetailResponse',
            ('/api/cmdb/sia-destinations', 'get'): 'SiaDestinationsResponse',
            ('/api/cmdb/sia-connectors', 'get'): 'SiaConnectorsResponse',
            ('/api/cmdb/sia-resources', 'get'): 'SiaResourcesResponse',
            ('/api/cmdb/sia-database-accounts', 'get'): 'SiaDatabaseAccountsResponse',
            ('/api/cmdb/sia-target-sets', 'get'): 'SiaTargetSetsResponse',
        }
        for (path, method), model_name in expected_models.items():
            schema = paths[path][method]['responses']['200']['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

    def test_cmdb_sia_examples_validate_against_published_models(self):
        """AUD-API-002 block 8b: the list row carries the derived Safe
        linkage while the detail does not, and `destination` stays `Any`
        because an IP rule can be a string or an object."""
        now = datetime.now(timezone.utc)
        policy_attributes = {
            'status': 'active', 'description': 'Acceso DB', 'platforms': ['Unix'],
            'rule_names': ['regla-1'], 'policy_type': 'database',
            'granted_users': ['ada'], 'granted_groups': [], 'granted_roles': ['DBA'],
            'ip_rules': ['10.0.0.7'], 'fqdn_rules': [], 'logical_names': [],
        }
        policy_row = {
            'object_id': 5, 'display_name': 'Policy A', 'source_id': 'p-5',
            'attributes': policy_attributes,
            'linked_safes': [{
                'safe_number': 42, 'safe_name': 'SAFE-A', 'matched_ips': ['10.0.0.7'],
                'accounts': [{'account_id': 'a-1', 'account_name': 'svc',
                              'address': '10.0.0.7', 'platform_name': 'Unix',
                              'platform_id': 'unix-1'}],
            }],
            'linked_ip_count': 1, 'linkage_status': 'linked',
            'grantee_links': [{
                'value': 'ada@example.test',
                'identity': {'status': 'matched', 'match': {'object_id': 71, 'display_name': 'Ada Identity'}},
                'pam': {'status': 'ambiguous'},
            }],
        }
        examples = [
            (SiaPoliciesResponse, {'rows': [policy_row], 'total': 1, 'limit': 50,
                                   'offset': 0, 'search': '', 'status_filter': '',
                                   'linkage_status': ''}),
            (SiaPolicyDetailResponse, {'policy': {
                'object_id': 5, 'display_name': 'Policy A', 'source_id': 'p-5',
                'attributes': policy_attributes,
                'grantee_links': [{'value': 'ada@example.test', 'identity': {'status': 'unmatched'}}],
                'first_seen_at': now, 'last_seen_at': now,
            }}),
            (SiaDestinationsResponse, {'rows': [
                {'policy_object_id': 5, 'display_name': 'Policy A', 'source_id': 'p-5',
                 'platforms': ['Unix'], 'destination_type': 'ip',
                 'destination': {'ipAddresses': ['10.0.0.7']}},
                {'policy_object_id': 5, 'display_name': 'Policy A', 'source_id': 'p-5',
                 'platforms': [], 'destination_type': 'fqdn', 'destination': 'db.example.test'},
            ], 'total': 2, 'limit': 50, 'offset': 0, 'search': '', 'destination_type': ''}),
            (SiaConnectorsResponse, {'rows': [{'object_id': 8, 'display_name': 'Connector 1',
                                               'source_id': 'c-8',
                                               'attributes': {'status': 'active',
                                                              'version': '24.1'}}],
                                     'total': 1, 'limit': 50, 'offset': 0, 'search': ''}),
            (SiaResourcesResponse, {'rows': [{'object_id': 9, 'display_name': 'VM 1',
                                              'source_id': 'r-9',
                                              'attributes': {'resource_type': 'vm',
                                                             'os_type': 'Linux'}}],
                                    'total': 1, 'limit': 50, 'offset': 0, 'search': '',
                                    'resource_type': 'vm'}),
            (SiaDatabaseAccountsResponse, {'rows': [{'object_id': 10, 'display_name': 'db-1',
                                                      'source_id': 'd-10',
                                                      'attributes': {'platform': 'PostgreSQL',
                                                                     'database': 'app'}}],
                                            'total': 1, 'limit': 50, 'offset': 0, 'search': ''}),
            (SiaTargetSetsResponse, {'rows': [{'object_id': 11, 'display_name': 'Linux targets',
                                               'source_id': 'Linux targets',
                                               'attributes': {'target_type': 'Linux',
                                                              'certificate_validation': None}}],
                                     'total': 1, 'limit': 50, 'offset': 0, 'search': ''}),
        ]
        for model, payload in examples:
            with self.subTest(model=model.__name__):
                model.model_validate(payload)

    def test_cmdb_pam_routes_publish_response_models(self):
        """AUD-API-002 (block 8c): the PAM CMDB routes used to publish
        untyped dictionaries."""
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/cmdb/pam-roles', 'get'): 'PamRolesResponse',
            ('/api/cmdb/pam-cleanup-signals', 'get'): 'PamCleanupSignalsResponse',
            ('/api/cmdb/pam-users', 'get'): 'PamUsersResponse',
            ('/api/cmdb/pam-platforms', 'get'): 'PamPlatformsResponse',
            ('/api/cmdb/pam-connectors', 'get'): 'PamConnectorsResponse',
            ('/api/cmdb/pam-psm-connector-types', 'get'): 'PsmConnectorTypesResponse',
            ('/api/cmdb/pam-components', 'get'): 'PamComponentsResponse',
            ('/api/cmdb/pam-platform-catalogs', 'get'): 'PamPlatformCatalogsResponse',
            ('/api/cmdb/pam-platform-targets', 'get'): 'PamPlatformTargetsResponse',
            ('/api/cmdb/pam-users/{object_id}/chain', 'get'): 'PamUserChainResponse',
            ('/api/cmdb/pam-roles/{object_id}', 'get'): 'PamRoleDetailResponse',
        }
        for (path, method), model_name in expected_models.items():
            schema = paths[path][method]['responses']['200']['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

    def test_cmdb_pam_examples_validate_against_published_models(self):
        """AUD-API-002 block 8c: the role list/detail label SIA hits as name
        references only, the component epoch stays nullable, and the user
        chain reuses the shared traversal models."""
        now = datetime.now(timezone.utc)
        role_row = {
            'object_id': 11, 'display_name': 'Admins', 'source_id': 'r-11',
            'attributes': {'user_type': 'EPVUser'}, 'member_count': 4, 'safe_count': 2,
            'account_count': 3, 'role_examples': [], 'sia_reference_count': 1,
        }
        user_row = {
            'object_id': 7, 'display_name': 'ada@itti.digital', 'source_id': 'u-7',
            'role_count': 2, 'standard_seat_reconciled': True, 'enabled': True,
            'suspended': False,
        }
        platform_row = {
            'object_id': 20, 'display_name': 'Unix', 'source_id': 'unix-1',
            'system_type': 'Unix', 'active': True, 'allowed_safes_pattern': '.*',
            'safe_count': 5, 'account_count': 9,
            'psms': [{'object_id': 30, 'display_name': 'PSM-1', 'source_id': 'psm-1'}],
        }
        connector_row = {
            'object_id': 30, 'display_name': 'PSM-1', 'source_id': 'psm-1',
            'address': 'psm1.example.test', 'platform_count': 2,
            'platforms': [{'object_id': 20, 'display_name': 'Unix', 'source_id': 'unix-1'}],
        }
        target_row = {
            'object_id': 40, 'display_name': 'Target DB', 'source_id': 'target-1',
            'platform_base_id': 'unix-1', 'dual_control_required': True,
            'otp_required': False, 'reason_required': True,
            'exclusive_access_required': False, 'credentials_change_automatic': True,
            'credentials_change_interval_days': 30, 'credentials_verify_automatic': True,
            'credentials_verify_interval_days': None, 'credentials_reconcile_automatic': False,
            'psm_server_id': 'psm-1',
        }
        chain = {
            'matched': True,
            'pam_user': {'object_id': 7, 'display_name': 'ada@itti.digital', 'source_id': 'u-7'},
            'roles': [{'object_id': 11, 'display_name': 'Admins', 'source_id': 'r-11',
                       'safe_count': 1,
                       'safes': [{'object_id': 100, 'display_name': 'SAFE-A', 'safe_number': '42',
                                  'account_count': 3, 'platform_count': 1,
                                  'platforms': [{'object_id': 20, 'display_name': 'Unix',
                                                 'source_id': 'unix-1',
                                                 'psms': [{'object_id': 30,
                                                           'display_name': 'PSM-1',
                                                           'source_id': 'psm-1'}]}]}]}],
            'roles_omitted': 0,
            'totals': {'roles': 1, 'safes': 1, 'platforms': 1, 'psms': 1, 'accounts': 3},
        }
        examples = [
            (PamRolesResponse, {'rows': [role_row], 'total': 1, 'limit': 50, 'offset': 0,
                                'search': '', 'kind': 'cyberark_role'}),
            (PamRoleDetailResponse, {
                'role': {'object_id': 11, 'display_name': 'Admins', 'source_id': 'r-11',
                         'attributes': {'user_type': 'EPVUser'},
                         'first_seen_at': now, 'last_seen_at': now},
                'users': [{'object_id': 7, 'display_name': 'ada@itti.digital', 'source_id': 'u-7'}],
                'safes': [{'object_id': 100, 'display_name': 'SAFE-A', 'source_id': '42',
                           'account_count': 3}],
                'sia_references': [{'object_id': 5, 'display_name': 'Policy A', 'source_id': 'p-5',
                                    'attributes': {'status': 'active'}}],
                'sia_match_type': 'display_name_reference_only',
            }),
            (PamUsersResponse, {'rows': [user_row], 'total': 1, 'limit': 50, 'offset': 0,
                                'search': '', 'standard_seat': '', 'status': ''}),
            (PamPlatformsResponse, {'rows': [platform_row], 'total': 1, 'limit': 50,
                                    'offset': 0, 'search': ''}),
            (PamConnectorsResponse, {'rows': [connector_row], 'total': 1, 'limit': 50,
                                     'offset': 0, 'search': ''}),
            (PsmConnectorTypesResponse, {'rows': [{'object_id': 50, 'display_name': 'PSM-RDP',
                                                   'source_id': 'psm-rdp'}],
                                         'total': 1, 'limit': 50, 'offset': 0, 'search': ''}),
            (PamComponentsResponse, {'rows': [{
                'object_id': 60, 'display_name': 'PVWA', 'source_id': 'pvwa-1',
                'description': 'Portal', 'total_count': 2, 'connected_count': 2,
                'instance_versions': ['14.2'], 'latest_logon_at': 1789000000,
                'all_instances_logged_on': True,
            }, {
                'object_id': 61, 'display_name': 'CPM', 'source_id': 'cpm-1',
                'description': 'CPM', 'total_count': 1, 'connected_count': 0,
                'instance_versions': [], 'latest_logon_at': None,
                'all_instances_logged_on': False,
            }]}),
            (PamPlatformCatalogsResponse, {
                'dependents': [{'object_id': 70, 'display_name': 'Dep', 'source_id': 'dep-1',
                                'platform_base_id': 'unix-1', 'platform_base_type': 'Unix',
                                'linked_target_platforms': 2}],
                'groups': [{'object_id': 71, 'display_name': 'Group', 'source_id': 'g-1',
                            'active': True}],
                'rotational_groups': [],
            }),
            (PamPlatformTargetsResponse, {'rows': [target_row], 'total': 1, 'limit': 50,
                                          'offset': 0, 'search': ''}),
            (PamUserChainResponse, chain),
            (PamUserChainResponse, {
                'matched': True, 'pam_user': {'object_id': 7, 'display_name': 'Ada',
                                              'source_id': 'u-7'},
                'roles': [], 'roles_omitted': 0,
                'totals': {'roles': 0, 'safes': 0, 'platforms': 0, 'psms': 0, 'accounts': 0},
            }),
        ]
        for model, payload in examples:
            with self.subTest(model=model.__name__):
                model.model_validate(payload)

    def test_pam_cleanup_signal_model_carries_factory_and_safe_classification(self):
        now = datetime.now(timezone.utc)
        inventory_runs = [{'family': 'pam_inventory', 'latest_attempt': None, 'last_completed_inventory': None}]
        signal = {'count': 1, 'denominator': 2, 'computed_at': now, 'inventory_runs': inventory_runs, 'items': [{
            'object_id': 8, 'display_name': 'PSMMaster', 'source_id': 'factory-1',
            'reason': 'Grupo de fábrica; no se sugiere su baja automática.',
            'is_factory': True, 'factory_label': 'Grupo de fábrica CyberArk · PSM',
        }]}
        safe_signal = {'count': 1, 'denominator': 2, 'computed_at': now, 'inventory_runs': inventory_runs, 'items': [{
            'object_id': 9, 'display_name': 'SAFE-A', 'source_id': '42',
            'reason': 'Sin usuarios activos.', 'inventory_scope': 'pending',
            'account_type_classification': None, 'classification_status': 'pending',
        }]}
        payload = {key: signal for key in (
            'empty_groups', 'identical_member_groups', 'redundant_groups_with_access_peer', 'orphan_psm',
        )}
        payload.update({
            'platforms_without_accounts': {'count': 0, 'denominator': 0, 'computed_at': now,
                                          'inventory_runs': inventory_runs, 'items': []},
            'safes_without_active_users': safe_signal,
        })
        payload['orphan_psm'] = {**signal, 'inventory_runs': [*inventory_runs,
            {'family': 'psm_catalog', 'latest_attempt': None, 'last_completed_inventory': None}]}
        response = PamCleanupSignalsResponse.model_validate(payload)
        self.assertTrue(response.empty_groups.items[0].is_factory)
        self.assertEqual(response.safes_without_active_users.items[0].inventory_scope, 'pending')

    def test_cmdb_access_routes_publish_response_models(self):
        """AUD-API-002 (block 8d): the Access space route used to publish an
        untyped dictionary."""
        schema = app.openapi()['paths']['/api/cmdb/access-assets']['get'][
            'responses']['200']['content']['application/json']['schema']
        self.assertEqual(schema['$ref'], '#/components/schemas/AccessAssetsResponse')

    def test_cmdb_access_examples_validate_against_published_models(self):
        """AUD-API-002 block 8d: `attributes` stays opaque, so the
        polymorphic `port` (number or string) passes through untouched, and
        `platform_name` accepts the LEFT JOIN's null."""
        payload = {
            'rows': [
                {'object_id': 3, 'display_name': 'app01', 'source_id': 'a-3',
                 'attributes': {'asset_type': 'windows', 'port': '3389',
                                'connection_components': ['PSM-RDP']},
                 'platform_name': None},
                {'object_id': 4, 'display_name': 'db01', 'source_id': 'a-4',
                 'attributes': {'asset_type': 'database', 'port': 5432},
                 'platform_name': 'Unix'},
            ],
            'total': 2, 'limit': 50, 'offset': 0, 'search': '', 'asset_type': '',
        }
        response = AccessAssetsResponse.model_validate(payload)
        self.assertEqual(response.rows[0].attributes['port'], '3389')
        self.assertEqual(response.rows[1].attributes['port'], 5432)

    def test_cmdb_netskope_routes_publish_response_models(self):
        """AUD-API-002 (block 8e): the thirteen active Netskope CMDB routes used
        to publish untyped dictionaries. The per-device DLP summary is 410-only
        and stays out of the schema (asserted separately); the NSK-DLP-001
        routes publish their own models in the next test."""
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/cmdb/netskope/users', 'get'): 'NetskopeObjectsResponse',
            ('/api/cmdb/netskope/metrics', 'get'): 'NetskopeMetricsResponse',
            ('/api/cmdb/netskope/alerts', 'get'): 'NetskopeAlertsResponse',
            ('/api/cmdb/netskope/observed-policies', 'get'): 'NetskopeObservedPoliciesResponse',
            ('/api/cmdb/netskope/devices', 'get'): 'NetskopeObjectsResponse',
            ('/api/cmdb/netskope/devices/facets', 'get'): 'NetskopeDeviceFacetsResponse',
            ('/api/cmdb/netskope/devices/freshness', 'get'): 'NetskopeDeviceFreshnessResponse',
            ('/api/cmdb/netskope/devices/client-events', 'get'): 'NetskopeClientEventsResponse',
            ('/api/cmdb/netskope/devices/changes', 'get'): 'NetskopeDeviceChangesResponse',
            ('/api/cmdb/netskope/devices/client-compliance', 'get'): 'NetskopeClientComplianceResponse',
            ('/api/cmdb/netskope/devices/fleet', 'get'): 'NetskopeFleetResponse',
            ('/api/cmdb/netskope/devices/duplicates', 'get'): 'NetskopeDuplicatesResponse',
            ('/api/cmdb/netskope/devices/{device_id}/history', 'get'): 'NetskopeDeviceHistoryResponse',
        }
        for (path, method), model_name in expected_models.items():
            schema = paths[path][method]['responses']['200']['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

    def test_cmdb_netskope_examples_validate_against_published_models(self):
        """AUD-API-002 block 8e: the list envelope publishes the resolved
        observed_user_status, the freshness thresholds the SQL used, the
        nullable baselines and the unavailable changes state."""
        now = datetime.now(timezone.utc)
        run_id = uuid4()
        bucket = [{'key': 'Windows', 'count': 5}]
        objects = {
            'rows': [{
                'object_id': 1, 'display_name': 'LAPTOP-1', 'source_id': 'd1',
                'attributes': {'hostname': 'LAPTOP-1', 'heartbeat': 'true'},
                'first_seen_at': now, 'last_seen_at': now,
                'observed_user_status': 'matched',
                'observed_user': {'source_id': 'u1', 'display_name': 'Ada',
                                  'email': 'ada@example.test'},
            }],
            'total': 1, 'limit': 50, 'offset': 0, 'search': '',
            'filters': {'os': 'Windows'}, 'event_age': '', 'change': '',
            'freshness': 'recent', 'client_compliance': '', 'os_compliance': '',
            'duplicate': '',
        }
        baseline = {'value': {'releases': ['141.0.0']}, 'note': None,
                    'updated_by': 'admin', 'updated_at': now}
        examples = [
            (NetskopeObjectsResponse, objects),
            (NetskopeMetricsResponse, {
                'users_total': 10, 'users_with_device_activity_7d': 6,
                'users_with_device_activity_14d': 7, 'users_with_device_activity_30d': 8,
                'devices_total': 20, 'devices_stale_30d': 4,
                'source_evidence': {'source_fresh': True, 'source_status': 'completed',
                                    'source_completed_at': now, 'as_of': now},
                'devices_with_observed_user': 18, 'last_observed_at': now,
                'devices_by_os': bucket, 'devices_by_client': bucket,
                'devices_by_make': bucket, 'devices_by_classification': bucket,
                'devices_by_user_status': bucket, 'devices_by_company': bucket,
                'users_by_company': bucket,
                'devices_observed_user_matched': 18, 'devices_observed_user_ambiguous': 1,
                'devices_observed_user_unmatched': 1, 'devices_by_observed_user_status': bucket,
                'devices_active_total': 20,
                'users_without_observed_devices': 2, 'users_by_device_count': bucket,
                'users_by_recent_device_age': bucket, 'coverage_risk_devices_by_user': bucket,
            }),
            (NetskopeAlertsResponse, {
                'windows': [{'days': 7, 'window_start': now, 'window_end': now,
                             'captured_at': now, 'total': None, 'availability': 'incomplete',
                             'by_alert_type': bucket,
                             'by_severity': bucket, 'by_action': bucket}],
                'configured': True, 'dlp_export_configured': False,
            }),
            (NetskopeDeviceFacetsResponse, {
                key: bucket for key in (
                    'os', 'client_version', 'classification_status', 'user_status',
                    'company', 'last_seen_event', 'device_make', 'device_model',
                )
            }),
            (NetskopeDeviceFreshnessResponse, {
                'thresholds': {'recent_hours': 24, 'week_days': 7, 'stale_days': 30},
                'buckets': [{'key': 'lt_24h', 'label': 'Menos de 24 h', 'count': 10,
                             'by_classification': bucket}],
                'total': 10, 'review_candidates': None,
                'source_evidence': {'source_fresh': False, 'source_status': 'partial',
                                    'source_completed_at': now, 'as_of': now},
            }),
            (NetskopeClientEventsResponse, {
                'events': [{'key': 'Uninstalled', 'count': 2, 'coverage_risk': True}],
                'total': 2, 'coverage_risk_total': 2,
                'coverage_risk_events': ['Uninstalled', 'Disconnected By Uninstall',
                                         'Admin Disabled'],
            }),
            (NetskopeDeviceChangesResponse, {
                'available': True, 'completed_runs': 2,
                'latest_run': {'source_run_id': run_id, 'captured_at': now,
                               'position': 1, 'devices': 20},
                'previous_run': {'source_run_id': uuid4(), 'captured_at': now,
                                 'position': 2, 'devices': 19},
                'counts': {'added': 1, 'removed': 0, 'upgraded': 2, 'downgraded': 0,
                           'version_changed': 1, 'os_changed': 0,
                           'classification_changed': 0},
                'samples': {'added': [{'device_id': 'd1', 'hostname': 'LAPTOP-1',
                                       'before_value': None, 'after_value': '110.0.1'}]},
            }),
            (NetskopeDeviceChangesResponse, {
                'available': False, 'completed_runs': 1, 'latest_run': None,
                'previous_run': None,
                'counts': {'added': 0, 'removed': 0, 'upgraded': 0, 'downgraded': 0,
                           'version_changed': 0, 'os_changed': 0,
                           'classification_changed': 0},
                'samples': {},
            }),
            (NetskopeClientComplianceResponse, {
                'configured': True, 'baseline': baseline,
                'buckets': [{'key': 'current', 'label': 'Al día', 'count': 10}],
                'by_os': [{'os': 'Windows', 'total': 10, 'current': 10, 'one_behind': 0,
                           'two_plus_behind': 0, 'unrecognized': 0}],
                'total': 10,
            }),
            (NetskopeClientComplianceResponse, {
                'configured': False, 'baseline': None, 'buckets': [], 'by_os': [], 'total': 0,
            }),
            (NetskopeFleetResponse, {
                'by_make': bucket, 'by_model': bucket, 'by_company': bucket,
                'by_os_version': [{'os': 'Windows', 'os_version': '10.0.19045', 'count': 5}],
                'total': 20,
                'os_compliance': {'baseline': baseline, 'buckets': [
                    {'key': 'supported', 'label': 'Soportado', 'count': 18}]},
            }),
            (NetskopeFleetResponse, {
                'by_make': [], 'by_model': [], 'by_company': [], 'by_os_version': [],
                'total': 0, 'os_compliance': None,
            }),
            (NetskopeDuplicatesResponse, {
                'hostname': {'groups': 1, 'devices': 2, 'largest': 2,
                             'top': [{'key': 'NB-100', 'devices': 2,
                                      'distinct_other': 2, 'last_seen_at': now}]},
                'username': {'groups': 0, 'devices': 0, 'largest': 0, 'top': []},
            }),
            (NetskopeDeviceHistoryResponse, {
                'device_id': 'd1',
                'snapshots': [{'snapshot_id': 5, 'source_run_id': run_id,
                               'captured_at': now,
                               'attributes': {'client_version': '110.0.1'}}],
            }),
        ]
        for model, payload in examples:
            with self.subTest(model=model.__name__):
                model.model_validate(payload)

    def test_cmdb_netskope_dlp_routes_publish_response_models(self):
        """NSK-DLP-001: the revived minimal DLP routes publish stable
        schemas and their examples validate against them."""
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/cmdb/netskope/investigations', 'get'): 'NetskopeDlpAlertsResponse',
            ('/api/cmdb/netskope/dlp/policies', 'get'): 'NetskopeDlpPoliciesResponse',
            ('/api/cmdb/netskope/dlp/status', 'get'): 'NetskopeDlpStatusResponse',
        }
        for (path, method), model_name in expected_models.items():
            schema = paths[path][method]['responses']['200']['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

        now = datetime.now(timezone.utc)
        resolved_user = {'object_id': 8, 'display_name': 'Ada', 'email': 'ada@example.test'}
        examples = [
            (NetskopeDlpAlertsResponse, {
                'rows': [
                    {'incident_id': '7', 'event_timestamp': now, 'status': 'open',
                     'severity': 'High', 'policy': 'Policy A', 'action': 'alert',
                     'user_id': 'u-1', 'user': resolved_user},
                    {'incident_id': '8', 'event_timestamp': now, 'status': '', 'severity': '',
                     'policy': '', 'action': '', 'user_id': '', 'user': None},
                ],
                'total': 2, 'limit': 50, 'offset': 0, 'severity': '', 'status': '',
                'action': '', 'policy': '', 'resolution': '', 'user_id': '',
            }),
            (NetskopeDlpStatusResponse, {
                'configured': True, 'captured_at': now, 'coverage_start': now,
                'coverage_end': now, 'partial': False, 'scanned_events': 25,
                'captured_alerts': 19,
            }),
            (NetskopeDlpStatusResponse, {
                'configured': False, 'captured_at': None, 'coverage_start': None,
                'coverage_end': None, 'partial': None, 'scanned_events': 0,
                'captured_alerts': 0,
            }),
        ]
        for model, payload in examples:
            with self.subTest(model=model.__name__):
                model.model_validate(payload)

    def test_chain_routes_publish_response_models(self):
        """CHAIN-001/002: the Cadenas PAM routes publish stable schemas."""
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/chains/pam/node', 'get'): 'ChainNodeResponse',
            ('/api/chains/pam/expand', 'get'): 'ChainExpandResponse',
            ('/api/chains/pam/search', 'get'): 'ChainSearchResponse',
        }
        for (path, method), model_name in expected_models.items():
            schema = paths[path][method]['responses']['200']['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

    def test_identity_chain_routes_are_retired(self):
        """Cadena Identity folded into Relaciones: only the PAM chain routes remain."""
        paths = app.openapi()['paths']
        self.assertFalse([path for path in paths if path.startswith('/api/chains/identity/')])

    def test_netskope_chain_routes_publish_response_models(self):
        """CHAIN-005: the Cadenas Netskope routes publish stable schemas."""
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/chains/netskope/node', 'get'): 'ChainNodeResponse',
            ('/api/chains/netskope/expand', 'get'): 'ChainExpandResponse',
            ('/api/chains/netskope/search', 'get'): 'ChainSearchResponse',
        }
        for (path, method), model_name in expected_models.items():
            schema = paths[path][method]['responses']['200']['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

    def test_person_chain_routes_publish_response_models(self):
        """CHAIN-010: the person view routes publish stable schemas."""
        paths = app.openapi()['paths']
        expected_models = {
            ('/api/chains/person', 'get'): 'PersonSummaryResponse',
            ('/api/chains/person/search', 'get'): 'PersonSearchResponse',
        }
        for (path, method), model_name in expected_models.items():
            schema = paths[path][method]['responses']['200']['content']['application/json']['schema']
            self.assertEqual(schema['$ref'], f'#/components/schemas/{model_name}')

    def test_sensitive_route_surface_is_fully_published(self):
        """AUD-API-001: the earlier `expected` set only sampled a handful of
        paths, leaving ~14+ cmdb.py routes (all of Identity Administration,
        SIA and the PAM technical catalogs) and entire mutation-heavy
        modules (safe_write.py, access_control.py, users.py,
        safe_lifecycle.py) unasserted. A route silently dropped, renamed, or
        losing its permission `dependencies=[...]` would not fail any test.

        This asserts every path+method these five modules declare in code
        (grepped from their @router.* decorators) is present in the
        generated OpenAPI schema -- catching a route disappearing from the
        published contract, not just from Python imports.
        """
        paths = app.openapi()['paths']

        # path -> set of expected HTTP methods
        expected_methods: dict[str, set[str]] = {
            # cmdb.py -- Netskope, Identity Administration, PAM technical catalogs, SIA
            '/api/cmdb/coverage': {'get'},
            '/api/cmdb/netskope/users': {'get'},
            '/api/cmdb/netskope/devices': {'get'},
            '/api/cmdb/netskope/devices/{device_id}/history': {'get'},
            '/api/cmdb/netskope/devices/facets': {'get'},
            '/api/cmdb/netskope/devices/freshness': {'get'},
            '/api/cmdb/netskope/devices/client-events': {'get'},
            '/api/cmdb/netskope/devices/changes': {'get'},
            '/api/cmdb/netskope/devices/client-compliance': {'get'},
            '/api/cmdb/netskope/devices/fleet': {'get'},
            '/api/cmdb/netskope/devices/duplicates': {'get'},
            '/api/netskope/baselines': {'get'},
            '/api/netskope/baselines/client-golden-releases': {'put'},
            '/api/netskope/baselines/os-minimum-versions': {'put'},
            '/api/cmdb/netskope/metrics': {'get'},
            '/api/cmdb/netskope/alerts': {'get'},
            '/api/cmdb/netskope/observed-policies': {'get'},
            '/api/cmdb/identity-users': {'get'},
            '/api/cmdb/identity-users/{object_id}': {'get'},
            '/api/cmdb/identity-users/{object_id}/pam-chain': {'get'},
            '/api/cmdb/identity-roles': {'get'},
            '/api/cmdb/identity-roles/member-matches': {'get'},
            '/api/cmdb/identity-roles/{object_id}': {'get'},
            '/api/cmdb/identity-federations': {'get'},
            '/api/cmdb/identity-federations/{object_id}': {'get'},
            '/api/cmdb/pam-roles': {'get'},
            '/api/cmdb/pam-roles/{object_id}': {'get'},
            '/api/cmdb/pam-users': {'get'},
            '/api/cmdb/pam-users/{object_id}/chain': {'get'},
            '/api/cmdb/pam-platforms': {'get'},
            '/api/cmdb/pam-platform-targets': {'get'},
            '/api/cmdb/pam-connectors': {'get'},
            '/api/cmdb/pam-psm-connector-types': {'get'},
            '/api/cmdb/pam-components': {'get'},
            '/api/cmdb/pam-platform-catalogs': {'get'},
            '/api/cmdb/access-assets': {'get'},
            '/api/cmdb/sia-policies': {'get'},
            '/api/cmdb/sia-policies/{object_id}': {'get'},
            '/api/cmdb/sia-destinations': {'get'},
            '/api/cmdb/sia-connectors': {'get'},
            '/api/cmdb/sia-resources': {'get'},
            '/api/cmdb/sia-database-accounts': {'get'},
            '/api/cmdb/sia-target-sets': {'get'},
            # safe_write.py -- mutation-only, permission-gated
            '/api/accounts/{safe_number}/{account_id}/classification': {'patch'},
            '/api/safes/{safe_number}/assignment': {'patch'},
            '/api/safes/{safe_number}/scope': {'patch'},
            '/api/safes/{safe_number}/account-type': {'patch'},
            '/api/safes/bulk-assignment': {'post'},
            '/api/safes/{safe_number}/metadata': {'patch'},
            '/api/safes/{safe_number}/quick-update': {'patch'},
            # analytics.py -- read-only account management summary
            '/api/analytics/account-management': {'get'},
            # safe_lifecycle.py -- read-only, gate inherited from the safes router (AUD-SEC-002)
            '/api/safes/{safe_number}/audit': {'get'},
            '/api/lifecycle/retired': {'get'},
            # access_control.py -- prefix /api/access, access:manage-gated
            '/api/access/permissions': {'get', 'post'},
            '/api/access/roles': {'get', 'post'},
            '/api/access/domains': {'get'},
            '/api/access/roles/composite': {'post'},
            '/api/access/roles/{role_code}': {'patch'},
            '/api/access/roles/{role_code}/composite': {'patch'},
            # users.py -- local user admin, access:manage-gated
            '/api/auth/users': {'get', 'post'},
            '/api/auth/people': {'get'},
            '/api/auth/users/{user_id}': {'patch', 'delete'},
            '/api/auth/users/{user_id}/reissue-temp-password': {'post'},
        }

        missing_paths = sorted(set(expected_methods) - set(paths))
        self.assertEqual(missing_paths, [], f"routes missing from the published OpenAPI contract: {missing_paths}")

        mismatched: list[str] = []
        for path, methods in expected_methods.items():
            published = set(paths[path])
            if not methods.issubset(published):
                mismatched.append(f"{path}: expected {sorted(methods)}, published {sorted(published)}")
        self.assertEqual(mismatched, [], "method mismatch:\n" + "\n".join(mismatched))

    def test_sensitive_mutation_routes_publish_a_real_summary_and_description(self):
        """AUD-API-003: access_control.py and safe_write.py had zero
        summary/description across every operation, so Swagger showed raw
        function names (e.g. "Create Role Route") for the entire access-
        control and Safe-mutation surface. This asserts every mutating
        operation in those two modules publishes a non-empty, non-default
        summary and description -- FastAPI's function-name fallback summary
        always title-cases the function name and never contains a colon or
        a lowercase word describing a permission, so checking for those is
        enough to catch a reintroduced gap without hard-coding exact copy.
        """
        paths = app.openapi()['paths']
        operations = [
            ('/api/access/permissions', 'post'), ('/api/access/roles', 'post'),
            ('/api/access/roles/composite', 'post'), ('/api/access/roles/{role_code}', 'patch'),
            ('/api/access/roles/{role_code}/composite', 'patch'),
            ('/api/accounts/{safe_number}/{account_id}/classification', 'patch'),
            ('/api/safes/{safe_number}/assignment', 'patch'), ('/api/safes/{safe_number}/scope', 'patch'),
            ('/api/safes/{safe_number}/account-type', 'patch'), ('/api/safes/bulk-assignment', 'post'),
            ('/api/safes/{safe_number}/metadata', 'patch'), ('/api/safes/{safe_number}/quick-update', 'patch'),
        ]
        for path, method in operations:
            operation = paths[path][method]
            summary = operation.get('summary') or ''
            description = operation.get('description') or ''
            self.assertTrue(summary, f"{method.upper()} {path} has no summary")
            self.assertNotRegex(summary, r'^[A-Z][a-z]+( [A-Z][a-z]+)* Route$', f"{method.upper()} {path} still has the auto-generated function-name summary: {summary!r}")
            self.assertIn('Requiere', description, f"{method.upper()} {path} description doesn't name the required permission")

    def test_openapi_documents_authentication_and_public_boundaries(self):
        schema = app.openapi()
        schemes = schema['components']['securitySchemes']
        self.assertEqual(schemes['sessionCookie']['in'], 'cookie')
        self.assertEqual(schemes['accessToken']['name'], 'X-Access-Token')
        self.assertEqual(schemes['bootstrapToken']['name'], 'X-Bootstrap-Token')
        self.assertEqual(schemes['apiBearer']['scheme'], 'bearer')
        self.assertEqual(schema['paths']['/api/auth/status']['get']['security'], [])
        self.assertEqual(schema['paths']['/api/safes']['get']['security'], [{'sessionCookie': []}, {'apiBearer': []}])
        self.assertEqual(schema['paths']['/api/safes/{safe_number}/metadata']['patch']['security'], [{'sessionCookie': []}, {'accessToken': []}])
        self.assertEqual(schema['paths']['/api/auth/api-tokens']['post']['security'], [{'sessionCookie': []}])
        self.assertEqual(schema['paths']['/api/auth/api-tokens']['get']['security'], [{'sessionCookie': []}])
        self.assertEqual(schema['paths']['/api/auth/api-tokens/{token_id}']['delete']['security'], [{'sessionCookie': []}])
        self.assertEqual(
            schema['paths']['/api/cmdb/netskope/devices']['get']['security'],
            [{'sessionCookie': []}, {'apiBearer': []}],
        )
        self.assertIn('No se exponen secretos', schema['info']['description'])
        self.assertIn('Netskope', schema['info']['description'])
        self.assertEqual(schema['paths']['/api/auth/users']['get']['summary'], 'Listar usuarios de Custodia')
        self.assertEqual(schema['paths']['/api/auth/login']['post']['summary'], 'Iniciar sesión local')
        self.assertTrue(schema['paths']['/api/auth/login']['post']['description'])
        self.assertTrue(schema['paths']['/api/safes']['get']['summary'])
        safe_parameters = {parameter['name']: parameter for parameter in schema['paths']['/api/safes']['get']['parameters']}
        self.assertFalse(safe_parameters['include_accounts']['schema']['default'])
        self.assertIn('cuentas activas', safe_parameters['include_accounts']['description'])

    def test_every_operation_has_one_real_tag_declared_and_grouped(self):
        """Tags drive the reference sidebar. Every operation must carry
        exactly one tag, that tag must be declared, its parent chain must
        resolve inside the declared tree, and the x-tagGroups fallback must
        cover every tag that actually has operations exactly once."""
        schema = app.openapi()
        operations = [
            (path, method, operation)
            for path, item in schema['paths'].items()
            for method, operation in item.items()
            if method in {'get', 'post', 'put', 'patch', 'delete'}
        ]
        declared = {tag['name'] for tag in schema['tags']}
        tagged = set()
        for path, method, operation in operations:
            tags = operation.get('tags') or []
            self.assertEqual(len(tags), 1, f"{method.upper()} {path} must have exactly one tag, got {tags}")
            self.assertIn(tags[0], declared, f"{method.upper()} {path} uses undeclared tag {tags[0]!r}")
            tagged.add(tags[0])
        for tag in schema['tags']:
            parent = tag.get('parent')
            if parent is not None:
                self.assertIn(parent, declared, f"tag {tag['name']!r} has undeclared parent {parent!r}")
        grouped = [tag for group in schema['x-tagGroups'] for tag in group['tags']]
        self.assertEqual(len(grouped), len(set(grouped)), 'a tag appears in more than one x-tagGroups entry')
        self.assertEqual(set(grouped), tagged, 'x-tagGroups must cover every operation-bearing tag exactly once')

    def test_reference_sidebar_nests_domains_and_tools(self):
        """The sidebar is a two/three-level tree, not a flat tag list:
        Uso general -> Plataforma / Operación, CyberArk -> PAM ->
        Safes/Catálogos, and Netskope -> its two surfaces."""
        schema = app.openapi()
        parents = {tag['name']: tag.get('parent') for tag in schema['tags']}
        expected_parents = {
            'General': None, 'CyberArk': None, 'Netskope': None,
            'Plataforma': 'General', 'Operación': 'General',
            'Salud y estado': 'Plataforma', 'Ingesta': 'Operación',
            'PAM': 'CyberArk', 'Safes': 'PAM', 'Catálogos': 'PAM',
            'Identity Administration': 'CyberArk', 'SIA': 'CyberArk',
            'Access space': 'CyberArk',
            'Inventario Netskope': 'Netskope', 'Postura Netskope': 'Netskope',
        }
        for name, parent in expected_parents.items():
            self.assertEqual(parents.get(name), parent, f"tag {name!r} has the wrong parent")
        display_names = {tag['name']: tag.get('x-displayName') for tag in schema['tags']}
        self.assertEqual(display_names['General'], 'Uso general')
        self.assertEqual(display_names['Operación'], 'Operación y analítica')
        # Section tags must not carry operations themselves, except PAM which
        # Scalar renders as both a tool entry and a group.
        operation_tags = {
            tag
            for item in schema['paths'].values()
            for method, operation in item.items()
            if method in {'get', 'post', 'put', 'patch', 'delete'}
            for tag in (operation.get('tags') or [])
        }
        for section in ('General', 'Plataforma', 'Operación', 'CyberArk', 'Netskope'):
            self.assertNotIn(section, operation_tags, f"section tag {section!r} must not tag operations")

    def test_every_operation_publishes_a_real_summary_and_description(self):
        """AUD-API-003 follow-up: the mutation-only check missed read routes
        and auth/profile endpoints still showing FastAPI's function-name
        fallback (e.g. "List People Route") or no description at all. Every
        published operation must carry operator-facing copy."""
        schema = app.openapi()
        auto_summary = re.compile(r'^[A-Z][a-z]+( [A-Z][a-z]+)* Route$')
        for path, item in schema['paths'].items():
            for method, operation in item.items():
                if method not in {'get', 'post', 'put', 'patch', 'delete'}:
                    continue
                summary = operation.get('summary') or ''
                self.assertTrue(summary, f"{method.upper()} {path} has no summary")
                self.assertNotRegex(
                    summary, auto_summary,
                    f"{method.upper()} {path} still has the auto-generated function-name summary: {summary!r}",
                )
                self.assertTrue(operation.get('description'), f"{method.upper()} {path} has no description")

        management_description = schema['paths']['/api/analytics/account-management']['get']['description']
        self.assertIn('No es rotación', management_description)

    def test_authenticated_operations_document_401_and_403(self):
        """The reference must map authorization, not just success: every
        non-public operation publishes both rejection paths with the shared
        ErrorResponse model, and public operations do not claim to require
        credentials."""
        schema = app.openapi()
        error_schema = schema['components']['schemas']['ErrorResponse']
        self.assertEqual(error_schema['properties']['detail']['type'], 'string')
        for path, item in schema['paths'].items():
            for method, operation in item.items():
                if method not in {'get', 'post', 'put', 'patch', 'delete'}:
                    continue
                responses = operation.get('responses', {})
                if operation.get('security') == []:
                    self.assertNotIn('401', responses, f"{method.upper()} {path} is public but documents 401")
                    continue
                for status_code in ('401', '403'):
                    self.assertIn(status_code, responses, f"{method.upper()} {path} does not document {status_code}")
                    ref = responses[status_code]['content']['application/json']['schema']['$ref']
                    self.assertEqual(ref, '#/components/schemas/ErrorResponse')

    def test_reference_publishes_platform_tag_groups_and_code_samples(self):
        schema = app.openapi()
        groups = [group['name'] for group in schema['x-tagGroups']]
        self.assertEqual(groups, ['Uso general', 'CyberArk', 'Netskope'])
        sample_operations = {
            ('/api/auth/login', 'post'),
            ('/api/auth/api-tokens', 'post'),
            ('/api/safes', 'get'),
            ('/api/accounts/{safe_number}/{account_id}/classification', 'patch'),
        }
        for path, method in sample_operations:
            samples = schema['paths'][path][method].get('x-codeSamples') or []
            self.assertTrue(samples, f"{method.upper()} {path} has no x-codeSamples")
            for sample in samples:
                self.assertTrue(sample.get('lang'), f"{method.upper()} {path} sample without lang")
                self.assertTrue(sample.get('source'), f"{method.upper()} {path} sample without source")
        for model_name in (
            'LocalLogin', 'ApiTokenCreate',
            'AccountInventoryClassificationUpdate', 'SafeAssignmentUpdate',
        ):
            self.assertTrue(
                schema['components']['schemas'][model_name].get('example'),
                f'{model_name} publishes no example payload',
            )


if __name__ == '__main__':
    unittest.main()
