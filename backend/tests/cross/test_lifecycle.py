import asyncio
import os
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from fastapi import FastAPI

from app.config import AppSettings
from app.cyberark.access.integrations.access import AccessNotConfigured
from app.cyberark.identity_administration.integrations.identity_admin import IdentityAdminNotConfigured
from app.lifecycle import build_lifespan, scheduled_ingestion_loop, scheduled_source_jobs
from app.cross.repositories.ingestion import scheduled_cycle_delay_seconds
from app.cross.services.sync_schedule import SourceRunHistory


@asynccontextmanager
async def acquired_scheduler_lock(*_args):
    yield True


class ScheduledSourceJobsTests(unittest.TestCase):
    def test_schedules_all_configured_sources(self):
        with patch("app.cyberark.identity_administration.source.IdentityAdminSettings.from_environment"), \
             patch("app.cyberark.sia.source.SiaSettings.from_environment"), \
             patch("app.cyberark.access.source.AccessSettings.from_environment"), \
             patch("app.netskope.sse.source.NetskopeSettings.from_environment"), \
             patch.dict(os.environ, {}, clear=True):
            jobs = scheduled_source_jobs()

        self.assertEqual(
            jobs,
            [
                ("cyberark", "cyberark-api", {
                    "page_size": 100,
                    "member_delay_seconds": 0.3,
                    "member_concurrency": 4,
                    "reconcile_complete": True,
                }, "pam_safes"),
                ("cyberark", "cyberark-psm-api", {"psm_only": True, "page_size": 100}, "pam_psm"),
                ("identity_administration", "identity-administration-scim", {}, "identity_administration"),
                ("sia", "sia-api", {}, "sia"),
                ("access", "access-api", {}, "access"),
                ("netskope", "netskope-api", {}, "netskope_inventory"),
            ],
        )

    def test_omits_only_sources_without_a_configured_contract(self):
        with patch(
            "app.cyberark.identity_administration.source.IdentityAdminSettings.from_environment",
            side_effect=IdentityAdminNotConfigured("missing"),
        ), patch("app.cyberark.sia.source.SiaSettings.from_environment"), patch(
            "app.cyberark.access.source.AccessSettings.from_environment",
            side_effect=AccessNotConfigured("missing"),
        ), patch("app.netskope.sse.source.NetskopeSettings.from_environment"), \
                patch.dict(os.environ, {}, clear=True):
            jobs = scheduled_source_jobs()

        self.assertEqual(
            jobs,
            [
                ("cyberark", "cyberark-api", {
                    "page_size": 100,
                    "member_delay_seconds": 0.3,
                    "member_concurrency": 4,
                    "reconcile_complete": True,
                }, "pam_safes"),
                ("cyberark", "cyberark-psm-api", {"psm_only": True, "page_size": 100}, "pam_psm"),
                ("sia", "sia-api", {}, "sia"),
                ("netskope", "netskope-api", {}, "netskope_inventory"),
            ],
        )

    def test_scheduler_enqueues_one_batch_and_wakes_once(self):
        app = SimpleNamespace(
            state=SimpleNamespace(db=object(), sync_coordinator=SimpleNamespace(wake=Mock()))
        )
        settings = AppSettings(
            database_url="postgresql://unused",
            ingestion_interval_minutes=1440,
            session_max_age_seconds=28800,
            session_idle_timeout_seconds=900,
            auth_mode="local",
            session_secret="x" * 32,
            session_https_only=False,
            web_origin=None,
            api_max_body_bytes=65536,
        )
        with patch(
            "app.lifecycle.scheduled_source_jobs",
            return_value=[("cyberark", "cyberark-api", {"reconcile_complete": True}, "pam_safes")],
        ), patch(
            "app.lifecycle.enqueue_sync_runs", new=AsyncMock(return_value=[])
        ) as enqueue, patch(
             "app.lifecycle.source_run_history",
             new=AsyncMock(side_effect=[{}, {}, {"pam_safes": SourceRunHistory(active=True)}]),
        ), patch("app.lifecycle.list_sync_schedule_overrides", new=AsyncMock(return_value={})), patch("app.lifecycle.scheduler_cycle_lock", acquired_scheduler_lock), patch(
            "app.lifecycle.asyncio.sleep",
            side_effect=asyncio.CancelledError,
        ):
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(scheduled_ingestion_loop(app, settings))

        jobs = enqueue.await_args.args[1]
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["source_system"], "cyberark")
        self.assertEqual(jobs[0]["options"], {"reconcile_complete": True})
        self.assertEqual(enqueue.await_args.kwargs["triggered_by"], "system:scheduler")
        app.state.sync_coordinator.wake.assert_not_called()

    def test_scheduler_wakes_when_a_due_cycle_enqueues_work(self):
        app = SimpleNamespace(
            state=SimpleNamespace(db=object(), sync_coordinator=SimpleNamespace(wake=Mock()))
        )
        settings = AppSettings(
            database_url="postgresql://unused", ingestion_interval_minutes=15,
            session_max_age_seconds=28800, session_idle_timeout_seconds=900,
            auth_mode="local", session_secret="x" * 32, session_https_only=False,
            web_origin=None, api_max_body_bytes=65536,
        )
        with patch("app.lifecycle.scheduled_source_jobs", return_value=[("netskope", "netskope-api", {}, "netskope_inventory")]), \
             patch("app.lifecycle.enqueue_sync_runs", new=AsyncMock(return_value=[{"run_id": "one"}])) as enqueue, \
              patch("app.lifecycle.source_run_history", new=AsyncMock(side_effect=[{}, {}, {"netskope_inventory": SourceRunHistory(active=True)}])), \
              patch("app.lifecycle.list_sync_schedule_overrides", new=AsyncMock(return_value={})), \
              patch("app.lifecycle.scheduler_cycle_lock", acquired_scheduler_lock), \
             patch("app.lifecycle.asyncio.sleep", side_effect=asyncio.CancelledError):
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(scheduled_ingestion_loop(app, settings))

        enqueue.assert_awaited_once()
        app.state.sync_coordinator.wake.assert_called_once()


