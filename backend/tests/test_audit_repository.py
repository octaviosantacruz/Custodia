import asyncio
import unittest
from unittest.mock import AsyncMock

from app.repositories.audit import record_audit


class AuditRepositoryTests(unittest.TestCase):
    def test_record_audit_uses_existing_connection(self):
        connection = AsyncMock()
        asyncio.run(record_audit(
            object(),
            connection=connection,
            actor_id='admin@example.com',
            action='update',
            entity_type='user',
            entity_id='target@example.com',
            before_data={'is_active': True},
            after_data={'is_active': False},
        ))

        connection.execute.assert_awaited_once()
        query, params = connection.execute.await_args.args
        self.assertIn('INSERT INTO public.access_audit_log', query)
        self.assertEqual(params[:4], ('admin@example.com', 'update', 'user', 'target@example.com'))


if __name__ == '__main__':
    unittest.main()
