import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app.config import AppSettings, allowed_web_origins, api_docs_enabled_for_session, api_docs_urls
from app.cross.services.database_credentials import conninfo_to_dict

TEST_SESSION_SECRET = "test-session-secret-with-at-least-32-bytes"


class AppSettingsTests(unittest.TestCase):
    def test_cors_origins_only_include_the_explicit_web_origin(self):
        self.assertEqual(allowed_web_origins("https://custodia.example"), ["https://custodia.example"])
        self.assertNotIn("http://localhost:5173", allowed_web_origins("https://custodia.example"))
        self.assertNotIn("http://127.0.0.1:5173", allowed_web_origins("https://custodia.example"))

    def test_cors_origins_are_empty_when_web_origin_is_not_configured(self):
        self.assertEqual(allowed_web_origins(None), [])

    def test_cors_origins_accept_explicit_additional_local_origins(self):
        self.assertEqual(
            allowed_web_origins(
                "http://custodia.itti.digital:5173",
                "http://localhost:5173, http://127.0.0.1:5173",
            ),
            [
                "http://custodia.itti.digital:5173",
                "http://localhost:5173",
                "http://127.0.0.1:5173",
            ],
        )

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
        # PENTEST-010: defaults to exposing the API reference/openapi.json so
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
        # PENTEST-010: app/main.py wires these kwargs straight from
        # this function -- a partial disable (e.g. hiding /docs but leaving
        # /openapi.json reachable) would still expose the full API surface.
        self.assertEqual(
            api_docs_urls(True),
            {"docs_url": "/docs", "openapi_url": "/openapi.json"},
        )
        self.assertEqual(
            api_docs_urls(False),
            {"docs_url": None, "openapi_url": None},
        )

    def test_api_docs_signal_never_enables_the_reference_by_itself(self):
        # DOCS-PORTAL-001: the authenticated status only mirrors the deployment
        # setting so the guide can hide its /docs link. Unauthenticated
        # sessions always read False, and the signal has no effect on what
        # app/main.py actually exposes (api_docs_urls above is the only gate).
        self.assertTrue(api_docs_enabled_for_session(True, True))
        self.assertFalse(api_docs_enabled_for_session(True, False))
        self.assertFalse(api_docs_enabled_for_session(False, True))
        self.assertFalse(api_docs_enabled_for_session(False, False))

    def test_rejects_scheduled_ingestion_below_five_minutes(self):
        with patch.dict(
            os.environ,
            {"DATABASE_URL": "postgresql://db/cmdb", "SESSION_SECRET": TEST_SESSION_SECRET, "INGESTION_INTERVAL_MINUTES": "4"},
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
            with self.assertRaisesRegex(RuntimeError, "AUTH_MODE: Input should be"):
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

    def test_accepts_a_fully_valid_environment(self):
        with patch.dict(
            os.environ,
            {
                "DATABASE_URL": "postgresql://db/cmdb",
                "SESSION_SECRET": TEST_SESSION_SECRET,
                "INGESTION_INTERVAL_MINUTES": "30",
                "SESSION_MAX_AGE_SECONDS": "7200",
                "SESSION_IDLE_TIMEOUT_SECONDS": "1200",
                "AUTH_MODE": "hybrid",
                "SESSION_HTTPS_ONLY": "true",
                "WEB_ORIGIN": "https://custodia.example",
                "API_MAX_BODY_BYTES": "1048576",
                "EXPOSE_API_DOCS": "false",
                "DATABASE_SECRET_ID": "custodia/database",
                "DATABASE_SECRET_REGION": "us-east-1",
            },
            clear=True,
        ):
            settings = AppSettings.from_environment()

        self.assertEqual(settings.ingestion_interval_minutes, 30)
        self.assertEqual(settings.session_max_age_seconds, 7200)
        self.assertEqual(settings.session_idle_timeout_seconds, 1200)
        self.assertEqual(settings.auth_mode, "hybrid")
        self.assertTrue(settings.session_https_only)
        self.assertEqual(settings.web_origin, "https://custodia.example")
        self.assertEqual(settings.api_max_body_bytes, 1048576)
        self.assertFalse(settings.expose_api_docs)
        self.assertEqual(settings.database_secret_id, "custodia/database")
        self.assertEqual(settings.database_secret_region, "us-east-1")

    def test_rejects_missing_database_url(self):
        with patch.dict(os.environ, {"SESSION_SECRET": TEST_SESSION_SECRET}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "DATABASE_URL es obligatorio"):
                AppSettings.from_environment()

    def test_rejects_malformed_numeric_settings_with_a_named_message(self):
        for name in (
            "INGESTION_INTERVAL_MINUTES",
            "SESSION_MAX_AGE_SECONDS",
            "SESSION_IDLE_TIMEOUT_SECONDS",
            "API_MAX_BODY_BYTES",
        ):
            with self.subTest(name=name), patch.dict(
                os.environ,
                {"DATABASE_URL": "postgresql://db/cmdb", "SESSION_SECRET": TEST_SESSION_SECRET, name: "not-a-number"},
                clear=True,
            ):
                with self.assertRaisesRegex(RuntimeError, name):
                    AppSettings.from_environment()

    def test_rejects_session_timeouts_below_their_floors(self):
        for name, value, message in (
            ("SESSION_MAX_AGE_SECONDS", "3599", "SESSION_MAX_AGE_SECONDS: Input should be greater than or equal to 3600"),
            ("SESSION_IDLE_TIMEOUT_SECONDS", "299", "SESSION_IDLE_TIMEOUT_SECONDS: Input should be greater than or equal to 300"),
        ):
            with self.subTest(name=name), patch.dict(
                os.environ,
                {"DATABASE_URL": "postgresql://db/cmdb", "SESSION_SECRET": TEST_SESSION_SECRET, name: value},
                clear=True,
            ):
                with self.assertRaisesRegex(RuntimeError, message):
                    AppSettings.from_environment()

    def test_rejects_api_body_limit_outside_the_supported_range(self):
        for value, message in (
            ("65535", "API_MAX_BODY_BYTES: Input should be greater than or equal to 65536"),
            ("67108865", "API_MAX_BODY_BYTES: Input should be less than or equal to 67108864"),
        ):
            with self.subTest(value=value), patch.dict(
                os.environ,
                {"DATABASE_URL": "postgresql://db/cmdb", "SESSION_SECRET": TEST_SESSION_SECRET, "API_MAX_BODY_BYTES": value},
                clear=True,
            ):
                with self.assertRaisesRegex(RuntimeError, message):
                    AppSettings.from_environment()

    def test_preserves_the_existing_true_only_boolean_contract(self):
        # Deployment contract: only 'true' (case-insensitive) enables the
        # secure cookie, so SESSION_HTTPS_ONLY=1 stays false exactly as the
        # previous hand-rolled parser did.
        for raw, expected in (("1", False), ("TRUE", True), ("", False)):
            with self.subTest(raw=raw), patch.dict(
                os.environ,
                {
                    "DATABASE_URL": "postgresql://db/cmdb",
                    "SESSION_SECRET": TEST_SESSION_SECRET,
                    "AUTH_MODE": "oidc",
                    "SESSION_HTTPS_ONLY": raw,
                },
                clear=True,
            ):
                settings = AppSettings.from_environment()
            self.assertEqual(settings.session_https_only, expected)

    def test_normalizes_auth_mode_and_optional_identifiers(self):
        with patch.dict(
            os.environ,
            {
                "DATABASE_URL": "postgresql://db/cmdb",
                "SESSION_SECRET": TEST_SESSION_SECRET,
                "AUTH_MODE": " OIDC ",
                "WEB_ORIGIN": "",
                "DATABASE_SECRET_ID": " ",
                "DATABASE_SECRET_REGION": " us-east-1 ",
            },
            clear=True,
        ):
            settings = AppSettings.from_environment()

        self.assertEqual(settings.auth_mode, "oidc")
        self.assertTrue(settings.session_https_only)
        self.assertIsNone(settings.web_origin)
        self.assertIsNone(settings.database_secret_id)
        self.assertEqual(settings.database_secret_region, "us-east-1")

    def test_reads_the_session_secret_from_the_configured_file(self):
        with TemporaryDirectory() as directory:
            secret_path = Path(directory) / "session_secret"
            secret_path.write_text(TEST_SESSION_SECRET + "\n", encoding="utf-8")
            with patch.dict(
                os.environ,
                {"DATABASE_URL": "postgresql://db/cmdb", "SESSION_SECRET_FILE": str(secret_path)},
                clear=True,
            ):
                settings = AppSettings.from_environment()
        self.assertEqual(settings.session_secret, TEST_SESSION_SECRET)

    def test_session_secret_file_takes_precedence_over_the_inline_value(self):
        with TemporaryDirectory() as directory:
            secret_path = Path(directory) / "session_secret"
            secret_path.write_text(TEST_SESSION_SECRET + "\n", encoding="utf-8")
            with patch.dict(
                os.environ,
                {
                    "DATABASE_URL": "postgresql://db/cmdb",
                    "SESSION_SECRET": "x" * 40,
                    "SESSION_SECRET_FILE": str(secret_path),
                },
                clear=True,
            ):
                settings = AppSettings.from_environment()
        self.assertEqual(settings.session_secret, TEST_SESSION_SECRET)

    def test_rejects_a_configured_session_secret_file_that_cannot_be_read(self):
        with patch.dict(
            os.environ,
            {"DATABASE_URL": "postgresql://db/cmdb", "SESSION_SECRET_FILE": "/nonexistent/session_secret"},
            clear=True,
        ):
            with self.assertRaisesRegex(RuntimeError, "No se pudo leer el secreto configurado"):
                AppSettings.from_environment()

    def test_applies_the_database_password_file_before_validation(self):
        with TemporaryDirectory() as directory:
            password_path = Path(directory) / "database_password"
            password_path.write_text("secret-password\n", encoding="utf-8")
            with patch.dict(
                os.environ,
                {
                    "DATABASE_URL": "postgresql://db-user@db.example:5432/cmdb",
                    "SESSION_SECRET": TEST_SESSION_SECRET,
                    "DATABASE_PASSWORD_FILE": str(password_path),
                },
                clear=True,
            ):
                settings = AppSettings.from_environment()
        self.assertEqual(conninfo_to_dict(settings.database_url)["password"], "secret-password")

    def test_missing_database_url_wins_over_a_configured_password_file(self):
        # Order preserved from the hand-rolled parser: the required-field
        # message comes first and the password file is never touched.
        with patch.dict(
            os.environ,
            {"SESSION_SECRET": TEST_SESSION_SECRET, "DATABASE_PASSWORD_FILE": "/nonexistent/database_password"},
            clear=True,
        ):
            with self.assertRaisesRegex(RuntimeError, "DATABASE_URL es obligatorio"):
                AppSettings.from_environment()

    def test_rejects_idle_timeout_longer_than_session(self):
        with patch.dict(
            os.environ,
            {
                "DATABASE_URL": "postgresql://db/cmdb",
                "SESSION_SECRET": TEST_SESSION_SECRET,
                "SESSION_MAX_AGE_SECONDS": "3600",
                "SESSION_IDLE_TIMEOUT_SECONDS": "3600",
            },
            clear=True,
        ):
            with self.assertRaisesRegex(RuntimeError, "menor que SESSION_MAX_AGE_SECONDS"):
                AppSettings.from_environment()


if __name__ == "__main__":
    unittest.main()
