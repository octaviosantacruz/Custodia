import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.netskope.sse import netskope_sync


def _client(devices, dem_sites=None):
    client = MagicMock()
    client.get_users = AsyncMock(return_value=[])
    client.get_devices = AsyncMock(return_value=devices)
    client.get_user_counts = AsyncMock(return_value={})
    client.get_dem_sites = AsyncMock(return_value=dem_sites if dem_sites is not None else [])
    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=client)
    context.__aexit__ = AsyncMock(return_value=False)
    return context


class NetskopeSyncOrderTests(unittest.IsolatedAsyncioTestCase):
    async def test_dem_sites_are_reconciled_only_after_successful_capture(self):
        settings = MagicMock(dem_sites_path="/api/v2/dem/config/sites", alert_path="", groups_path="", policy_groups_path="", rbac_path="")
        inventory = AsyncMock(return_value={"objects": 1})
        with patch.object(netskope_sync.NetskopeSettings, "from_environment", return_value=settings), \
                patch.object(netskope_sync, "NetskopeClient", return_value=_client([], [{"id": "site:1", "name": "Site 1"}])), \
                patch.object(netskope_sync, "record_device_snapshots", AsyncMock()), \
                patch.object(netskope_sync, "sync_inventory_snapshot", inventory), \
                patch.object(netskope_sync, "capture_netskope_dlp_alerts", AsyncMock(return_value={"scanned_events": 0, "captured_alerts": 0, "partial": False, "error": False})):
            await netskope_sync.sync_netskope_inventory(MagicMock(), uuid4())
        self.assertIn("dem_site", inventory.await_args.kwargs["reconcile_object_types"])
        self.assertEqual([item.source_id for item in inventory.await_args.args[1] if item.object_type == "dem_site"], ["site:1"])

    async def test_invalid_dem_capture_cannot_retire_inventory(self):
        settings = MagicMock(dem_sites_path="/api/v2/dem/config/sites", alert_path="", groups_path="", policy_groups_path="", rbac_path="")
        inventory = AsyncMock()
        with patch.object(netskope_sync.NetskopeSettings, "from_environment", return_value=settings), \
                patch.object(netskope_sync, "NetskopeClient", return_value=_client([], [{"id": "site:1"}])), \
                patch.object(netskope_sync, "record_device_snapshots", AsyncMock()) as snapshots, \
                patch.object(netskope_sync, "sync_inventory_snapshot", inventory):
            with self.assertRaises(ValueError):
                await netskope_sync.sync_netskope_inventory(MagicMock(), uuid4())
        snapshots.assert_not_awaited()
        inventory.assert_not_awaited()

    async def test_snapshot_failure_happens_before_inventory_reconciliation(self):
        # A failed run must never retire inventory: if the snapshot write
        # fails, the inventory upsert/reconcile must not have run.
        device = {"device_id": "dev-1", "hostname": "NB-1"}
        snapshot = AsyncMock(side_effect=RuntimeError("snapshot write failed"))
        inventory = AsyncMock()
        with patch.object(netskope_sync.NetskopeSettings, "from_environment", return_value=MagicMock(groups_path="", policy_groups_path="", rbac_path="")), \
                patch.object(netskope_sync, "NetskopeClient", return_value=_client([device])), \
                patch.object(netskope_sync, "map_netskope_objects", return_value=[MagicMock(object_type="device", source_id="dev-1", attributes={})]), \
                patch.object(netskope_sync, "record_device_snapshots", snapshot), \
                patch.object(netskope_sync, "sync_inventory_snapshot", inventory):
            with self.assertRaises(RuntimeError):
                await netskope_sync.sync_netskope_inventory(MagicMock(), uuid4())

        snapshot.assert_awaited_once()
        inventory.assert_not_awaited()

    async def test_success_writes_snapshots_then_inventory_and_returns_its_result(self):
        calls = []
        snapshot = AsyncMock(side_effect=lambda *args, **kwargs: calls.append("snapshots"))

        async def inventory(*args, **kwargs):
            calls.append("inventory")
            return {"objects": 1}

        capture = AsyncMock()
        alerts = AsyncMock()
        with patch.object(netskope_sync.NetskopeSettings, "from_environment", return_value=MagicMock(groups_path="", policy_groups_path="", rbac_path="")), \
                patch.object(netskope_sync, "NetskopeClient", return_value=_client([])), \
                patch.object(netskope_sync, "map_netskope_objects", return_value=[MagicMock(object_type="device", source_id="dev-1", attributes={"hostname": "NB-1"})]), \
                patch.object(netskope_sync, "record_device_snapshots", snapshot), \
                patch.object(netskope_sync, "sync_inventory_snapshot", inventory), \
                patch.object(netskope_sync, "capture_netskope_dlp_alerts", capture), \
                patch.object(netskope_sync, "record_alert_aggregates", alerts):
            result = await netskope_sync.sync_netskope_inventory(MagicMock(), uuid4())

        self.assertEqual(calls, ["snapshots", "inventory"])
        # SYNC-TASK-001: the inventory run returns only inventory counters and
        # never captures DLP or alert aggregates.
        self.assertEqual(result, {"objects": 1, "users_all_accounts_deleted": 0})
        capture.assert_not_awaited()
        alerts.assert_not_awaited()
        self.assertEqual(snapshot.await_args.args[2], [{"source_id": "dev-1", "attributes": {"hostname": "NB-1"}}])


