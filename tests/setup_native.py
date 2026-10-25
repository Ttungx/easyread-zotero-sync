"""Exercise a packed XPI in a fresh headless Zotero Profile against a synthetic HTTP service."""
import argparse
from contextlib import contextmanager
import hashlib
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def synthetic_pdf():
    stream = b"BT /F1 12 Tf 40 160 Td (EASYREAD SYNC TEST ONLY) Tj ET"
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"]
    raw = b"%PDF-1.4\n"
    offsets = []
    for index, item in enumerate(objects, 1):
        offsets.append(len(raw))
        raw += str(index).encode() + b" 0 obj\n" + item + b"\nendobj\n"
    xref = len(raw)
    raw += b"xref\n0 6\n0000000000 65535 f \n"
    raw += b"".join(f"{offset:010} 00000 n \n".encode() for offset in offsets)
    return raw + f"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()


@contextmanager
def fixture_server(fixtures):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            self.server.requests.append(self.path)
            payload = json.loads((fixtures / "export-data.json").read_text(encoding="utf-8"))
            paper_id = payload["paper"]["meta"]["source_sha256"][:12]
            parts = {"paper": payload["paper"], "reader": payload["reader"], "job": {"state": "done", "failed": {}}}
            routes = {"/api/version": {"api": 1, "version": "synthetic-test"},
                "/api/library": {"items": [{"id": paper_id}], "token": "synthetic-no-model"},
                **{f"/api/p/{paper_id}/part/{key}": {"data": value} for key, value in parts.items()}}
            if self.path == f"/api/p/{paper_id}/export?mobile=1":
                body = ('<script>throw new Error("SERVICE SCRIPT EXECUTED")</script><script id="pr-data" type="application/json">'
                    + json.dumps(payload, ensure_ascii=False).replace("<", "\\u003c") + "</script>").encode()
                content_type = "text/html; charset=utf-8"
            elif self.path in routes:
                body = json.dumps(routes[self.path], ensure_ascii=False).encode()
                content_type = "application/json"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.requests = []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def setup():
    base = ROOT / "test-work"
    base.mkdir(exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="native-", dir=base))
    profile, data, fixtures = work / "profile", work / "data", work / "fixtures"
    assert profile.resolve().is_relative_to(base.resolve())
    for path in [profile / "extensions", data, fixtures]:
        path.mkdir(parents=True, exist_ok=True)
    pdf = synthetic_pdf()
    (fixtures / "source.pdf").write_bytes(pdf)
    sha = hashlib.sha256(pdf).hexdigest()
    payload = subprocess.check_output(["node", "-e", "process.stdout.write(JSON.stringify(require('./tests/reading-fixture.cjs').data(process.argv[1])))", sha], cwd=ROOT)
    (fixtures / "export-data.json").write_bytes(payload)
    registry = {"schema": 1, "attachments": {}, "notes": {}, "testMarker": "keep"}
    (profile / "easyread-zotero-sync.json").write_text(json.dumps(registry), encoding="utf-8")
    prefs = {
        "extensions.zotero.useDataDir": True, "extensions.zotero.dataDir": str(data), "extensions.zotero.firstRun2": False,
        "extensions.zotero.httpServer.enabled": False,
        "extensions.zotero.sync.autoSync": False, "app.update.auto": False, "app.update.background.enabled": False,
        "extensions.autoDisableScopes": 0, "extensions.enabledScopes": 15,
        "extensions.logging.enabled": True, "browser.dom.window.dump.enabled": True,
        "devtools.console.stdout.chrome": True, "extensions.zotero.debug.log": True,
        "extensions.zoteroWinWordIntegration.skipInstallation": True,
        "extensions.zoteroOpenOfficeIntegration.skipInstallation": True,
    }
    (profile / "prefs.js").write_text("\n".join(f"user_pref({json.dumps(k)}, {json.dumps(v)});" for k, v in prefs.items()), encoding="utf-8")
    spec = importlib.util.spec_from_file_location("easyread_sync_build", ROOT / "build.py")
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    xpi, _ = builder.build(work / "packages")
    addon_id = "easyread-sync-native-test@local.research"
    with zipfile.ZipFile(xpi) as original, zipfile.ZipFile(profile / "extensions" / (addon_id + ".xpi"), "w", zipfile.ZIP_DEFLATED) as out:
        for name in original.namelist():
            content = original.read(name)
            if name == "manifest.json":
                manifest = json.loads(content)
                manifest["applications"]["zotero"]["id"] = addon_id
                manifest["name"] = "EasyRead Sync isolated native tests"
                content = json.dumps(manifest).encode()
            elif name == "bridge.js":
                content = content.replace(b"easyread-zotero-sync@local.research", addon_id.encode())
            elif name == "bootstrap.js":
                content += ("\nconst TEST_ROOT = " + json.dumps(str(work)) + ";\n").encode()
                content += (ROOT / "tests/native_harness.js").read_bytes()
            out.writestr(name, content)
    # Keep the XPI packed: unpacking masks jar: resource-loading failures.
    return profile


