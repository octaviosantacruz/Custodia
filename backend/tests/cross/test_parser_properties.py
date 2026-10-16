"""TEST-PROP-001 pilot: Hypothesis over four pure parsers.

Hypothesis is a development-only dependency (``backend/requirements-dev.txt``).
The pilot is deliberately narrow: four pure parsers that until now were pinned
only by hand-picked examples (or by none at all) — person-email normalization,
PSM server-ID resolution, CyberArk epoch conversion and Netskope version
parsing. Each property uses a small, fixed example budget and no deadline, so
the backend suite neither turns into a property-testing migration nor slows
down noticeably.

The SQL twins of the email and version parsers are additionally checked
against real PostgreSQL in
``test_person_email_matching_postgres_integration.py`` and
``test_netskope_baselines_postgres_integration.py``.
"""

import re
import unittest
from datetime import datetime, timedelta, timezone

from hypothesis import given, settings, strategies as st

from app.netskope.sse.repositories.netskope_shared import parse_version
from app.cyberark.pam.services.ingestion_compare import _epoch_to_datetime
from app.cyberark.pam.services.pam_mapping import resolve_psm_server_id
from app.cross.services.person_email_matching import normalize_person_email


def pilot(test):
    """Small, fixed budget per property so the full suite stays fast."""
    return settings(max_examples=25, deadline=None)(test)


class NormalizePersonEmailProperties(unittest.TestCase):
    @pilot
    @given(st.text())
    def test_is_idempotent(self, value):
        once = normalize_person_email(value)
        self.assertEqual(normalize_person_email(once), once)

    @pilot
    @given(st.text())
    def test_never_raises_for_arbitrary_text(self, value):
        normalize_person_email(value)

    @pilot
    @given(st.text())
    def test_result_is_a_lowercased_full_address(self, value):
        result = normalize_person_email(value)
        if result is None:
            return
        self.assertEqual(result, result.strip().lower())
        local, _, domain = result.partition("@")
        label_before, _, label_after = domain.partition(".")
        self.assertTrue(local and label_before and label_after)


class ResolvePsmServerIdProperties(unittest.TestCase):
    @pilot
    @given(st.text(min_size=1), st.lists(st.text(min_size=1), max_size=6))
    def test_is_deterministic_and_case_consistent(self, psm_server_id, catalog_ids):
        # Same construction map_pam_objects uses for the PSM catalog: every
        # catalog ID (non-empty, possibly repeated verbatim) is appended under
        # its casefold key.
        catalog_by_folded: dict[str, list[str]] = {}
        for catalog_id in catalog_ids:
            catalog_by_folded.setdefault(catalog_id.casefold(), []).append(catalog_id)
        first = resolve_psm_server_id(psm_server_id, catalog_by_folded)
        self.assertEqual(resolve_psm_server_id(psm_server_id, catalog_by_folded), first)
        resolved, status = first
        candidates = catalog_by_folded.get(psm_server_id.casefold(), [])
        self.assertIn(status, {"exact", "casefold", "ambiguous", "missing"})
        if status == "ambiguous":
            self.assertIsNone(resolved)
            self.assertGreaterEqual(len(set(candidates)), 2)
            return
        self.assertIsNotNone(resolved)
        # pam_mapping.py relies on the edge landing on a catalog ID that is
        # equivalent to the platform reference under casefold().
        self.assertEqual(resolved.casefold(), psm_server_id.casefold())
        if status == "missing":
            self.assertEqual(resolved, psm_server_id)
        else:
            self.assertIn(resolved, candidates)

    @pilot
    @given(st.text(min_size=1))
    def test_repeated_identical_catalog_entries_are_not_ambiguity(self, catalog_id):
        # The catalog builder appends every /API/PSM/Servers entry, so the
        # same ID repeated verbatim reaches this resolver as two candidates.
        catalog_by_folded = {catalog_id.casefold(): [catalog_id, catalog_id]}
        self.assertEqual(
            resolve_psm_server_id(catalog_id, catalog_by_folded),
            (catalog_id, "exact"),
        )
        variant = catalog_id.lower()
        if variant == catalog_id or variant.casefold() != catalog_id.casefold():
            return
        self.assertEqual(
            resolve_psm_server_id(variant, catalog_by_folded),
            (catalog_id, "casefold"),
        )


