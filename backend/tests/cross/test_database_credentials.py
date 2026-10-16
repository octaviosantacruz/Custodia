from __future__ import annotations

import asyncio
import json
import subprocess
import unittest

import psycopg
from psycopg.conninfo import conninfo_to_dict

from app.cross.integrations.aws_secrets_manager import (
    SecretRetrievalError,
    get_secret_string,
)
from app.cross.services.database_credentials import (
    DatabaseCredentialError,
    DatabaseCredentialProvider,
    database_url_from_password_file,
    database_url_from_secret,
    resolve_database_url,
)


CURRENT_URL = "postgresql://app:old-password@db.internal:5432/dshub?sslmode=require"


class LocalPasswordFileTests(unittest.TestCase):
    def test_password_file_is_combined_with_passwordless_database_url(self) -> None:
        from pathlib import Path
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as directory:
            password_file = Path(directory) / "database_password"
            password_file.write_text("secret-password\n", encoding="utf-8")
            resolved = database_url_from_password_file(
                "postgresql://db-user@db.example:5432/cmdb", str(password_file)
            )
        self.assertEqual(conninfo_to_dict(resolved)["password"], "secret-password")


class AwsSecretsManagerTests(unittest.TestCase):
    def test_get_secret_string_uses_current_version_without_exposing_secret_in_arguments(self) -> None:
        calls: list[tuple[list[str], dict[str, object]]] = []

        def runner(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            calls.append((command, kwargs))
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=json.dumps({"SecretString": '{"password":"new-password"}'}),
                stderr="",
            )

        value = get_secret_string(
            "dshub/database",
            region="us-east-1",
            runner=runner,
        )

        self.assertEqual(value, '{"password":"new-password"}')
        command, kwargs = calls[0]
        self.assertEqual(
            command,
            [
                "aws",
                "secretsmanager",
                "get-secret-value",
                "--secret-id",
                "dshub/database",
                "--region",
                "us-east-1",
                "--output",
                "json",
                "--no-cli-pager",
                "--no-cli-auto-prompt",
            ],
        )
        self.assertNotIn("new-password", " ".join(command))
        self.assertTrue(kwargs["capture_output"])
        self.assertFalse(kwargs["check"])

    def test_get_secret_string_sanitizes_aws_cli_errors(self) -> None:
        def runner(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            return subprocess.CompletedProcess(
                command,
                254,
                stdout="",
                stderr="AccessDenied: leaked-password",
            )

        with self.assertRaises(SecretRetrievalError) as raised:
            get_secret_string("dshub/database", runner=runner)

        self.assertNotIn("leaked-password", str(raised.exception))
        self.assertNotIn("AccessDenied", str(raised.exception))

    def test_get_secret_string_rejects_binary_payload_without_echoing_it(self) -> None:
        def runner(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=json.dumps({"SecretBinary": "c2VjcmV0"}),
                stderr="",
            )

        with self.assertRaisesRegex(SecretRetrievalError, "SecretString"):
            get_secret_string("dshub/database", runner=runner)


class DatabaseCredentialParsingTests(unittest.TestCase):
    def test_password_only_json_replaces_password_and_preserves_connection_fields(self) -> None:
        resolved = database_url_from_secret('{"password":"new p@ss"}', CURRENT_URL)
        values = conninfo_to_dict(resolved)

        self.assertEqual(values["user"], "app")
        self.assertEqual(values["password"], "new p@ss")
        self.assertEqual(values["host"], "db.internal")
        self.assertEqual(values["dbname"], "dshub")
        self.assertEqual(values["sslmode"], "require")

    def test_rds_json_builds_connection_and_preserves_existing_sslmode(self) -> None:
        resolved = database_url_from_secret(
            json.dumps(
                {
                    "engine": "postgres",
                    "host": "rotated.internal",
                    "port": 5433,
                    "username": "rotated-user",
                    "password": "rotated-password",
                    "dbname": "rotated-db",
                }
            ),
            CURRENT_URL,
        )
        values = conninfo_to_dict(resolved)

        self.assertEqual(values["host"], "rotated.internal")
        self.assertEqual(values["port"], "5433")
        self.assertEqual(values["user"], "rotated-user")
        self.assertEqual(values["password"], "rotated-password")
        self.assertEqual(values["dbname"], "rotated-db")
        self.assertEqual(values["sslmode"], "require")

    def test_database_url_json_is_accepted(self) -> None:
        expected = "postgresql://app:new-password@db.internal/dshub"
        self.assertEqual(
            database_url_from_secret(json.dumps({"DATABASE_URL": expected}), None),
            expected,
        )

    def test_plain_secret_is_treated_as_password_when_current_url_exists(self) -> None:
        resolved = database_url_from_secret("new-password", CURRENT_URL)
        self.assertEqual(conninfo_to_dict(resolved)["password"], "new-password")

    def test_password_only_secret_requires_existing_connection_metadata(self) -> None:
        with self.assertRaises(DatabaseCredentialError) as raised:
            database_url_from_secret('{"password":"do-not-leak"}', None)

        self.assertNotIn("do-not-leak", str(raised.exception))


class DatabaseCredentialResolutionTests(unittest.TestCase):
    def test_valid_current_url_does_not_call_secrets_manager(self) -> None:
        fetched = False

        def fetch(secret_id: str, region: str | None) -> str:
            nonlocal fetched
            fetched = True
            return "unused"

        resolution = resolve_database_url(
            CURRENT_URL,
            "dshub/database",
            region=None,
            probe=lambda url: None,
            fetch_secret=fetch,
        )

        self.assertEqual(resolution.database_url, CURRENT_URL)
        self.assertFalse(resolution.recovered_from_aws)
        self.assertFalse(fetched)

    def test_password_auth_failure_fetches_and_validates_replacement(self) -> None:
        probed: list[str] = []

        def probe(url: str) -> None:
            probed.append(url)
            if len(probed) == 1:
                raise psycopg.OperationalError("password authentication failed for user")

        resolution = resolve_database_url(
            CURRENT_URL,
            "dshub/database",
            region="us-east-1",
            probe=probe,
            fetch_secret=lambda secret_id, region: '{"password":"new-password"}',
        )

        self.assertTrue(resolution.recovered_from_aws)
        self.assertEqual(len(probed), 2)
        self.assertEqual(conninfo_to_dict(resolution.database_url)["password"], "new-password")

    def test_non_authentication_database_error_does_not_fetch_secret(self) -> None:
        fetched = False

        def fetch(secret_id: str, region: str | None) -> str:
            nonlocal fetched
            fetched = True
            return "unused"

        with self.assertRaisesRegex(DatabaseCredentialError, "no es de autenticación"):
            resolve_database_url(
                CURRENT_URL,
                "dshub/database",
                region=None,
                probe=lambda url: (_ for _ in ()).throw(
                    psycopg.OperationalError("connection timed out")
                ),
                fetch_secret=fetch,
            )

        self.assertFalse(fetched)

    def test_missing_database_url_fetches_complete_secret(self) -> None:
        complete_url = "postgresql://app:new-password@db.internal/dshub"
        resolution = resolve_database_url(
            None,
            "dshub/database",
            region=None,
            probe=lambda url: None,
            fetch_secret=lambda secret_id, region: json.dumps({"DATABASE_URL": complete_url}),
        )

        self.assertEqual(resolution.database_url, complete_url)
        self.assertTrue(resolution.recovered_from_aws)

    def test_recovered_credential_failure_has_sanitized_error(self) -> None:
        attempts = 0

        def probe(url: str) -> None:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise psycopg.OperationalError("password authentication failed")
            raise psycopg.OperationalError("password authentication failed: new-password")

        with self.assertRaises(DatabaseCredentialError) as raised:
            resolve_database_url(
                CURRENT_URL,
                "dshub/database",
                region=None,
                probe=probe,
                fetch_secret=lambda secret_id, region: '{"password":"new-password"}',
            )

        self.assertNotIn("new-password", str(raised.exception))

    def test_pg_hba_rejection_fetches_and_validates_replacement(self) -> None:
        """RDS surfaces a rotated password as a pg_hba.conf rejection (28000),
        not the invalid_password SQLSTATE (28P01) the old check looked for
        exclusively. Regression for a real production symptom: this repo's
        AWS Secrets Manager fallback never triggered because the code raised
        "no es de autenticación" instead of trying AWS, since the exact
        server message it saw wasn't recognized as a credential failure."""
        probed: list[str] = []

        def probe(url: str) -> None:
            probed.append(url)
            if len(probed) == 1:
                exc = psycopg.OperationalError(
                    'connection failed: connection to server at "db.internal" '
                    'failed: FATAL:  no pg_hba.conf entry for host "10.0.0.5", '
                    'user "app", database "dshub", no encryption'
                )
                exc.sqlstate = "28000"
                raise exc

        resolution = resolve_database_url(
            CURRENT_URL,
            "dshub/database",
            region="us-east-1",
            probe=probe,
            fetch_secret=lambda secret_id, region: '{"password":"rotated-password"}',
        )

        self.assertTrue(resolution.recovered_from_aws)
        self.assertEqual(len(probed), 2)
        self.assertEqual(conninfo_to_dict(resolution.database_url)["password"], "rotated-password")

    def test_pg_hba_rejection_detected_by_message_when_sqlstate_is_missing(self) -> None:
        """Some connection paths only expose the composed message, without a
        parsed SQLSTATE (see the plain Connection-refused case below, which
        must keep NOT triggering AWS)."""
        probed: list[str] = []

        def probe(url: str) -> None:
            probed.append(url)
            if len(probed) == 1:
                raise psycopg.OperationalError(
                    'FATAL:  no pg_hba.conf entry for host "10.0.0.5", user "app", '
                    'database "dshub", no encryption'
                )

        resolution = resolve_database_url(
            CURRENT_URL,
            "dshub/database",
            region=None,
            probe=probe,
            fetch_secret=lambda secret_id, region: '{"password":"rotated-password"}',
        )

        self.assertTrue(resolution.recovered_from_aws)


class DatabaseCredentialProviderTests(unittest.TestCase):
    def test_conninfo_callable_returns_current_url_without_recovering(self) -> None:
        provider = DatabaseCredentialProvider(
            CURRENT_URL, "dshub/database", region=None, probe=lambda url: None,
        )
        self.assertEqual(provider(), CURRENT_URL)

    def test_recover_updates_conninfo_after_reconnect_failed(self) -> None:
        probed: list[str] = []

        def probe(url: str) -> None:
            probed.append(url)
            if len(probed) == 1:
                raise psycopg.OperationalError("password authentication failed for user")

        provider = DatabaseCredentialProvider(
            CURRENT_URL,
            "dshub/database",
            region=None,
            probe=probe,
            fetch_secret=lambda secret_id, region: '{"password":"rotated-password"}',
        )

        changed = asyncio.run(provider.recover())

        self.assertTrue(changed)
        self.assertEqual(conninfo_to_dict(provider())["password"], "rotated-password")

    def test_on_reconnect_failed_never_raises_when_aws_recovery_fails_too(self) -> None:
        """A real outage (AWS unreachable, or the rotated secret is also bad)
        must not propagate out of the pool's maintenance worker; the pool
        already logs and keeps retrying on its own schedule."""

        def probe(url: str) -> None:
            raise psycopg.OperationalError("password authentication failed for user")

        def fetch_secret(secret_id: str, region: str | None) -> str:
            raise SecretRetrievalError("AWS CLI no pudo recuperar el secreto")

        provider = DatabaseCredentialProvider(
            CURRENT_URL, "dshub/database", region=None, probe=probe, fetch_secret=fetch_secret,
        )

        asyncio.run(provider.on_reconnect_failed(pool=object()))  # must not raise

    def test_concurrent_recover_calls_only_probe_once(self) -> None:
        """Two callers racing `recover()` (e.g. two pool workers hitting
        `reconnect_failed` around the same time) must not both hit AWS."""
        probe_calls = 0
        fetch_calls = 0

        def probe(url: str) -> None:
            nonlocal probe_calls
            probe_calls += 1
            if probe_calls == 1:
                raise psycopg.OperationalError("password authentication failed for user")

        def fetch_secret(secret_id: str, region: str | None) -> str:
            nonlocal fetch_calls
            fetch_calls += 1
            return '{"password":"rotated-password"}'

        provider = DatabaseCredentialProvider(
            CURRENT_URL, "dshub/database", region=None, probe=probe, fetch_secret=fetch_secret,
        )

        async def run_both() -> tuple[bool, bool]:
            return await asyncio.gather(provider.recover(), provider.recover())

        first, second = asyncio.run(run_both())

        self.assertEqual(fetch_calls, 1)
        self.assertTrue(first or second)


if __name__ == "__main__":
    unittest.main()
