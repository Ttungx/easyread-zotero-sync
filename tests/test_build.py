import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("sync_build", ROOT / "build.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuildTests(unittest.TestCase):
    def test_packages_are_independent_and_contain_only_distribution_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            xpi, source = builder.build(tmp)
            self.assertEqual(xpi.name, "easyread-zotero-sync-0.2.3.xpi")
            with zipfile.ZipFile(xpi) as package:
                names = package.namelist()
                manifest = json.loads(package.read("manifest.json"))
                self.assertEqual(manifest["applications"]["zotero"]["id"], "easyread-zotero-sync@local.research")
                self.assertEqual(manifest["version"], "0.2.3")
                self.assertEqual(manifest["applications"]["zotero"]["update_url"], "https://raw.githubusercontent.com/Ttungx/easyread-zotero-sync/main/updates.json")
                self.assertEqual(manifest["applications"]["zotero"]["strict_min_version"], "10.0")
                self.assertEqual(manifest["applications"]["zotero"]["strict_max_version"], "10.0.*")
                for required in ["translation.js", "reader.css", "preferences.xhtml", "preferences.js", "preferences.css", "vendor/katex.min.js", "vendor/katex.css", "vendor/markup.js", "LICENSE"]:
                    self.assertIn(required, names)
                for excluded in ["THIRD_PARTY_NOTICES.md", "LICENSES/KaTeX-MIT.txt", "AGENTS.md"]:
                    self.assertNotIn(excluded, names)
                self.assertIn("data:font/woff2;base64,", package.read("vendor/katex.css").decode())
                self.assertNotIn("url(fonts/", package.read("vendor/katex.css").decode())
            with zipfile.ZipFile(source) as package:
                names = package.namelist()
                self.assertIn("tests/core.test.cjs", names)
                self.assertNotIn("docs/plan-sync-translation-content.md", names)
            for name in names:
                self.assertFalse(any(part in name.split("/") for part in ["reference", "test-work", "__pycache__", ".pi", "dist", "AGENTS.md"]))


if __name__ == "__main__":
    unittest.main()