class EpochToDatetimeProperties(unittest.TestCase):
    EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
    # from ingestion_compare: values above this are microseconds.
    MICROSECOND_THRESHOLD = 100_000_000_000_000
    # Last whole second datetime can represent (9999-12-31T23:59:59Z), so both
    # encodings of the instant stay inside the supported range.
    MAX_SECONDS = 253_402_300_799

    @pilot
    @given(st.integers(min_value=100_000_001, max_value=MAX_SECONDS))
    def test_same_instant_in_seconds_or_microseconds_decodes_equally(self, seconds):
        moment = self.EPOCH + timedelta(seconds=seconds)
        self.assertEqual(_epoch_to_datetime(seconds), moment)
        self.assertEqual(_epoch_to_datetime(seconds * 1_000_000), moment)

    @pilot
    @given(st.integers(min_value=100_000_000_000_001, max_value=2**52))
    def test_microsecond_payloads_round_trip_exactly(self, raw):
        self.assertEqual(_epoch_to_datetime(raw), self.EPOCH + timedelta(microseconds=raw))

    @pilot
    @given(st.datetimes(min_value=datetime(1973, 3, 3), max_value=datetime(2100, 1, 1)))
    def test_naive_datetimes_are_read_as_utc(self, value):
        self.assertEqual(_epoch_to_datetime(value), value.replace(tzinfo=timezone.utc))

    def test_offset_aware_datetimes_shift_to_utc(self):
        value = datetime(2026, 9, 27, 12, 0, tzinfo=timezone(timedelta(hours=-3)))
        self.assertEqual(_epoch_to_datetime(value), value.astimezone(timezone.utc))

    def test_threshold_is_exclusive_at_the_exact_boundary(self):
        just_above = self.MICROSECOND_THRESHOLD + 1
        self.assertEqual(
            _epoch_to_datetime(just_above),
            self.EPOCH + timedelta(microseconds=just_above),
        )
        # At exactly 1e14 the value is still read as seconds. The seconds
        # interpretation of that value is outside datetime's range while a
        # microsecond reading would have returned 1973-03-03, so the raise is
        # the observable proof that the `>` boundary did not shift.
        with self.assertRaises(ValueError):
            _epoch_to_datetime(self.MICROSECOND_THRESHOLD)


class ParseVersionProperties(unittest.TestCase):
    @pilot
    @given(
        st.lists(
            st.integers(min_value=0, max_value=9999).map(str),
            min_size=1,
            max_size=5,
        ).map(".".join),
        st.text(max_size=8),
    )
    def test_numeric_prefix_is_parsed_and_trailing_text_is_ignored(self, version, trailing):
        expected = [int(part) for part in version.split(".")]
        self.assertEqual(parse_version(version), expected)
        self.assertEqual(parse_version(f"{version} {trailing}"), expected)
        self.assertEqual(parse_version(f"\t{version}\n(trailing)"), expected)

    @pilot
    @given(st.text().filter(lambda value: re.match(r"^\s*[0-9]", value, re.ASCII) is None))
    def test_values_without_an_ascii_numeric_prefix_are_none(self, value):
        self.assertIsNone(parse_version(value))

    @pilot
    @given(st.text(max_size=200))
    def test_never_raises_for_arbitrary_text(self, value):
        parse_version(value)

    def test_digit_runs_past_pythons_int_limit_return_none(self):
        # Measured boundary from the pilot: CPython refuses int() beyond 4300
        # digits, which used to make parse_version raise. The only caller caps
        # input at 40 characters; a longer run is "not comparable", not a
        # crash.
        self.assertIsNone(parse_version("9" * 4301))
        self.assertEqual(parse_version("9" * 40), [int("9" * 40)])

    def test_ascii_only_digits_keep_the_sql_twin_contract(self):
        # Measured against PostgreSQL 18 (--no-locale): the twin expression
        # never matches Arabic-Indic or fullwidth digits, while Python's
        # Unicode \d used to turn "1２" into 12.
        self.assertIsNone(parse_version("٣.٤"))
        self.assertEqual(parse_version("1２"), [1])
        self.assertIsNone(parse_version("\u00a0141"))

    def test_segment_ordering_is_numeric_not_lexicographic(self):
        self.assertLess(parse_version("9"), parse_version("10"))
        self.assertLess(parse_version("141.0.0"), parse_version("141.0.1"))
        self.assertLess(parse_version("141.0"), parse_version("141.0.0.0"))


if __name__ == "__main__":
    unittest.main()