class ScheduledCycleDelayTests(unittest.TestCase):
    def test_first_cycle_is_due_immediately(self):
        self.assertEqual(scheduled_cycle_delay_seconds(None, 15), 0)

    def test_restart_waits_only_the_remaining_interval(self):
        now = datetime(2026, 9, 22, 2, 20, tzinfo=timezone.utc)
        last = now - timedelta(minutes=6)
        self.assertEqual(scheduled_cycle_delay_seconds(last, 15, now=now), 9 * 60)

    def test_overdue_cycle_runs_immediately(self):
        now = datetime(2026, 9, 22, 2, 20, tzinfo=timezone.utc)
        self.assertEqual(scheduled_cycle_delay_seconds(now - timedelta(minutes=16), 15, now=now), 0)


class BuildLifespanOidcWarningTests(unittest.TestCase):
    """The default-role-without-a-mapping warning (Okta groups rollout
    footgun) must actually fire at startup when OIDC is enabled -- not just
    exist as a unit-tested-in-isolation function nobody calls."""

    def _settings(self) -> AppSettings:
        return AppSettings(
            database_url="postgresql://db/cmdb", ingestion_interval_minutes=0,
            session_max_age_seconds=28800, session_idle_timeout_seconds=900,
            auth_mode="oidc", session_secret="x" * 32, session_https_only=True,
            web_origin=None, api_max_body_bytes=8 * 1024 * 1024,
        )

    def test_warning_check_runs_when_oidc_is_enabled(self):
        fake_pool = SimpleNamespace(open=AsyncMock(), wait=AsyncMock(), close=AsyncMock())
        with patch("app.lifecycle.create_pool", return_value=fake_pool), \
             patch("app.lifecycle.assert_schema_ready", new=AsyncMock()), \
             patch("app.lifecycle.SyncCoordinator") as coordinator_cls, \
             patch("app.lifecycle.warn_if_default_role_is_unscoped") as warn:
            coordinator_cls.return_value = SimpleNamespace(start=Mock(), close=AsyncMock())
            app = FastAPI(lifespan=build_lifespan(self._settings(), oidc_enabled=True))

            async def run():
                async with app.router.lifespan_context(app):
                    pass

            asyncio.run(run())

        warn.assert_called_once_with()

    def test_warning_check_is_skipped_when_oidc_is_disabled(self):
        fake_pool = SimpleNamespace(open=AsyncMock(), wait=AsyncMock(), close=AsyncMock())
        with patch("app.lifecycle.create_pool", return_value=fake_pool), \
             patch("app.lifecycle.assert_schema_ready", new=AsyncMock()), \
             patch("app.lifecycle.SyncCoordinator") as coordinator_cls, \
             patch("app.lifecycle.warn_if_default_role_is_unscoped") as warn:
            coordinator_cls.return_value = SimpleNamespace(start=Mock(), close=AsyncMock())
            app = FastAPI(lifespan=build_lifespan(self._settings(), oidc_enabled=False))

            async def run():
                async with app.router.lifespan_context(app):
                    pass

            asyncio.run(run())

        warn.assert_not_called()


