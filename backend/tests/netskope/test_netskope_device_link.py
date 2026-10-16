"""ADR 006: exact, unique name only; a repeated name links neither side."""

import unittest

from app.netskope.sse.services.netskope_device_link import link_devices_by_exact_name


def inv(object_id, name):
    return {"object_id": object_id, "name": name}


def adem(device_id, name):
    return {"device_id": device_id, "device_name": name}


class DeviceLinkTests(unittest.TestCase):
    def test_links_exact_names_ignoring_case_and_edge_spaces(self):
        links = link_devices_by_exact_name([inv(1, "NB-4WRK6F3"), inv(2, "MB-JC9")], [adem("a", " nb-4wrk6f3 "), adem("b", "MB-JC9")])
        self.assertEqual(links, {"a": 1, "b": 2})

    def test_similar_prefix_or_partial_names_never_link(self):
        self.assertEqual(link_devices_by_exact_name([inv(1, "NB-4WRK6F3")], [adem("a", "NB-4WRK6F3-2"), adem("b", "NB-4WRK6F")]), {})

    def test_a_name_repeated_on_either_side_links_neither_device(self):
        self.assertEqual(link_devices_by_exact_name([inv(1, "PC"), inv(2, "pc")], [adem("a", "PC")]), {})
        self.assertEqual(link_devices_by_exact_name([inv(1, "PC")], [adem("a", "PC"), adem("b", "pc")]), {})

    def test_missing_names_never_link(self):
        self.assertEqual(link_devices_by_exact_name([inv(1, None), inv(2, "")], [adem("a", None), adem("b", "")]), {})


if __name__ == "__main__":
    unittest.main()