class NetskopeDeletedUsersTests(unittest.IsolatedAsyncioTestCase):
    """NSK-USR-001: users whose accounts are all deleted leave the snapshot, unless that looks like a changed payload."""

    async def _run(self, users):
        context = _client([])
        context.__aenter__.return_value.get_users = AsyncMock(return_value=users)
        inventory = AsyncMock(return_value={"objects": 1})
        with patch.object(netskope_sync.NetskopeSettings, "from_environment", return_value=MagicMock(groups_path="", policy_groups_path="", rbac_path="", dem_sites_path="")), \
                patch.object(netskope_sync, "NetskopeClient", return_value=context), \
                patch.object(netskope_sync, "record_device_snapshots", AsyncMock()), \
                patch.object(netskope_sync, "record_reported_counts", AsyncMock()), \
                patch.object(netskope_sync, "sync_inventory_snapshot", inventory):
            try:
                result = await netskope_sync.sync_netskope_inventory(MagicMock(), uuid4())
            except ValueError as exc:
                return exc, inventory
        return result, inventory

    @staticmethod
    def _users(live, deleted):
        row = lambda i, flag: {"id": f"u{i}", "emails": [f"u{i}@itti.digital"], "accounts": [{"scimId": f"s{i}", "active": True, "deleted": flag}]}
        return [row(i, False) for i in range(live)] + [row(live + i, True) for i in range(deleted)]

    async def test_deleted_only_users_are_left_out_and_counted(self):
        result, inventory = await self._run(self._users(95, 5))
        self.assertEqual(result["users_all_accounts_deleted"], 5)
        users = [item.source_id for item in inventory.await_args.args[1] if item.object_type == "user"]
        self.assertEqual(len(users), 95)
        self.assertNotIn("u99", users)

    async def test_a_repeated_deleted_row_counts_once(self):
        users = self._users(95, 5)
        result, _ = await self._run(users + [dict(users[-1])])
        self.assertEqual(result["users_all_accounts_deleted"], 5)

    async def test_a_user_read_both_deleted_and_alive_fails_the_read(self):
        users = self._users(95, 0)
        contradictory = {**users[0], "accounts": [{"scimId": "s0", "active": True, "deleted": True}]}
        error, inventory = await self._run(users + [contradictory])
        self.assertIsInstance(error, ValueError)
        inventory.assert_not_awaited()

    async def test_a_payload_where_most_users_look_deleted_is_rejected_before_anything_is_retired(self):
        error, inventory = await self._run(self._users(70, 30))
        self.assertIsInstance(error, ValueError)
        inventory.assert_not_awaited()


