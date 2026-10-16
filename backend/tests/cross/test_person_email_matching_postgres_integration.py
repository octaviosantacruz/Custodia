"""Executes the person-email helper SQL and the SIA reference queries against
real PostgreSQL.

Every other test mocks the cursor, so a bare `%` (psycopg uses client-side
binding, where a literal percent must be written as `%%`) or a malformed
fragment would pass the whole gate and only fail at runtime. This was a real
regression: `pam_human_user_sql` shipped `NOT LIKE 'cyberark.cloud.%'` and
raised `ProgrammingError` on the first real query.

Opt-in only: requires DSHUB_TEST_DATABASE_URL. See pg_integration_base.py.
"""

import unittest

from app.cyberark.sia.repositories.sia_queries import policies_linked_to_safe, policies_referencing_grantee
from app.cross.services.person_email_matching import (
    PERSON_EMAIL_SHAPE_SQL,
    normalize_person_email,
    pam_human_user_sql,
)
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class PersonEmailMatchingPostgresTests(PostgresIntegrationTestCase):
    async def test_pam_human_user_sql_executes_against_a_real_server(self):
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(f"""
                    SELECT count(*)::int AS total
                    FROM public.cyberark_inventory_objects u
                    WHERE u.source_system = 'cyberark' AND u.object_type = 'user'
                      AND ({pam_human_user_sql('u')})
                """)
                row = await cur.fetchone()
        self.assertGreaterEqual(row["total"], 0)

    async def test_python_normalization_agrees_with_the_sql_shape(self):
        # TEST-PROP-001: the module calls PERSON_EMAIL_SHAPE_SQL the mirror of
        # normalize_person_email, so the sanctioned predicate must accept
        # exactly the same values on both sides. Only values without
        # non-space edge whitespace are listed: Python's str.strip() is a
        # documented superset of btrim (spaces only) at the edges.
        values = (
            "ada@example.com", "  Ada@Example.COM ", "ada+reports@example.com",
            "ada@.", "ada@.com", "ada@com.", "ada@b.c", "ada smith@example.com",
            "ada@exa mple.com", "ada", "@example.com", "ada@", "a@b@c.com", "",
        )
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                for value in values:
                    await cur.execute(
                        f"SELECT (lower(btrim(%s)) ~ {PERSON_EMAIL_SHAPE_SQL}) AS shape_ok,"
                        " lower(btrim(%s)) AS normalized",
                        (value, value),
                    )
                    row = await cur.fetchone()
                    normalized = normalize_person_email(value)
                    with self.subTest(value=value):
                        if row["shape_ok"]:
                            self.assertEqual(normalized, row["normalized"])
                        else:
                            self.assertIsNone(normalized)

    async def test_sia_reference_queries_execute_against_a_real_server(self):
        self.assertEqual(await policies_referencing_grantee(self.pool, "sin-coincidencia", include_roles=True), [])
        self.assertEqual(await policies_linked_to_safe(self.pool, -1), [])


if __name__ == "__main__":
    unittest.main()
