import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.repositories.findings import collect_current_findings, list_findings, refresh_findings, update_finding


class _Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False


class _Connection:
    def __init__(self):
        self.calls = []

    def transaction(self):
        return _Transaction()

    async def execute(self, query, params=()):
        self.calls.append((query, params))


class _ConnectionContext:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_):
        return False


class _Pool:
    def __init__(self):
        self.connection_instance = _Connection()

    def connection(self):
        return _ConnectionContext(self.connection_instance)


class FindingsRepositoryTests(unittest.TestCase):
    def test_current_rules_are_read_only_and_do_not_select_secrets(self):
        with patch('app.repositories.findings.fetch_all', new=AsyncMock(return_value=[])) as fetch:
            asyncio.run(collect_current_findings(object()))

        query = fetch.await_args.args[1]
        for rule_id in (
            'SAFE_NO_ACTIVE_ACCOUNTS',
            'ACCOUNT_PLATFORM_MISSING',
            'ACCOUNT_PLATFORM_PARTIAL',
        ):
            self.assertIn(rule_id, query)
        self.assertNotIn('SAFE_OLAC_DISABLED', query)
        self.assertNotIn('password', query.lower())
        self.assertNotIn('secret', query.lower())

    def test_list_findings_uses_parameterized_filters_and_pagination(self):
        rows = [{
            'finding_id': 4,
            'rule_id': 'SAFE_OLAC_DISABLED',
            'rule_version': '1',
            'source_system': 'cyberark',
            'subject_type': 'safe',
            'subject_id': '24',
            'title': 'OLAC desactivado',
            'severity': 'high',
            'category': 'non_compliance',
            'status': 'open',
            'evidence': {'safe_number': 24},
            'total_count': 1,
        }]
        with patch('app.repositories.findings.fetch_all', new=AsyncMock(return_value=rows)) as fetch:
            result = asyncio.run(list_findings(object(), 'open', 'SAFE_OLAC_DISABLED', 'high', 20, 40))

        self.assertEqual(result['total'], 1)
        self.assertEqual(result['rows'][0]['finding_id'], 4)
        self.assertNotIn('total_count', result['rows'][0])
        query, params = fetch.await_args.args[1:]
        self.assertNotIn('SAFE_OLAC_DISABLED', query)
        self.assertEqual(params, ('SAFE_OLAC_DISABLED', 'open', 'SAFE_OLAC_DISABLED', 'high', 20, 40))
        self.assertEqual(query.count('%s'), len(params))

    def test_list_findings_can_exclude_explicitly_internal_safes_and_accounts(self):
        with patch('app.repositories.findings.fetch_all', new=AsyncMock(return_value=[])) as fetch:
            asyncio.run(list_findings(object(), limit=20, offset=0, include_internal=False))

        query, params = fetch.await_args.args[1:]
        self.assertIn("cyberark_safe_metadata", query)
        self.assertIn("inventory_scope", query)
        self.assertIn("inventory_account_type", query)
        self.assertEqual(params, ('SAFE_OLAC_DISABLED', 20, 0))

    def test_refresh_upserts_current_findings_and_marks_missing_open_findings_resolved(self):
        pool = _Pool()
        current = [{
            'rule_id': 'ACCOUNT_PLATFORM_MISSING',
            'rule_version': '1',
            'source_system': 'cyberark',
            'subject_type': 'account',
            'subject_id': 'account-1',
            'title': 'Cuenta sin plataforma informada',
            'severity': 'medium',
            'category': 'data_quality',
            'evidence': {'account_id': 'account-1'},
        }]
        with patch('app.repositories.findings.collect_current_findings', new=AsyncMock(return_value=current)):
            count = asyncio.run(refresh_findings(pool, 'run-1'))

        self.assertEqual(count, 1)
        self.assertEqual(len(pool.connection_instance.calls), 5)
        insert_query, insert_params = pool.connection_instance.calls[0]
        self.assertIn('ON CONFLICT', insert_query)
        self.assertEqual(insert_params[:5], ('ACCOUNT_PLATFORM_MISSING', '1', 'cyberark', 'account', 'account-1'))
        resolution_queries = [call[0] for call in pool.connection_instance.calls[1:]]
        self.assertTrue(all("status = 'resolved'" in query for query in resolution_queries))
        olac_resolution = pool.connection_instance.calls[2]
        self.assertIn('AND TRUE', olac_resolution[0])
        self.assertEqual(olac_resolution[1], ('SAFE_OLAC_DISABLED',))

    def test_update_finding_returns_the_persisted_row(self):
        row = {'finding_id': 4, 'status': 'acknowledged'}
        with patch('app.repositories.findings.fetch_one', new=AsyncMock(return_value=row)) as fetch:
            result = asyncio.run(update_finding(object(), 4, 'acknowledged', None, None))

        self.assertEqual(result, row)
        query, params = fetch.await_args.args[1:]
        self.assertIn('RETURNING *', query)
        self.assertEqual(params, ('acknowledged', None, None, 'acknowledged', 4))


if __name__ == '__main__':
    unittest.main()
