import os
import unittest
from unittest.mock import patch

from app.config import AppSettings, allowed_web_origins, api_docs_urls

TEST_SESSION_SECRET = "test-session-secret-with-at-least-32-bytes"


class AppSettingsTests(unittest.TestCase):
    def test_cors_origins_only_include_the_explicit_web_origin(self):
        self.assertEqual(allowed_web_origins("https://dshub.example"), ["https://dshub.example"])
        self.assertNotIn("http://localhost:5173", allowed_web_origins("https://dshub.example"))
        self.assertNotIn("http://127.0.0.1:5173", allowed_web_origins("https://dshub.example"))

    def test_cors_origins_are_empty_when_web_origin_is_not_configured(self):
        self.assertEqual(allowed_web_origins(None), [])

    def test_reads_runtime_settings_and_applies_safe_defaults(self):
        values = {
            "DATABASE_URL": "postgresql://db/cmdb",
            "SESSION_SECRET": TEST_SESSION_SECRET,
            "INGESTION_INTERVAL_MINUTES": "1440",
            "SESSION_MAX_AGE_SECONDS": "3600",
            "SESSION_IDLE_TIMEOUT_SECONDS": "900",
        }
        with patch.dict(os.environ, values, clear=True):
            settings = AppSettings.from_environment()
        self.assertEqual(settings.database_url, values["DATABASE_URL"])
        self.assertEqual(settings.ingestion_interval_minutes, 1440)
        self.assertEqual(settings.session_max_age_seconds, 3600)
        self.assertEqual(settings.session_idle_timeout_seconds, 900)
        self.assertEqual(settings.auth_mode, "local")
        self.assertFalse(settings.session_https_only)
        self.assertIsNone(settings.web_origin)
        self.assertEqual(settings.api_max_body_bytes, 8 * 1024 * 1024)
        # PENTEST-010: defaults to exposing Swagger/ReDoc/openapi.json so
        # local development keeps working unchanged; production must opt
        # out explicitly via EXPOSE_API_DOCS=false (see the deployment
        # checklist).
        self.assertTrue(settings.expose_api_docs)

    def test_expose_api_docs_can_be_disabled_explicitly(self):
        values = {
            "DATABASE_URL": "postgresql://db/cmdb",
            "SESSION_SECRET": TEST_SESSION_SECRET,
            "INGESTION_INTERVAL_MINUTES": "1440",
            "EXPOSE_API_DOCS": "false",
        }
        with patch.dict(os.environ, values, clear=True):
            settings = AppSettings.from_environment()
        self.assertFalse(settings.expose_api_docs)

    def test_api_docs_urls_are_all_disabled_together_or_not_at_all(self):
        # PENTEST-010: app/main.py wires these three kwargs straight from
        # this function -- a partial disable (e.g. hiding /docs but leaving
        # /openapi.json reachable) would still expose the full API surface.
        self.assertEqual(
            api_docs_urls(True),
            {"docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json"},
        )
        self.assertEqual(
            api_docs_urls(False),
            {"docs_url": None, "redoc_url": None, "openapi_url": None},
        )

    def test_rejects_scheduled_ingestion_below_five_minutes(self):
        with patch.dict(
            os.environ,
            {"DATABASE_URL": "postgresql://db/cmdb", "SESSION_SECRET": "secret", "INGESTION_INTERVAL_MINUTES": "4"},
            clear=True,
        ):
            with self.assertRaisesRegex(RuntimeError, "mínimo cada 5 minutos"):
                AppSettings.from_environment()

    def test_accepts_a_faster_than_daily_scheduled_interval(self):
        # Ingestion-frequency evolution: the old floor was 24h (forced a
        # manual sync for anything new to show up sooner); this only
        # constrains against an accidental hammering interval, not against
        # near-real-time polling. How fast is actually safe against a real
        # CyberArk/Identity/SIA tenant is an external, unverified limit --
        # see docs/operations/ingestion-frequency.md.
        with patch.dict(
            os.environ,
            {"DATABASE_URL": "postgresql://db/cmdb", "SESSION_SECRET": TEST_SESSION_SECRET, "INGESTION_INTERVAL_MINUTES": "15"},
            clear=True,
        ):
            settings = AppSettings.from_environment()
        self.assertEqual(settings.ingestion_interval_minutes, 15)

    def test_rejects_short_and_documented_placeholder_session_secrets(self):
        for secret in ("too-short", "change-this-to-a-long-random-value"):
            with self.subTest(secret=secret), patch.dict(
                os.environ,
                {"DATABASE_URL": "postgresql://db/cmdb", "SESSION_SECRET": secret},
                clear=True,
            ):
                with self.assertRaisesRegex(RuntimeError, "32 bytes aleatorios"):
                    AppSettings.from_environment()

    def test_rejects_unknown_auth_mode(self):
        with patch.dict(
            os.environ,
            {
                "DATABASE_URL": "postgresql://db/cmdb",
                "SESSION_SECRET": TEST_SESSION_SECRET,
                "AUTH_MODE": "password",
            },
            clear=True,
        ):
            with self.assertRaisesRegex(RuntimeError, "AUTH_MODE debe ser"):
                AppSettings.from_environment()

    def test_accepts_hybrid_auth_mode_and_enables_secure_cookie_default(self):
        with patch.dict(
            os.environ,
            {
                "DATABASE_URL": "postgresql://db/cmdb",
                "SESSION_SECRET": TEST_SESSION_SECRET,
                "AUTH_MODE": "hybrid",
            },
            clear=True,
        ):
            settings = AppSettings.from_environment()

        self.assertEqual(settings.auth_mode, "hybrid")
        self.assertTrue(settings.session_https_only)

    def test_rejects_idle_timeout_longer_than_session(self):
        with patch.dict(
            os.environ,
            {
                "DATABASE_URL": "postgresql://db/cmdb",
                "SESSION_SECRET": "secret",
                "SESSION_MAX_AGE_SECONDS": "3600",
                "SESSION_IDLE_TIMEOUT_SECONDS": "3600",
            },
            clear=True,
        ):
            with self.assertRaisesRegex(RuntimeError, "menor que SESSION_MAX_AGE_SECONDS"):
                AppSettings.from_environment()


if __name__ == "__main__":
    unittest.main()
