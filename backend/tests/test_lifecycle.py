import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from fastapi import FastAPI

from app.config import AppSettings
from app.integrations.access import AccessNotConfigured
from app.integrations.identity_admin import IdentityAdminNotConfigured
from app.integrations.sia import SiaNotConfigured
from app.lifecycle import build_lifespan, scheduled_ingestion_loop, scheduled_source_jobs


class ScheduledSourceJobsTests(unittest.TestCase):
    def test_schedules_all_configured_sources(self):
        with patch("app.lifecycle.IdentityAdminSettings.from_environment"), \
             patch("app.lifecycle.SiaSettings.from_environment"), \
             patch("app.lifecycle.AccessSettings.from_environment"):
            jobs = scheduled_source_jobs()

        self.assertEqual(
            jobs,
            [
                ("cyberark", "cyberark-api", {
                    "page_size": 100,
                    "member_delay_seconds": 0.3,
                    "reconcile_complete": True,
                }),
                ("cyberark", "cyberark-psm-api", {"psm_only": True, "page_size": 100}),
                ("identity_administration", "identity-administration-scim", {}),
                ("sia", "sia-api", {}),
                ("access", "access-api", {}),
            ],
        )

    def test_omits_only_sources_without_a_configured_contract(self):
        with patch(
            "app.lifecycle.IdentityAdminSettings.from_environment",
            side_effect=IdentityAdminNotConfigured("missing"),
        ), patch("app.lifecycle.SiaSettings.from_environment"), patch(
            "app.lifecycle.AccessSettings.from_environment",
            side_effect=AccessNotConfigured("missing"),
        ):
            jobs = scheduled_source_jobs()

        self.assertEqual(
            jobs,
            [
                ("cyberark", "cyberark-api", {
                    "page_size": 100,
                    "member_delay_seconds": 0.3,
                    "reconcile_complete": True,
                }),
                ("cyberark", "cyberark-psm-api", {"psm_only": True, "page_size": 100}),
                ("sia", "sia-api", {}),
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
            session_secret="unused",
            session_https_only=False,
            web_origin=None,
            api_max_body_bytes=65536,
        )
        with patch(
            "app.lifecycle.scheduled_source_jobs",
            return_value=[("cyberark", "cyberark-api", {"reconcile_complete": True})],
        ), patch(
            "app.lifecycle.enqueue_sync_runs", new=AsyncMock(return_value=[])
        ) as enqueue, patch(
            "app.lifecycle.asyncio.sleep",
            side_effect=[None, asyncio.CancelledError],
        ):
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(scheduled_ingestion_loop(app, settings))

        jobs = enqueue.await_args.args[1]
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["source_system"], "cyberark")
        self.assertEqual(jobs[0]["options"], {"reconcile_complete": True})
        self.assertEqual(enqueue.await_args.kwargs["triggered_by"], "system:scheduler")
        app.state.sync_coordinator.wake.assert_called_once()


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


if __name__ == "__main__":
    unittest.main()
