"""ADEM identity lookup must exclude other sources, devices and retired users."""

from app.netskope.sse.repositories.netskope_experience import get_experience_user, list_user_inventory_device_names
from tests.support.netskope_pg_fixtures import reset_netskope, seed_device
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class NetskopeExperiencePostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope(self.pool)
        self.addAsyncCleanup(reset_netskope, self.pool)

    async def test_only_active_netskope_user_can_supply_adem_identity(self):
        active = await seed_device(self.pool, 'adem-user', {'email': 'person@example.test'}, object_type='user')
        retired = await seed_device(self.pool, 'adem-retired', {'email': 'person@example.test'}, object_type='user', lifecycle_status='retired')
        device = await seed_device(self.pool, 'adem-device', {'email': 'person@example.test'})
        foreign = await seed_device(self.pool, 'adem-foreign', {'email': 'person@example.test'}, object_type='user')
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE public.cyberark_inventory_objects SET source_system='identity_administration' WHERE object_id=%s", (foreign,))
        try:
            self.assertEqual(await get_experience_user(self.pool, active), {'email': 'person@example.test'})
            for object_id in (retired, device, foreign, 2147483647):
                self.assertIsNone(await get_experience_user(self.pool, object_id))
        finally:
            async with self.pool.connection() as conn:
                await conn.execute('DELETE FROM public.cyberark_inventory_objects WHERE object_id=%s', (foreign,))

    async def test_inventory_device_names_are_only_the_devices_linked_to_that_user(self):
        user = await seed_device(self.pool, 'link-user', {'email': 'link@example.test'}, object_type='user')
        other = await seed_device(self.pool, 'link-other', {'email': 'other@example.test'}, object_type='user')
        mine = await seed_device(self.pool, 'dev-mine', {'hostname': 'NB-MINE', 'username': 'link@example.test'})
        await seed_device(self.pool, 'dev-theirs', {'hostname': 'NB-THEIRS', 'username': 'other@example.test'})
        await seed_device(self.pool, 'dev-nobody', {'hostname': 'NB-NOBODY', 'username': 'nobody@example.test'})
        self.assertEqual(await list_user_inventory_device_names(self.pool, user), [{'object_id': mine, 'name': 'NB-MINE'}])
        self.assertEqual([row['name'] for row in await list_user_inventory_device_names(self.pool, other)], ['NB-THEIRS'])
