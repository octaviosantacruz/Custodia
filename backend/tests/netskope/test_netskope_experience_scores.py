"""ADEM score projections: 0-100 only, "Sin dato" is never zero."""

import unittest

from app.netskope.sse.services.netskope_experience import map_adem_device_scores, map_adem_user_score, weakest_component


class AdemScoreMappingTests(unittest.TestCase):
    def test_maps_the_overall_and_component_scores(self):
        payload = {'aggregationType': 'avg', 'metrics': {'appScore': 100, 'deviceScore': 96, 'expScore': 52, 'networkScore': 15}}
        self.assertEqual(map_adem_device_scores(payload), {'exp_score': 52, 'device_score': 96, 'network_score': 15, 'app_score': 100})

    def test_a_missing_score_stays_none_and_an_invalid_one_is_rejected(self):
        self.assertEqual(map_adem_device_scores({'metrics': {'expScore': 70}})['network_score'], None)
        self.assertIsNone(map_adem_user_score({'user': 'x'}))
        for bad in (-1, 101, True, '50'):
            with self.assertRaises(ValueError):
                map_adem_user_score({'expScore': bad})
        with self.assertRaises(ValueError):
            map_adem_device_scores({'metrics': None})

    def test_weakest_component_ignores_missing_values(self):
        self.assertIsNone(weakest_component([{'device_score': None, 'network_score': None, 'app_score': None}]))
        self.assertEqual(weakest_component([{'device_score': 90, 'network_score': 15, 'app_score': 100}]), 'network')
        self.assertEqual(weakest_component([{'device_score': 40, 'network_score': None, 'app_score': 100}, {'device_score': 80, 'network_score': 70, 'app_score': 20}]), 'app')
