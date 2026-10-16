from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from app.cyberark.identity_administration.identity_admin_sync import sync_identity_admin_inventory
from app.cyberark.identity_administration.repositories.identity_admin_queries import get_identity_membership_data, get_identity_user_detail, list_identity_roles
from app.cyberark.identity_administration.services.identity_membership import membership_graph
from app.cyberark.identity_administration.api.routes.cmdb_identity_models import IdentityMembershipResponse
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class IdentityMembershipPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.run_ids = []
        self.addAsyncCleanup(self.cleanup)

    async def cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM cyberark_inventory_relationships WHERE source_object_id IN (SELECT object_id FROM cyberark_inventory_objects WHERE source_id LIKE 'layers-test-%%') OR target_object_id IN (SELECT object_id FROM cyberark_inventory_objects WHERE source_id LIKE 'layers-test-%%')")
            await conn.execute("DELETE FROM cyberark_inventory_objects WHERE source_id LIKE 'layers-test-%%'")
            for run_id in self.run_ids:
                await conn.execute("DELETE FROM cyberark_ingestion_runs WHERE run_id = %s", (run_id,))
            await conn.commit()

    async def sync(self, groups, users=None, directory_users=None):
        run_id = uuid4()
        self.run_ids.append(run_id)
        async with self.pool.connection() as conn:
            await conn.execute("INSERT INTO cyberark_ingestion_runs(run_id,source_file,status) VALUES (%s,'identity-administration-scim','running')", (run_id,))
            await conn.commit()
        @asynccontextmanager
        async def client():
            class Client:
                async def get_users(self, **kwargs):
                    rows = users if users is not None else [{"id": "layers-test-user", "userName": "Test User", "active": True}]
                    return rows, len(rows)
                async def get_directory_user(self, source_id):
                    if isinstance(directory_users, Exception):
                        raise directory_users
                    return (directory_users or {}).get(source_id)
                async def get_roles(self, **kwargs):
                    return groups, len(groups)
            yield Client()
        with patch('app.cyberark.identity_administration.identity_admin_sync.IdentityAdminSettings.from_environment', return_value=SimpleNamespace(federations_path='')), patch('app.cyberark.identity_administration.identity_admin_sync.IdentityAdminClient', side_effect=lambda _: client()):
            return await sync_identity_admin_inventory(self.pool, run_id)

    async def test_directory_user_is_persisted_and_failed_lookup_preserves_snapshot(self):
        group = {"id": "layers-test-service-role", "displayName": "Service Role", "members": [{"value": "layers-test-service", "type": "User"}]}
        directory_user = {"id": "layers-test-service", "userName": "okta_scim@example.com", "record_source": "identity_directory", "service_user_basis": "sdk_in_everybody_role", "urn:ietf:params:scim:schemas:cyberark:1.0:User": {"serviceUser": True, "oauthClient": True}}
        await self.sync([group], users=[], directory_users={"layers-test-service": directory_user})
        listing = await list_identity_roles(self.pool, 'Service Role', 50, 0)
        root = listing['rows'][0]['object_id']
        nodes, edges = await get_identity_membership_data(self.pool, root)
        graph = membership_graph(root, nodes, edges)
        account = next(node for node in graph['nodes'] if node['kind'] == 'user')
        user, roles = await get_identity_user_detail(self.pool, account['object_id'])
        self.assertTrue(user['attributes']['service_user'])
        self.assertIsNone(user['attributes']['active'])
        self.assertEqual(user['attributes']['record_source'], 'identity_directory')
        self.assertEqual([role['display_name'] for role in roles], ['Service Role'])
        self.assertEqual(listing['rows'][0]['attributes']['unresolved_member_count'], 0)
        degraded = await self.sync([group], users=[], directory_users=RuntimeError('lookup failed'))
        self.assertEqual(degraded['retired_objects'], 0)
        async with self.pool.connection() as conn:
            cursor = await conn.execute("SELECT stage, status, error_kind FROM sync_run_stages WHERE run_id = %s ORDER BY position", (self.run_ids[-1],))
            stages = [(row['stage'], row['status'], row['error_kind']) for row in await cursor.fetchall()]
        self.assertIn(('members_directory', 'failed', 'RuntimeError'), stages)
        user, roles = await get_identity_user_detail(self.pool, account['object_id'])
        self.assertIsNotNone(user)
        self.assertEqual(len(roles), 1)
        await self.sync([{**group, 'members': []}], users=[])
        user, roles = await get_identity_user_detail(self.pool, account['object_id'])
        self.assertIsNone(user)
        self.assertEqual(roles, [])

    async def test_complete_sync_preserves_layers_and_retires_deleted_roles_and_memberships(self):
        parent = {"id": "layers-test-parent", "displayName": "Layers Parent", "members": [{"value": "layers-test-group", "type": "Group"}]}
        group = {"id": "layers-test-group", "displayName": "sg_cyberark_layers", "members": [
            {"value": "layers-test-user", "type": "User"},
            {"value": "layers-test-admin", "type": "User"},
            {"value": "layers-test-missing", "type": "User", "display": "apiuser@cyberark.cloud", "$ref": "https://private.example/Users/missing"},
        ]}
        await self.sync([parent, group], users=[
            {"id": "layers-test-user", "userName": "person@example.com", "emails": [{"value": "same@example.com"}], "active": True},
            {"id": "layers-test-admin", "userName": "admin@cyberark.cloud", "emails": [{"value": "same@example.com"}], "active": True},
        ])
        listing = await list_identity_roles(self.pool, 'Layers Parent', 50, 0)
        parent_id = listing['rows'][0]['object_id']
        async with self.pool.connection() as conn:
            cursor = await conn.execute("INSERT INTO cyberark_inventory_objects(source_id,object_type,display_name,source_system) VALUES ('layers-test-pam-user','user','PAM only','cyberark') RETURNING object_id")
            pam_user = (await cursor.fetchone())['object_id']
            await conn.execute("INSERT INTO cyberark_inventory_relationships(source_object_id,target_object_id,relationship_type) VALUES (%s,%s,'identity_member_of')", (pam_user, parent_id))
            await conn.commit()
        nodes, edges = await get_identity_membership_data(self.pool, parent_id)
        graph = membership_graph(parent_id, nodes, edges)
        IdentityMembershipResponse.model_validate(graph)
        self.assertEqual({node['kind'] for node in graph['nodes']}, {'role', 'okta_group', 'user'})
        self.assertEqual(len(graph['edges']), 3)
        group_node = next(node for node in graph['nodes'] if node['kind'] == 'okta_group')
        self.assertEqual(group_node['direct_member_count'], 3)
        self.assertEqual(group_node['unresolved_members'], [{'display_name': 'apiuser@cyberark.cloud', 'kind': 'user'}])
        self.assertEqual({node['user_name'] for node in graph['nodes'] if node['kind'] == 'user'}, {'person@example.com', 'admin@cyberark.cloud'})
        group_id = next(node['object_id'] for node in graph['nodes'] if node['kind'] == 'okta_group')
        user_id = next(node['object_id'] for node in graph['nodes'] if node['kind'] == 'user' and node['user_name'] == 'person@example.com')
        # A failed/malformed response must leave the previous complete snapshot intact.
        with self.assertRaises(ValueError):
            await self.sync([{**parent, 'members': [{'type': 'Group'}]}])
        nodes, edges = await get_identity_membership_data(self.pool, parent_id)
        self.assertEqual(len(membership_graph(parent_id, nodes, edges)['edges']), 3)
        result = await self.sync([{**parent, 'members': []}])
        self.assertGreaterEqual(result['retired_objects'], 1)
        nodes, edges = await get_identity_membership_data(self.pool, parent_id)
        self.assertIsNone(membership_graph(group_id, nodes, edges))
        self.assertEqual(len(membership_graph(parent_id, nodes, edges)['nodes']), 1)
        groups = await list_identity_roles(self.pool, 'sg_cyberark_layers', 50, 0)
        self.assertEqual(groups['rows'], [])

        await self.sync([{**parent, 'members': []}], users=[])
        user, roles = await get_identity_user_detail(self.pool, user_id)
        self.assertIsNone(user, 'A retired user must not remain accessible as a current identity')
        self.assertEqual(roles, [])

    async def test_omitted_members_is_empty_and_retires_previous_memberships(self):
        group = {"id": "layers-test-empty-role", "displayName": "Empty Role", "members": [
            {"value": "layers-test-user", "type": "User"},
        ]}
        await self.sync([group])
        await self.sync([{"id": "layers-test-empty-role", "displayName": "Empty Role"}])

        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                "SELECT attributes->>'membership_status' AS membership_status, "
                "       (attributes->>'direct_member_count')::int AS direct_member_count "
                "FROM cyberark_inventory_objects "
                "WHERE source_system = 'identity_administration' AND object_type = 'role' "
                "AND source_id = 'layers-test-empty-role' AND lifecycle_status = 'active'"
            )
            role = await cursor.fetchone()
            cursor = await conn.execute(
                "SELECT count(*) FROM cyberark_inventory_relationships rel "
                "JOIN cyberark_inventory_objects target ON target.object_id = rel.target_object_id "
                "WHERE target.source_system = 'identity_administration' "
                "AND target.source_id = 'layers-test-empty-role' "
                "AND rel.relationship_type = 'identity_member_of' "
                "AND rel.lifecycle_status = 'active'"
            )
            active_memberships = (await cursor.fetchone())["count"]

        self.assertEqual(role["membership_status"], "complete")
        self.assertEqual(role["direct_member_count"], 0)
        self.assertEqual(active_memberships, 0)