class NetskopeReportedUserTotalTests(unittest.IsolatedAsyncioTestCase):
    """NSK-REF-001: Netskope's own user total is a reference and can never fail or precede the inventory."""

    async def _run(self, counts, *, record=None, inventory=None, read_error=None):
        context = _client([])
        client = context.__aenter__.return_value
        client.get_user_counts = AsyncMock(return_value=counts, side_effect=read_error)
        record = record or AsyncMock()
        with patch.object(netskope_sync.NetskopeSettings, "from_environment", return_value=MagicMock(groups_path="", policy_groups_path="", rbac_path="", dem_sites_path="")), \
                patch.object(netskope_sync, "NetskopeClient", return_value=context), \
                patch.object(netskope_sync, "record_device_snapshots", AsyncMock()), \
                patch.object(netskope_sync, "record_reported_counts", record), \
                patch.object(netskope_sync, "sync_inventory_snapshot", inventory or AsyncMock(return_value={"objects": 1})):
            result = await netskope_sync.sync_netskope_inventory(MagicMock(), uuid4())
        return result, record

    async def test_the_total_and_its_timestamp_are_recorded_after_the_inventory_landed(self):
        order = []
        inventory = AsyncMock(side_effect=lambda *a, **k: order.append("inventory") or {"objects": 1})
        record = AsyncMock(side_effect=lambda *a, **k: order.append("record"))
        result, _ = await self._run({"totalUsers": 8859, "lastModified": 1791250161.4, "activeAccounts": 10209, "inactiveAccounts": 1987, "totalGroups": 718, "totalOUs": 141}, record=record, inventory=inventory)
        self.assertEqual(order, ["inventory", "record"])
        self.assertEqual(result, {"objects": 1, "users_all_accounts_deleted": 0})
        args = record.await_args.args
        self.assertEqual(args[2], 8859)
        self.assertEqual((args[3].tzinfo is not None, args[3].year), (True, 2026))
        self.assertEqual(args[4], {"active_accounts": 10209, "inactive_accounts": 1987, "total_groups": 718, "total_ous": 141, "repeated_user_rows": 0})

    async def test_live_rows_the_api_repeats_are_counted_exactly_and_deleted_ones_are_not(self):
        users = NetskopeDeletedUsersTests._users(10, 2)
        users += [users[0], users[1], users[10]]  # two live rows repeated, one deleted row repeated
        context = _client([])
        client = context.__aenter__.return_value
        client.get_users = AsyncMock(return_value=users)
        client.get_user_counts = AsyncMock(return_value={"totalUsers": 12})
        record = AsyncMock()
        with patch.object(netskope_sync.NetskopeSettings, "from_environment", return_value=MagicMock(groups_path="", policy_groups_path="", rbac_path="", dem_sites_path="")), \
                patch.object(netskope_sync, "NetskopeClient", return_value=context), \
                patch.object(netskope_sync, "record_device_snapshots", AsyncMock()), \
                patch.object(netskope_sync, "record_reported_counts", record), \
                patch.object(netskope_sync, "sync_inventory_snapshot", AsyncMock(return_value={"objects": 1})):
            await netskope_sync.sync_netskope_inventory(MagicMock(), uuid4())
        self.assertEqual(record.await_args.args[4]["repeated_user_rows"], 2)

    async def test_an_odd_optional_total_is_dropped_but_the_valid_ones_are_kept(self):
        _, record = await self._run({"totalUsers": 5, "activeAccounts": -1, "inactiveAccounts": "7", "totalGroups": True, "totalOUs": 3})
        self.assertEqual(record.await_args.args[4], {"active_accounts": None, "inactive_accounts": None, "total_groups": None, "total_ous": 3, "repeated_user_rows": 0})

    async def test_odd_values_are_dropped_not_stored(self):
        for counts in ({}, {"totalUsers": True}, {"totalUsers": -3}, {"totalUsers": "8859"}, {"totalUsers": 8859.5}):
            _, record = await self._run(counts)
            record.assert_not_awaited()
        _, record = await self._run({"totalUsers": 5, "lastModified": "yesterday"})
        self.assertIsNone(record.await_args.args[3])

    async def test_an_unreadable_counts_endpoint_does_not_fail_the_run(self):
        result, record = await self._run({}, read_error=netskope_sync.NetskopeError("429"))
        self.assertEqual(result, {"objects": 1, "users_all_accounts_deleted": 0})
        record.assert_not_awaited()

    async def test_a_failed_reference_write_does_not_fail_a_run_whose_inventory_landed(self):
        record = AsyncMock(side_effect=RuntimeError("db"))
        with self.assertLogs(netskope_sync.LOGGER, level="ERROR"):
            result, _ = await self._run({"totalUsers": 10}, record=record)
        self.assertEqual(result, {"objects": 1, "users_all_accounts_deleted": 0})

    async def test_nothing_is_recorded_when_the_inventory_fails(self):
        inventory = AsyncMock(side_effect=RuntimeError("boom"))
        record = AsyncMock()
        with self.assertRaises(RuntimeError):
            await self._run({"totalUsers": 10}, record=record, inventory=inventory)
        record.assert_not_awaited()


