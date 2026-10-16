"""Unit coverage for the shared retry-delay helper (BE-RETRY-001).

The helper is pure, so the jitter is injected instead of mocked: value 1.0
pins full jitter to its upper bound (the exponential base, i.e. the exact
pre-jitter value) and 0.5/0.0 exercise the scaling and the floor.
"""
import unittest

from app.cross.services.retry_backoff import retry_delay


class RetryDelayTests(unittest.TestCase):
    def test_exponential_backoff_with_pinned_jitter_and_transport_caps(self):
        for attempt, expected in ((0, 1.0), (1, 2.0), (2, 4.0), (3, 8.0)):
            self.assertEqual(retry_delay(attempt, cap=8, random_value=lambda: 1.0), expected)
        # CyberArk/OAuth cap: attempt 4 would be 16 s, capped to 8 s.
        self.assertEqual(retry_delay(4, cap=8, random_value=lambda: 1.0), 8.0)
        # Netskope cap: the same attempt stays below its 60 s cap.
        self.assertEqual(retry_delay(4, cap=60, random_value=lambda: 1.0), 16.0)
        self.assertEqual(retry_delay(10, cap=60, random_value=lambda: 1.0), 60.0)
        # Negative attempts (defensive) behave like attempt 0.
        self.assertEqual(retry_delay(-3, cap=8, random_value=lambda: 1.0), 1.0)

    def test_jitter_scales_the_backoff_and_never_exceeds_the_cap(self):
        self.assertEqual(retry_delay(2, cap=8, random_value=lambda: 0.5), 2.0)
        self.assertEqual(retry_delay(2, cap=8, random_value=lambda: 0.0), 0.0)
        for attempt in range(12):
            with self.subTest(attempt=attempt):
                self.assertLessEqual(retry_delay(attempt, cap=8, random_value=lambda: 0.999), 8.0)
                self.assertLessEqual(retry_delay(attempt, cap=60, random_value=lambda: 0.999), 60.0)
        # Values outside [0, 1) are clamped instead of overshooting the cap.
        self.assertEqual(retry_delay(3, cap=8, random_value=lambda: 5.0), 8.0)
        self.assertEqual(retry_delay(3, cap=8, random_value=lambda: -2.0), 0.0)

    def test_retry_after_wins_over_the_backoff_and_is_not_jittered(self):
        self.assertEqual(retry_delay(0, cap=8, retry_after=3.5, random_value=lambda: 0.9), 3.5)
        self.assertEqual(retry_delay(4, cap=8, retry_after=3.5, random_value=lambda: 0.0), 3.5)
        # The caller clamps; the helper only floors at zero.
        self.assertEqual(retry_delay(0, cap=8, retry_after=-2.0), 0.0)
        # A server hint above the transport cap is honored as-is: the
        # exponential cap bounds the backoff, not the Retry-After contract.
        self.assertEqual(retry_delay(0, cap=8, retry_after=120.0), 120.0)
