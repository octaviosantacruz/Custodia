import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.repositories.account_queries import get_account_platform_coverage, get_safe_accounts, list_accounts


class AccountQueryContractTests(unittest.TestCase):
    def test_list_accounts_adds_platform_status_filter_without_interpolating_user_input(self):
        with patch('app.repositories.account_queries.fetch_all', new=AsyncMock(return_value=[])) as fetch:
            asyncio.run(list_accounts(object(), 'root', 50, 0, 'without_platform'))

        _, query, params = fetch.await_args.args
        self.assertIn('platform_id', query)
        self.assertIn('platform_name', query)
        self.assertIn('IS NULL', query)
        self.assertNotIn('root', query)
        self.assertEqual(params[:6], ('root',) * 6)
        self.assertEqual(params[-2:], (50, 0))
        self.assertEqual(query.count('%s'), len(params), 'placeholder/parameter count mismatch would raise psycopg.ProgrammingError at runtime')

    def test_account_platform_coverage_reads_only_active_accounts_and_safes(self):
        with patch('app.repositories.account_queries.fetch_all', new=AsyncMock(return_value=[{
            'accounts_active': 10, 'accounts_with_platform': 8, 'accounts_without_platform': 2,
            'accounts_with_partial_platform': 1, 'platforms_observed': 4, 'safes_without_accounts': 3,
        }])) as fetch:
            result = asyncio.run(get_account_platform_coverage(object()))

        self.assertEqual(result[0]['accounts_without_platform'], 2)
        query = fetch.await_args.args[1]
        self.assertIn("a.lifecycle_status = 'active'", query)
        self.assertIn("s.lifecycle_status = 'active'", query)
        self.assertNotIn('secret', query.lower())

    def test_list_accounts_filters_active_rows_and_preserves_pagination(self):
        rows = [{
            'safe_number': 24,
            'safe_name': 'AS400',
            'account_id': 'account-1',
            'account_name': 'Operating System-AS400',
            'user_name': 'ca_as400',
            'address': '10.0.0.1',
            'platform_id': 'platform-1',
            'platform_name': 'Unix',
            'lifecycle_status': 'active',
            'last_seen_at': '2026-08-16T00:00:00Z',
            'attributes': {},
            'total_count': 3,
        }]
        with patch('app.repositories.account_queries.fetch_all', new=AsyncMock(return_value=rows)) as fetch:
            result = asyncio.run(list_accounts(object(), 'AS400', 50, 100))

        self.assertEqual(result['total'], 3)
        self.assertEqual(result['limit'], 50)
        self.assertEqual(result['offset'], 100)
        self.assertEqual(result['rows'][0]['account_name'], 'Operating System-AS400')
        self.assertNotIn('total_count', result['rows'][0])
        _, query, params = fetch.await_args.args
        self.assertIn("a.lifecycle_status = 'active'", query)
        self.assertNotIn('AS400', query)
        self.assertEqual(params[-2:], (50, 100))
        self.assertEqual(query.count('%s'), len(params), 'placeholder/parameter count mismatch would raise psycopg.ProgrammingError at runtime')

    def test_safe_accounts_returns_zero_for_empty_result(self):
        with patch('app.repositories.account_queries.fetch_all', new=AsyncMock(return_value=[])) as fetch:
            result = asyncio.run(get_safe_accounts(object(), 24, 'root', 20, 40))

        self.assertEqual(result, {'rows': [], 'total': 0, 'limit': 20, 'offset': 40})
        _, query, params = fetch.await_args.args
        self.assertIn('a.safe_number = %s', query)
        self.assertIn("a.lifecycle_status = 'active'", query)
        self.assertEqual(params[0], 24)
        self.assertEqual(params[-2:], (20, 40))
        self.assertEqual(query.count('%s'), len(params), 'placeholder/parameter count mismatch would raise psycopg.ProgrammingError at runtime')


if __name__ == '__main__':
    unittest.main()