class RateLimitPurgeSchedulingTests(unittest.TestCase):
    """IF-001: the periodic purge task must actually be scheduled and
    cleanly cancelled on shutdown, not just exist as an untested function."""

    def _settings(self) -> AppSettings:
        return AppSettings(
            database_url="postgresql://db/cmdb", ingestion_interval_minutes=0,
            session_max_age_seconds=28800, session_idle_timeout_seconds=900,
            auth_mode="local", session_secret="x" * 32, session_https_only=False,
            web_origin=None, api_max_body_bytes=8 * 1024 * 1024,
        )

    def test_purge_task_is_scheduled_and_tracked_for_clean_shutdown(self):
        fake_pool = SimpleNamespace(open=AsyncMock(), wait=AsyncMock(), close=AsyncMock())
        with patch("app.lifecycle.create_pool", return_value=fake_pool), \
             patch("app.lifecycle.assert_schema_ready", new=AsyncMock()), \
             patch("app.lifecycle.SyncCoordinator") as coordinator_cls:
            coordinator_cls.return_value = SimpleNamespace(start=Mock(), close=AsyncMock())
            app = FastAPI(lifespan=build_lifespan(self._settings(), oidc_enabled=False))

            captured_tasks = []

            async def run():
                async with app.router.lifespan_context(app):
                    captured_tasks.extend(app.state.ingestion_tasks)

            asyncio.run(run())

        purge_tasks = [task for task in captured_tasks if task.get_name() == "rate-limit-attempts-purge"]
        self.assertEqual(len(purge_tasks), 1)
        # Cancelled cleanly by the lifespan's own shutdown, not leaked.
        self.assertTrue(purge_tasks[0].cancelled() or purge_tasks[0].done())


class NetskopeDlpPollerRetirementTests(unittest.TestCase):
    """Product decision: individual DLP incident events are not captured.
    The lifecycle must never start the retired cache poller, even when the
    legacy NETSKOPE_DLP_INCIDENTS_PATH variable is still present in the
    environment."""

    def _settings(self) -> AppSettings:
        return AppSettings(
            database_url="postgresql://db/cmdb", ingestion_interval_minutes=0,
            session_max_age_seconds=28800, session_idle_timeout_seconds=900,
            auth_mode="local", session_secret="x" * 32, session_https_only=False,
            web_origin=None, api_max_body_bytes=8 * 1024 * 1024,
        )

    def test_lifespan_never_starts_the_dlp_cache_poller(self):
        fake_pool = SimpleNamespace(open=AsyncMock(), wait=AsyncMock(), close=AsyncMock())
        legacy_environment = {
            "NETSKOPE_URL": "https://tenant.goskope.com",
            "NETSKOPE_DEVICE_STATUS_PATH": "/devices",
            "NETSKOPE_USERS_PATH": "/users",
            "NETSKOPE_USER_COUNTS_PATH": "/counts",
            "NETSKOPE_DLP_INCIDENTS_PATH": "/api/v2/events/dataexport/events/incident",
        }
        with patch.dict("os.environ", legacy_environment, clear=True), \
             patch("app.lifecycle.create_pool", return_value=fake_pool), \
             patch("app.lifecycle.assert_schema_ready", new=AsyncMock()), \
             patch("app.lifecycle.SyncCoordinator") as coordinator_cls:
            coordinator_cls.return_value = SimpleNamespace(start=Mock(), close=AsyncMock())
            app = FastAPI(lifespan=build_lifespan(self._settings(), oidc_enabled=False))

            captured_tasks = []

            async def run():
                async with app.router.lifespan_context(app):
                    captured_tasks.extend(app.state.ingestion_tasks)

            asyncio.run(run())

        task_names = {task.get_name() for task in captured_tasks}
        self.assertNotIn("netskope-dlp-cache-refresh", task_names)

    def test_poller_module_and_loop_are_gone(self):
        import app.lifecycle as lifecycle
        import importlib.util

        self.assertFalse(hasattr(lifecycle, "netskope_dlp_cache_loop"))
        self.assertIsNone(importlib.util.find_spec("app.cross.services.netskope_dlp_cache"))


if __name__ == "__main__":
    unittest.main()