def stage_live_paper(profile, url, paper_id):
    match = re.fullmatch(r"http://127\.0\.0\.1:([1-9][0-9]{0,4})", url)
    if not match or int(match[1]) > 65535 or not re.fullmatch(r"[a-f0-9]{12}", paper_id):
        raise ValueError("Use a loopback EasyRead URL and a 12-character PDF fingerprint")
    connection = HTTPConnection("127.0.0.1", int(match[1]), timeout=30)
    try:
        connection.request("GET", f"/p/{paper_id}/source.pdf")
        response = connection.getresponse()
        if response.status != 200:
            raise RuntimeError(f"Source PDF request failed: HTTP {response.status}")
        pdf = response.read(200 * 1024 * 1024 + 1)
    finally:
        connection.close()
    if len(pdf) > 200 * 1024 * 1024 or not pdf.startswith(b"%PDF-") or not hashlib.sha256(pdf).hexdigest().startswith(paper_id):
        raise ValueError("The downloaded source PDF is too large, invalid or has a different fingerprint")
    work = profile.parent
    (work / "fixtures/live-source.pdf").write_bytes(pdf)
    (work / "live.json").write_text(json.dumps({"url": url, "id": paper_id}), encoding="utf-8")


def run(profile, zotero):
    work = profile.parent
    with fixture_server(work / "fixtures") as server:
        url = f"http://127.0.0.1:{server.server_port}"
        (work / "server.json").write_text(json.dumps({"url": url}), encoding="utf-8")
        with (work / "native-process.log").open("wb") as output:
            try:
                result = subprocess.run([str(zotero), "-headless", "-no-remote", "-profile", str(profile), "-purgecaches", "-ZoteroDebugText"], stdout=output, stderr=subprocess.STDOUT, timeout=60)
            except subprocess.TimeoutExpired:
                result = None
        report_path = work / "native-report.json"
        if report_path.exists():
            report = json.loads(report_path.read_text(encoding="utf-8"))
            if result is None or result.returncode:
                report.update(ok=False, error="Zotero did not exit cleanly after writing its report")
        else:
            report = {"ok": False, "status": "blocked", "stage": "native-addon-startup", "checks": [],
                "error": "The isolated headless Zotero did not complete its harness. This is not a passing native test."}
        report.update(work=str(work), httpRequests=server.requests)
    (work / "native-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "test-work/native-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--zotero", type=Path)
    parser.add_argument("--easyread-url")
    parser.add_argument("--paper-id")
    args = parser.parse_args()
    if args.run and (not args.zotero or not args.zotero.is_file()):
        parser.error("--run requires --zotero <installed executable>")
    if bool(args.easyread_url) != bool(args.paper_id):
        parser.error("--easyread-url and --paper-id must be provided together")
    profile = setup()
    if args.easyread_url:
        stage_live_paper(profile, args.easyread_url, args.paper_id)
    print(profile, flush=True)
    if args.run:
        report = run(profile, args.zotero)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if not report.get("ok"):
            raise SystemExit(1)
