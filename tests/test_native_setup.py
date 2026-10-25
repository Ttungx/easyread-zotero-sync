"""Fast checks for the headless test's HTTP fixtures; never launches Zotero."""
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen

from setup_native import fixture_server, stage_live_paper


class NativeSetupTests(unittest.TestCase):
    def test_fixture_service_exports_current_data_over_http_and_rejects_unknown_routes(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixtures = Path(tmp)
            payload = {"paper": {"meta": {"source_sha256": "a" * 64}}, "reader": {"edits": {}}, "images": {}}
            path = fixtures / "export-data.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with fixture_server(fixtures) as server:
                base = f"http://127.0.0.1:{server.server_port}"
                with urlopen(base + "/api/version") as response:
                    self.assertEqual(json.load(response)["api"], 1)
                with urlopen(base + "/api/library") as response:
                    self.assertEqual(json.load(response)["items"], [{"id": "a" * 12}])
                with urlopen(base + "/api/p/aaaaaaaaaaaa/part/job") as response:
                    self.assertEqual(json.load(response)["data"]["state"], "done")
                payload["reader"]["edits"] = {"p1": {"zh": "更新后的译文"}}
                path.write_text(json.dumps(payload), encoding="utf-8")
                with urlopen(base + "/api/p/aaaaaaaaaaaa/export?mobile=1") as response:
                    exported = response.read().decode()
                self.assertIn("更新后的译文", exported)
                self.assertIn('id="pr-data"', exported)
                self.assertIn("SERVICE SCRIPT EXECUTED", exported)
                with self.assertRaises(HTTPError) as error:
                    urlopen(base + "/api/p/aaaaaaaaaaaa/state")
                self.assertEqual(error.exception.code, 404)
                with self.assertRaises(HTTPError) as error:
                    urlopen(base + "/api/p/bbbbbbbbbbbb/part/paper")
                self.assertEqual(error.exception.code, 404)

    def test_live_source_rejects_remote_urls_and_invalid_ids_before_network_access(self):
        for url, paper_id in [("http://example.com:1234", "a" * 12), ("http://127.0.0.1:65536", "a" * 12),
                ("http://127.0.0.1:1234/path", "a" * 12), ("http://127.0.0.1:1234", "../paper")]:
            with self.subTest(url=url, paper_id=paper_id), self.assertRaises(ValueError):
                stage_live_paper(Path("unused-profile"), url, paper_id)


if __name__ == "__main__":
    unittest.main()
