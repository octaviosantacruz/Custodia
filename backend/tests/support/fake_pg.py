"""Shared fake psycopg-style pool/connection/cursor stack for unit tests
that exercise repository functions without a real database. Mirrors just
the async context-manager surface (`pool.connection()`, `connection.cursor()`,
`connection.transaction()`) and cursor methods (`execute`, `fetchone`,
`fetchall`, `executemany`) that the repositories under test call."""

from unittest.mock import AsyncMock


class AsyncContext:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, exc_type, exc_value, traceback):
        return False


class FakeCursor:
    def __init__(self, fetchone_values, fetchall_values=None):
        self.execute_calls = []
        self.fetchone_values = list(fetchone_values)
        self.fetchall_values = list(fetchall_values or [])

    async def execute(self, query, params=()):
        self.execute_calls.append((query, params))

    async def fetchone(self):
        return self.fetchone_values.pop(0)

    async def fetchall(self):
        return self.fetchall_values.pop(0)

    async def executemany(self, query, seq):
        self.execute_calls.append((query, list(seq)))


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor
        self.execute = AsyncMock()

    def transaction(self):
        return AsyncContext(None)

    def cursor(self):
        return AsyncContext(self.cursor_value)


class FakePool:
    def __init__(self, connection):
        self.connection_value = connection

    def connection(self):
        return AsyncContext(self.connection_value)
