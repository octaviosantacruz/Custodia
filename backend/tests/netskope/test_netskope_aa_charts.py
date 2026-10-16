"""Tenant-declared AA charts: map validation, projection, cache and preference ids."""

import json
import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from pydantic import ValidationError

from app.netskope.sse.api.routes.netskope_dashboard_preferences import (
    NetskopeDashboardPreferenceUpdate, NetskopeWidgetInstance, without_retired_widgets,
)
from app.netskope.sse.integrations.advanced_analytics import AdvancedAnalyticsError, AnalyticsResult
from app.netskope.sse.services.netskope_aa_charts import CHARTS_ENV, AaChartCache, aa_chart_for_widget, aa_charts, public_chart
from app.netskope.sse.services.netskope_aa_metrics import AnalyticsContractError
from tests.support.netskope_aa import SETTINGS

ENTRY = {"title": "Apps por nivel GDPR", "report_id": "170", "widget_id": "288017", "label_column": "GDPR Level",
         "value_column": "# Applications", "unit": "aplicaciones", "period": "Catálogo actual"}
MAP = json.dumps({"gdpr_levels": ENTRY})


def chart():
    with patch.dict(os.environ, {CHARTS_ENV: MAP}):
        return aa_charts()["gdpr_levels"]


class AaChartMapTests(unittest.TestCase):
    def test_empty_variable_means_no_charts_and_invalid_maps_fail_closed(self):
        with patch.dict(os.environ, {CHARTS_ENV: ""}):
            self.assertEqual(aa_charts(), {})
        for bad in ("[]", "not json", json.dumps({"Bad Key": ENTRY}), json.dumps({"ok": {**ENTRY, "extra": "x"}}),
                    json.dumps({"ok": {**ENTRY, "widget_id": "a/b"}}),
                    json.dumps({"ok": {**ENTRY, "value_column": ENTRY["label_column"]}}),
                    json.dumps({"ok": {**ENTRY, "title": ""}})):
            with self.subTest(bad=bad), patch.dict(os.environ, {CHARTS_ENV: bad}):
                with self.assertRaises(AnalyticsContractError):
                    aa_charts()
                self.assertIsNone(aa_chart_for_widget("aa_ok"))

    def test_widget_id_resolves_only_for_configured_keys(self):
        with patch.dict(os.environ, {CHARTS_ENV: MAP}):
            self.assertEqual(aa_chart_for_widget("aa_gdpr_levels").key, "gdpr_levels")
            self.assertIsNone(aa_chart_for_widget("aa_other"))
            self.assertIsNone(aa_chart_for_widget("devices_by_os"))


class AaChartLabelTests(unittest.TestCase):
    def test_labels_translate_exact_names_and_stay_validated(self):
        entry = {**ENTRY, "labels": {"Low": "Bajo", "Medium": "Medio", "High": "Alto"}}
        with patch.dict(os.environ, {CHARTS_ENV: json.dumps({"gdpr_levels": entry})}):
            translated = aa_charts()["gdpr_levels"]
        result = AnalyticsResult("csv", [["GDPR Level", "# Applications"], ["Low", "6"], [" High ", "3"], ["", "1"], ["Other", "2"]])
        keys = [bucket["key"] for bucket in public_chart(result, translated)["buckets"]]
        self.assertEqual(keys, ["Bajo", "Alto", "Other", "Sin dato"])
        # Two raw labels that translate to the same name are still a duplicate.
        clash = AnalyticsResult("csv", [["GDPR Level", "# Applications"], ["Low", "6"], ["Bajo", "3"]])
        with self.assertRaises(AdvancedAnalyticsError):
            public_chart(clash, translated)
        for bad in ({"Low": ""}, {"": "Bajo"}, ["Low"], {f"L{i}": "x" for i in range(41)}):
            with self.subTest(bad=bad), patch.dict(os.environ, {CHARTS_ENV: json.dumps({"ok": {**ENTRY, "labels": bad}})}):
                with self.assertRaises(AnalyticsContractError):
                    aa_charts()


