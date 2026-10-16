"""NSK-USR-001: a user's status comes from accounts[].active/deleted, as the Netskope console counts it."""

import unittest

from app.cross.services.cmdb_models import deduplicate_snapshot
from app.netskope.sse.services.netskope_mapping import map_netskope_objects, netskope_account_summary, netskope_deleted_user_ids


def _user(source_id, *accounts, email=None):
    return {"id": source_id, "givenName": "A", "familyName": "B", "emails": [email or f"{source_id}@itti.digital"], "accounts": list(accounts)}


def _account(active=True, deleted=False, provisioner="SCIM", **extra):
    return {"scimId": "s", "active": active, "deleted": deleted, "provisioner": provisioner, **extra}


class NetskopeUserAccountsMappingTests(unittest.TestCase):
    def test_a_user_with_a_live_active_account_is_enabled(self):
        summary = netskope_account_summary(_user("u", _account(), _account(active=False, provisioner="AD")))
        self.assertEqual(summary["attributes"], {"account_status": "enabled", "accounts_active": 1, "accounts_inactive": 1, "provisioners": ["AD", "SCIM"]})

    def test_a_user_whose_live_accounts_are_all_inactive_is_disabled(self):
        summary = netskope_account_summary(_user("u", _account(active=False), _account(active=False)))
        self.assertEqual((summary["attributes"]["account_status"], summary["attributes"]["accounts_active"], summary["attributes"]["accounts_inactive"]), ("disabled", 0, 2))

    def test_deleted_accounts_do_not_exist_for_the_console(self):
        # An active but deleted account neither enables the user nor counts as an account.
        summary = netskope_account_summary(_user("u", _account(active=True, deleted=True), _account(active=False)))
        self.assertEqual((summary["attributes"]["account_status"], summary["attributes"]["accounts_active"], summary["attributes"]["accounts_inactive"]), ("disabled", 0, 1))

    def test_a_user_with_only_deleted_accounts_is_not_a_user_and_leaves_the_snapshot(self):
        self.assertTrue(netskope_account_summary(_user("u", _account(deleted=True)))["deleted_only"])
        objects = map_netskope_objects([_user("gone", _account(deleted=True)), _user("kept", _account())], [])
        self.assertEqual([item.source_id for item in objects], ["kept"])

    def test_missing_or_unusable_accounts_mean_unknown_never_deleted_or_disabled(self):
        for user in ({"id": "u", "emails": ["u@itti.digital"]}, _user("u"), {**_user("u"), "accounts": "x"}, {**_user("u"), "accounts": [1, 2]}):
            self.assertIsNone(netskope_account_summary(user))
        kept = map_netskope_objects([_user("u")], [])
        self.assertEqual(kept[0].attributes, {"email": "u@itti.digital", "company": "ITTI"})

    def test_only_an_explicit_true_deletes(self):
        for flag in (None, "true", 1, "yes"):
            account = {"scimId": "s", "active": True}
            if flag is not None:
                account["deleted"] = flag
            self.assertFalse(netskope_account_summary(_user("u", account))["deleted_only"], flag)

    def test_only_an_explicit_boolean_is_evidence_of_the_status(self):
        # A missing or non-boolean `active` is no evidence: the user is unknown, never a false "disabled".
        for flag in (None, "true", "false", 1, 0, "yes"):
            account = {"scimId": "s", "deleted": False}
            if flag is not None:
                account["active"] = flag
            self.assertIsNone(netskope_account_summary(_user("u", account)), flag)
            self.assertNotIn("account_status", map_netskope_objects([_user("u", account)], [])[0].attributes)

    def test_an_empty_account_object_is_unknown_not_disabled(self):
        self.assertIsNone(netskope_account_summary(_user("u", {})))
        self.assertEqual(map_netskope_objects([_user("u", {})], [])[0].attributes, {"email": "u@itti.digital", "company": "ITTI"})

    def test_a_disabled_user_needs_every_live_account_explicitly_inactive(self):
        self.assertIsNone(netskope_account_summary(_user("u", _account(active=False), {"scimId": "x"})))
        self.assertEqual(netskope_account_summary(_user("u", _account(active=False), _account(active=False)))["attributes"]["account_status"], "disabled")
        # A deleted account with no evidence does not weaken the rest.
        self.assertEqual(netskope_account_summary(_user("u", _account(active=False), {"scimId": "x", "deleted": True}))["attributes"]["account_status"], "disabled")

    def test_one_explicitly_active_account_enables_even_if_another_has_no_evidence(self):
        summary = netskope_account_summary(_user("u", _account(), {"scimId": "x"}, _account(active=False)))
        self.assertEqual((summary["attributes"]["account_status"], summary["attributes"]["accounts_active"], summary["attributes"]["accounts_inactive"]), ("enabled", 1, 1))

    def test_contradictory_repeats_of_one_id_fail_before_any_user_is_left_out(self):
        gone = _user("u", _account(deleted=True))
        alive = _user("u", _account())
        for rows in ([gone, alive], [alive, gone]):
            with self.assertRaises(ValueError):
                map_netskope_objects(rows, [])
        # The same id with different live content is contradictory too.
        with self.assertRaises(ValueError):
            map_netskope_objects([_user("u", _account()), _user("u", _account(active=False))], [])

    def test_identical_repeats_of_a_deleted_only_user_are_harmless(self):
        gone = _user("u", _account(deleted=True))
        self.assertEqual(map_netskope_objects([gone, dict(gone), _user("k", _account())], []), map_netskope_objects([_user("k", _account())], []))
        self.assertEqual(netskope_deleted_user_ids([gone, dict(gone)]), {"u"})

    def test_a_repeated_row_is_identical_after_mapping(self):
        # Netskope repeats a row at a page boundary; identical rows must not read as a conflicting observation.
        row = _user("u", _account(), _account(active=False))
        objects, _ = deduplicate_snapshot(map_netskope_objects([row, dict(row)], []), [])
        self.assertEqual(len(objects), 1)

    def test_no_account_detail_beyond_the_allowlist_is_persisted(self):
        row = _user("u", _account(userName="secret.name", ou="OU=Finanzas", parentGroups=["g1"], lastModified=1.0, emails=["x@y.z"]))
        attributes = map_netskope_objects([row], [])[0].attributes
        self.assertEqual(set(attributes), {"email", "company", "account_status", "accounts_active", "accounts_inactive", "provisioners"})
        self.assertNotIn("secret.name", str(attributes))
        self.assertNotIn("Finanzas", str(attributes))


if __name__ == "__main__":
    unittest.main()