GROUP_ID = "group-1"


def _group_client(users, groups, groups_error=None):
    context = _client([])
    client = context.__aenter__.return_value
    client.get_users = AsyncMock(return_value=users)
    client.get_groups = AsyncMock(return_value=groups, side_effect=groups_error)
    return context


class NetskopeGroupSyncTests(unittest.IsolatedAsyncioTestCase):
    """NSK-GRP-001: groups are an optional layer that never retires from a failed read."""

    async def run_sync(self, users, groups, groups_error=None):
        settings = MagicMock(dem_sites_path="", alert_path="", groups_path="/api/v2/users/getgroups", policy_groups_path="", rbac_path="")
        inventory = AsyncMock(return_value={"objects": 3})
        with patch.object(netskope_sync.NetskopeSettings, "from_environment", return_value=settings), \
                patch.object(netskope_sync, "NetskopeClient", return_value=_group_client(users, groups, groups_error)), \
                patch.object(netskope_sync, "record_device_snapshots", AsyncMock()), \
                patch.object(netskope_sync, "sync_inventory_snapshot", inventory):
            result = await netskope_sync.sync_netskope_inventory(MagicMock(), uuid4())
        return result, inventory

    async def test_groups_and_memberships_are_reconciled_after_a_complete_read(self):
        users = [{"id": "u1", "accounts": [{"parentGroups": [GROUP_ID, "missing"]}]}]
        result, inventory = await self.run_sync(users, [{"id": GROUP_ID, "displayName": "Ops", "provisioner": "AD"}])
        kwargs = inventory.await_args.kwargs
        self.assertIn("netskope_group", kwargs["reconcile_object_types"])
        self.assertEqual(kwargs["reconcile_relationship_types"], frozenset({"member_of"}))
        self.assertEqual([(r.source_id, r.target_id) for r in inventory.await_args.args[2]], [("u1", GROUP_ID)])
        self.assertEqual(result["groups"], 1)
        self.assertEqual(result["group_unresolved_references"], 1)
        self.assertNotIn("run_partial", result)

    async def test_a_failed_group_read_keeps_the_inventory_and_retires_nothing_about_groups(self):
        result, inventory = await self.run_sync([{"id": "u1", "accounts": []}], [], netskope_sync.NetskopeError("boom"))
        kwargs = inventory.await_args.kwargs
        self.assertNotIn("netskope_group", kwargs["reconcile_object_types"])
        self.assertEqual(kwargs["reconcile_relationship_types"], frozenset())
        self.assertEqual(inventory.await_args.args[2], [])
        self.assertEqual((result["groups_error"], result["run_partial"]), (1, 1))

    async def test_users_without_accounts_or_references_to_an_empty_listing_cannot_retire_memberships(self):
        for users, groups in (
            ([{"id": "u1"}], [{"id": GROUP_ID, "displayName": "Ops"}]),
            ([{"id": "u1", "accounts": [{"parentGroups": [GROUP_ID]}]}], []),
        ):
            result, inventory = await self.run_sync(users, groups)
            self.assertNotIn("netskope_group", inventory.await_args.kwargs["reconcile_object_types"])
            self.assertEqual(inventory.await_args.kwargs["reconcile_relationship_types"], frozenset())
            self.assertEqual(result["run_partial"], 1)

    async def test_groups_are_not_requested_without_the_approved_route(self):
        settings = MagicMock(dem_sites_path="", alert_path="", groups_path="", policy_groups_path="", rbac_path="")
        context = _group_client([], [])
        with patch.object(netskope_sync.NetskopeSettings, "from_environment", return_value=settings), \
                patch.object(netskope_sync, "NetskopeClient", return_value=context), \
                patch.object(netskope_sync, "record_device_snapshots", AsyncMock()), \
                patch.object(netskope_sync, "sync_inventory_snapshot", AsyncMock(return_value={})) as inventory:
            await netskope_sync.sync_netskope_inventory(MagicMock(), uuid4())
        context.__aenter__.return_value.get_groups.assert_not_awaited()
        self.assertEqual(inventory.await_args.kwargs["reconcile_relationship_types"], frozenset())


