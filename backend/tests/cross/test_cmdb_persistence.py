"""Regression tests for the shared relationship persistence boundary (B2).

The new rules are: an edge towards a currently retired endpoint is never
reactivated, and a complete run retires active edges whose endpoint is already
retired — scoped to the run's source_system, so one source never touches
another's edges.
"""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.cross.cmdb_sync import sync_inventory_snapshot
from app.cross.services.cmdb_models import InventoryRelationship
from app.cross.repositories.cmdb_persistence import (
    retire_relationships_with_retired_endpoints,
    upsert_relationships,
)


class _FakeCursor:
    def __init__(self, fetchall_batches=None, rowcount=0):
        self.executed = []
        self._fetchall_batches = list(fetchall_batches or [])
        self.rowcount = rowcount

    async def execute(self, sql, params=()):
        self.executed.append((" ".join(sql.split()), params))

    async def fetchall(self):
        return self._fetchall_batches.pop(0) if self._fetchall_batches else []

    async def executemany(self, sql, params):
        self.executed.append((" ".join(sql.split()), list(params)))

    def _inserted_edges(self):
        return [params for sql, params in self.executed if sql.startswith("INSERT")]


def _endpoint_row(source_id, lifecycle_status):
    return {
        "object_id": 2, "source_system": "cyberark", "object_type": "psm",
        "source_id": source_id, "lifecycle_status": lifecycle_status,
    }


class UpsertRelationshipsRetiredEndpointTests(unittest.TestCase):
    def test_skips_edge_towards_a_retired_endpoint(self):
        cursor = _FakeCursor(fetchall_batches=[[_endpoint_row("PSM-OLD", "retired")]])
        relationship = InventoryRelationship("platform", "P1", "psm", "PSM-OLD", "platform_uses_psm")

        skipped = asyncio.run(upsert_relationships(
            cursor, [relationship], {("cyberark", "platform", "P1"): 1}, None,
        ))

        self.assertEqual(skipped, 1)
        self.assertEqual(cursor._inserted_edges(), [[]])

    def test_inserts_edge_when_loaded_endpoint_is_active(self):
        cursor = _FakeCursor(fetchall_batches=[[_endpoint_row("PSM-1", "active")]])
        relationship = InventoryRelationship("platform", "P1", "psm", "PSM-1", "platform_uses_psm")

        skipped = asyncio.run(upsert_relationships(
            cursor, [relationship], {("cyberark", "platform", "P1"): 1}, "run-1",
        ))

        self.assertEqual(skipped, 0)
        inserted = cursor._inserted_edges()
        self.assertEqual(len(inserted), 1)
        self.assertEqual(inserted[0][0][:4], (1, 2, "platform_uses_psm", "run-1"))


class RetireOrphanRelationshipsTests(unittest.TestCase):
    def test_retires_active_edges_with_retired_endpoints_scoped_to_source(self):
        cursor = _FakeCursor(rowcount=3)

        retired = asyncio.run(retire_relationships_with_retired_endpoints(cursor, "cyberark"))

        self.assertEqual(retired, 3)
        sql, params = cursor.executed[-1]
        self.assertIn("r.lifecycle_status = 'active'", sql)
        self.assertIn("s.lifecycle_status = 'retired'", sql)
        self.assertIn("t.lifecycle_status = 'retired'", sql)
        self.assertIn("o.source_system = %s", sql)
        self.assertIn("COALESCE(r.retired_at, now())", sql)
        self.assertEqual(params, ("cyberark",))

    def test_is_a_noop_when_the_source_has_no_edges(self):
        cursor = _FakeCursor(rowcount=0)
        self.assertEqual(asyncio.run(retire_relationships_with_retired_endpoints(cursor, "netskope")), 0)


class _AsyncContext:
    def __init__(self, value):
        self._value = value

    async def __aenter__(self):
        return self._value

    async def __aexit__(self, *exc):
        return False


class _FakeConnection:
    def transaction(self):
        return _AsyncContext(self)

    def cursor(self):
        return _AsyncContext(_FakeCursor())


class _FakePool:
    def connection(self):
        return _AsyncContext(_FakeConnection())


class SyncSnapshotOrphanStepTests(unittest.TestCase):
    def _run(self, *, flag, source_system="cyberark"):
        with patch("app.cross.cmdb_sync.upsert_objects", new=AsyncMock(return_value={})), \
             patch("app.cross.cmdb_sync.upsert_relationships", new=AsyncMock(return_value=0)), \
             patch("app.cross.cmdb_sync.reconcile_objects", new=AsyncMock(return_value=0)), \
             patch("app.cross.cmdb_sync.reconcile_relationships", new=AsyncMock(return_value=0)), \
             patch(
                 "app.cross.cmdb_sync.retire_relationships_with_retired_endpoints",
                 new=AsyncMock(return_value=2),
             ) as orphan:
            result = asyncio.run(sync_inventory_snapshot(
                _FakePool(), [], [], source_run_id="run-1",
                source_system=source_system, retire_orphan_relationships=flag,
            ))
        return result, orphan

    def test_orphan_step_does_not_run_on_partial_or_default_runs(self):
        result, orphan = self._run(flag=False)

        self.assertEqual(result["retired_orphan_relationships"], 0)
        orphan.assert_not_awaited()

    def test_orphan_step_is_scoped_to_the_run_source_system(self):
        result, orphan = self._run(flag=True, source_system="netskope")

        self.assertEqual(result["retired_orphan_relationships"], 2)
        orphan.assert_awaited_once()
        self.assertEqual(orphan.await_args.args[1], "netskope")


if __name__ == "__main__":
    unittest.main()