class PublicChartTests(unittest.TestCase):
    def test_tenant_csv_with_padded_header_and_blank_label_becomes_sorted_buckets(self):
        result = AnalyticsResult("csv", [["GDPR Level", " # Applications"], ["Low", "691"], ["Medium", "351"], ["High", "327"], ["", "24"]])
        value = public_chart(result, chart())
        self.assertEqual(value["buckets"], [{"key": "Low", "count": 691}, {"key": "Medium", "count": 351},
                                            {"key": "High", "count": 327}, {"key": "Sin dato", "count": 24}])
        self.assertEqual((value["total"], value["state"], value["unit"], value["period"]), (1393, "ready", "aplicaciones", "Catálogo actual"))
        self.assertNotIn("288017", json.dumps(value))

    def test_blank_headed_row_index_is_dropped_only_with_a_valid_sequence(self):
        good = AnalyticsResult("csv", [["", "GDPR Level", "# Applications"], ["0", "Low", "2"], ["1", "High", "1"]])
        self.assertEqual(public_chart(good, chart())["total"], 3)
        bad = AnalyticsResult("csv", [["", "GDPR Level", "# Applications"], ["0", "Low", "2"], ["5", "High", "1"]])
        with self.assertRaises(AdvancedAnalyticsError):
            public_chart(bad, chart())

    def test_extra_columns_duplicates_bad_counts_and_the_row_cap_fail_closed(self):
        header = ["GDPR Level", "# Applications"]
        cases = [
            [header + ["Owner"], ["Low", "1", "x"]],
            [header, ["Low", "1"], ["low ", "2"], [" Low", "3"]],
            [header, ["Low", "-1"]],
            [header, ["Low", "1.5"]],
            [header, *[[f"L{i}", "1"] for i in range(100)]],
        ]
        for table in cases:
            with self.subTest(table=table[:2]), self.assertRaises(AdvancedAnalyticsError):
                public_chart(AnalyticsResult("csv", table), chart())

    def test_thousands_grouping_is_a_whole_number_but_other_commas_are_not(self):
        header = ["GDPR Level", "# Applications"]
        value = public_chart(AnalyticsResult("csv", [header, ["Low", "12,345"], ["High", "1,234,567"], ["Medium", "999"]]), chart())
        self.assertEqual([bucket["count"] for bucket in value["buckets"]], [1234567, 12345, 999])
        for bad in ("1,23", "12,34,567", "1,5", ",123", "1,2345"):
            with self.subTest(bad=bad), self.assertRaises(AdvancedAnalyticsError):
                public_chart(AnalyticsResult("csv", [header, ["Low", bad]]), chart())

    def test_no_rows_is_empty_not_a_zero_total(self):
        value = public_chart(AnalyticsResult("csv", [["GDPR Level", "# Applications"]]), chart())
        self.assertEqual((value["state"], value["total"], value["buckets"]), ("empty", None, []))


class AaChartCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_readers_share_one_query_per_chart_and_errors_back_off(self):
        calls = []

        class Client:
            def __init__(self, settings): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *_): return None
            async def query_widget(self, report, widget, limit):
                calls.append((report, widget, limit))
                return AnalyticsResult("csv", [["GDPR Level", "# Applications"], ["Low", "2"]])

        cache = AaChartCache()
        with patch("app.netskope.sse.services.netskope_aa_charts.AdvancedAnalyticsSettings.from_environment", return_value=SETTINGS), \
                patch("app.netskope.sse.services.netskope_aa_charts.AdvancedAnalyticsClient", Client):
            first = await cache.get(chart())
            first["buckets"].clear()
            second = await cache.get(chart())
        self.assertEqual(calls, [("170", "288017", 100)])
        self.assertEqual(second["total"], 2)

        failing = MagicMock()
        failing.return_value.__aenter__ = AsyncMock(side_effect=AdvancedAnalyticsError("down"))
        failing.return_value.__aexit__ = AsyncMock(return_value=None)
        cache = AaChartCache()
        with patch("app.netskope.sse.services.netskope_aa_charts.AdvancedAnalyticsSettings.from_environment", return_value=SETTINGS), \
                patch("app.netskope.sse.services.netskope_aa_charts.AdvancedAnalyticsClient", failing):
            for _ in range(2):
                with self.assertRaises(AdvancedAnalyticsError):
                    await cache.get(chart())
        self.assertEqual(failing.call_count, 1)


class AaChartPreferenceTests(unittest.TestCase):
    def test_configured_chart_is_a_valid_widget_with_style_and_without_filters(self):
        with patch.dict(os.environ, {CHARTS_ENV: MAP}):
            widget = NetskopeWidgetInstance(id="aa_gdpr_levels", size="md", style="bars")
            self.assertEqual(widget.style, "bars")
            with self.assertRaises(ValidationError):
                NetskopeWidgetInstance(id="aa_gdpr_levels", filters={"os": "Windows"})
            with self.assertRaises(ValidationError):
                NetskopeWidgetInstance(id="aa_unknown")
            update = NetskopeDashboardPreferenceUpdate(chart_widgets=["aa_gdpr_levels"])
            self.assertEqual([item.id for item in update.widgets], ["aa_gdpr_levels"])

    def test_unconfigured_chart_is_rejected_on_write_and_dropped_on_read(self):
        with patch.dict(os.environ, {CHARTS_ENV: ""}):
            with self.assertRaises(ValidationError):
                NetskopeWidgetInstance(id="aa_gdpr_levels")
            kept = without_retired_widgets([{"id": "devices_by_os", "size": "md"}, {"id": "aa_gdpr_levels", "size": "md"}])
        self.assertEqual([item["id"] for item in kept], ["devices_by_os"])
        with patch.dict(os.environ, {CHARTS_ENV: MAP}):
            kept = without_retired_widgets([{"id": "aa_gdpr_levels", "size": "md"}])
        self.assertEqual([item["id"] for item in kept], ["aa_gdpr_levels"])


if __name__ == "__main__":
    unittest.main()