class NetskopeDlpTaskTests(unittest.IsolatedAsyncioTestCase):
    async def test_dlp_task_reports_capture_counters(self):
        capture = AsyncMock(return_value={
            "configured": True, "scanned_events": 4, "captured_alerts": 2, "partial": False, "error": False,
            "pages": 2, "requests": 3, "retries": 1, "elapsed_ms": 1250, "lag_seconds": 60, "persistence_ms": 400, "wait_ms": 200,
        })
        with patch.object(netskope_sync, "capture_netskope_dlp_alerts", capture):
            result = await netskope_sync.sync_netskope_dlp(MagicMock(), uuid4())
        self.assertEqual(result["objects"], 2)
        self.assertEqual(result["dlp_scanned_events"], 4)
        self.assertEqual(result["dlp_alerts_captured"], 2)
        self.assertEqual(result["dlp_capture_partial"], 0)
        self.assertEqual(result["dlp_capture_error"], 0)
        self.assertEqual(result["run_partial"], 0)
        self.assertEqual(result["dlp_pages"], 2)
        self.assertEqual(result["dlp_requests"], 3)
        self.assertEqual(result["dlp_retries"], 1)
        self.assertEqual(result["dlp_persistence_ms"], 400)
        self.assertEqual(result["dlp_wait_ms"], 200)
        self.assertEqual(result["dlp_elapsed_ms"], 1250)
        self.assertEqual(result["dlp_lag_seconds"], 60)

    async def test_an_incomplete_capture_marks_the_run_partial(self):
        capture = AsyncMock(return_value={"scanned_events": 5, "captured_alerts": 1, "partial": True, "error": False})
        with patch.object(netskope_sync, "capture_netskope_dlp_alerts", capture):
            result = await netskope_sync.sync_netskope_dlp(MagicMock(), uuid4())
        self.assertEqual(result["run_partial"], 1)
        self.assertEqual(result["dlp_capture_partial"], 1)

    async def test_an_idle_capture_completes_the_run_and_reports_it(self):
        capture = AsyncMock(return_value={"scanned_events": 0, "captured_alerts": 0, "partial": False, "idle": True, "error": False, "lag_seconds": 2400})
        with patch.object(netskope_sync, "capture_netskope_dlp_alerts", capture):
            result = await netskope_sync.sync_netskope_dlp(MagicMock(), uuid4())
        self.assertEqual(result["run_partial"], 0)
        self.assertEqual(result["dlp_idle"], 1)
        self.assertEqual(result["dlp_lag_seconds"], 2400)

    async def test_dlp_capture_error_fails_only_the_dlp_task(self):
        capture = AsyncMock(return_value={"scanned_events": 0, "captured_alerts": 0, "partial": True, "error": True})
        inventory = AsyncMock()
        with patch.object(netskope_sync, "capture_netskope_dlp_alerts", capture), \
                patch.object(netskope_sync, "sync_inventory_snapshot", inventory):
            with self.assertRaises(RuntimeError):
                await netskope_sync.sync_netskope_dlp(MagicMock(), uuid4())
        inventory.assert_not_awaited()


class NetskopeDispatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_each_task_key_runs_only_its_own_job(self):
        run_id = uuid4()
        jobs = {name: AsyncMock(return_value={"objects": 1}) for name in ("inventory", "alerts", "dlp")}
        with patch.dict(netskope_sync._TASKS, {
            netskope_sync.TASK_INVENTORY: jobs["inventory"],
            netskope_sync.TASK_ALERTS: jobs["alerts"],
            netskope_sync.TASK_DLP: jobs["dlp"],
        }):
            await netskope_sync.dispatch_netskope_run(MagicMock(), {"run_id": run_id, "task_key": "netskope_alerts"})
            await netskope_sync.dispatch_netskope_run(MagicMock(), {"run_id": run_id, "task_key": "netskope_dlp"})
            # A run queued before migration 078 has no task and was the inventory.
            await netskope_sync.dispatch_netskope_run(MagicMock(), {"run_id": run_id})
        self.assertEqual({name: job.await_count for name, job in jobs.items()}, {"inventory": 1, "alerts": 1, "dlp": 1})

    async def test_unknown_task_is_rejected(self):
        with self.assertRaises(ValueError):
            await netskope_sync.dispatch_netskope_run(MagicMock(), {"run_id": uuid4(), "task_key": "netskope_other"})


if __name__ == "__main__":
    unittest.main()
