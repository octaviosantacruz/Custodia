"""Contract at the artifact boundary: coverage, usable URLs and credentials."""

import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("build_postman_collection", ROOT / "scripts/build_postman_collection.py")
generator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generator)


def requests(collection):
    for lane in collection["item"]:
        for group in lane["item"]:
            for item in group["item"]:
                yield item["request"]


class PostmanCollectionTests(unittest.TestCase):
    def test_transport_preserves_filters_body_and_authentication_choices(self):
        schema = {"paths": {
            "/devices/{object_id}": {
                "get": {"security": [{"sessionCookie": []}, {"apiBearer": []}], "parameters": [
                    {"in": "path", "name": "object_id", "required": True, "schema": {"type": "integer"}},
                    {"in": "query", "name": "freshness", "schema": {"type": "string", "default": "recent"}},
                    {"in": "query", "name": "q", "required": True, "schema": {"type": "string"}},
                ]},
                "put": {"security": [{"sessionCookie": []}, {"accessToken": []}], "parameters": [
                    {"in": "header", "name": "x-access-token", "schema": {"type": "string"}},
                ], "requestBody": {"content": {"application/json": {"schema": {"$ref": "#/components/schemas/Decision"}}}}},
            },
            "/session": {"post": {"security": [{"sessionCookie": []}]}},
            "/public": {"get": {"security": []}},
        }, "components": {"schemas": {"Decision": {"type": "object", "properties": {
            "status": {"enum": ["pending", "resolved"]}, "note": {"anyOf": [{"type": "string"}, {"type": "null"}], "default": None},
        }}}}}
        emitted = {(r["method"], r["url"]["raw"]): r for r in requests(generator.build_collection(schema))}
        self.assertEqual(len(emitted), 4)
        read = emitted["GET", "{{base_url}}/devices/:object_id"]
        self.assertEqual(read["url"]["variable"][0]["value"], "{{object_id}}")
        self.assertEqual([(q["key"], q["value"], q["disabled"]) for q in read["url"]["query"]], [("freshness", "recent", True), ("q", "REEMPLAZAR", False)])
        self.assertEqual(read["auth"]["bearer"][0]["value"], "{{read_token}}")
        write = emitted["PUT", "{{base_url}}/devices/:object_id"]
        self.assertEqual(write["auth"]["apikey"][0]["value"], "X-Access-Token")
        self.assertEqual([h["key"] for h in write["header"]], ["Content-Type"])
        self.assertEqual(json.loads(write["body"]["raw"]), {"status": "pending", "note": None})
        self.assertEqual(emitted["POST", "{{base_url}}/session"]["auth"]["type"], "noauth")
        self.assertEqual(emitted["GET", "{{base_url}}/public"]["auth"]["type"], "noauth")

    def test_login_template_uses_email_and_password_variables(self):
        collection = generator.build_collection({"paths": {"/api/auth/login": {"post": {
            "security": [], "requestBody": {"content": {"application/json": {"schema": {"type": "object"}}}},
        }}}})
        login = next(requests(collection))
        self.assertEqual(json.loads(login["body"]["raw"]), {"email": "{{email}}", "password": "{{password}}"})


if __name__ == "__main__":
    unittest.main()
