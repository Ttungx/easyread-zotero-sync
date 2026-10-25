"""Build EasyRead Sync without upstream applications, user data, or machine-specific paths."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parent


def build(out=None):
    out = Path(out) if out else ROOT / "dist"
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / "zotero/manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    assert manifest["applications"]["zotero"]["id"] == "easyread-zotero-sync@local.research"
    xpi = out / f"easyread-zotero-sync-{version}.xpi"
    with zipfile.ZipFile(xpi, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted((ROOT / "zotero").rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(ROOT / "zotero").as_posix())
        archive.write(ROOT / "LICENSE", "LICENSE")
    source = out / f"easyread-zotero-sync-{version}-source.zip"
    with zipfile.ZipFile(source, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in ["README.md", "README.en.md", "VALIDATION.md", "LICENSE", "build.py"]:
            archive.write(ROOT / name, name)
        for folder in ["zotero", "tests", "desktop", ".github"]:
            for path in sorted((ROOT / folder).rglob("*")):
                if path.is_file() and "__pycache__" not in path.parts:
                    archive.write(path, path.relative_to(ROOT).as_posix())
    return xpi, source


if __name__ == "__main__":
    for artifact in build():
        print(artifact.name, hashlib.sha256(artifact.read_bytes()).hexdigest())
