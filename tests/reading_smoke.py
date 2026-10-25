"""Optional headless document checks (installed Playwright + Chrome); never controls the desktop."""
import argparse
import json
from pathlib import Path
import re
import subprocess
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--easyread-url")
    parser.add_argument("--paper-id")
    parser.add_argument("--html", type=Path, help="Check an already stored attachment without rendering it again")
    args = parser.parse_args()
    if args.html and args.easyread_url:
        parser.error("--html cannot be combined with --easyread-url")
    work = ROOT / "test-work"
    work.mkdir(exist_ok=True)
    raw = work / "reading-export.html"
    output = work / "reading.html"
    if args.html:
        output = args.html.resolve(strict=True)
    elif args.easyread_url:
        if not re.fullmatch(r"http://127\.0\.0\.1:[1-9][0-9]{0,4}", args.easyread_url) or not re.fullmatch(r"[a-f0-9]{12}", args.paper_id or ""):
            parser.error("Use a loopback EasyRead URL and a 12-character paper fingerprint")
        base = args.easyread_url + "/api/p/" + args.paper_id
        with urlopen(base + "/part/paper", timeout=15) as response:
            paper = json.load(response)["data"]
        with urlopen(base + "/part/job", timeout=15) as response:
            job = json.load(response)["data"]
        assert paper["meta"]["source_sha256"].startswith(args.paper_id)
        check = subprocess.run(["node", "-e", "const d=JSON.parse(require('node:fs').readFileSync(0,'utf8'));require('./zotero/translation.js').complete(d.paper,d.job)"], input=json.dumps({"paper":paper,"job":job}), cwd=ROOT, capture_output=True, text=True)
        if check.returncode:
            raise RuntimeError(check.stderr)
        with urlopen(base + "/export?mobile=1", timeout=120) as response:
            raw.write_bytes(response.read())
    else:
        fixture = subprocess.check_output(["node", "-e", "const f=require('./tests/reading-fixture.cjs');process.stdout.write(f.exported(f.data()))"], cwd=ROOT)
        raw.write_bytes(fixture)
    render = r"""
const fs=require('node:fs'),f=require('./tests/reading-fixture.cjs');
const data=f.translation.parseExport(fs.readFileSync(process.argv[1],'utf8'));
const css=fs.readFileSync('./zotero/vendor/katex.css','utf8')+'\n'+fs.readFileSync('./zotero/reader.css','utf8');
const rendered=f.translation.render(data,{markup:f.markup(),css});
fs.writeFileSync(process.argv[2],rendered.html);
console.log(JSON.stringify({blocks:rendered.blocks,images:rendered.images,tables:rendered.tables,bytes:Buffer.byteLength(rendered.html)}));
"""
    if args.html:
        html = output.read_text(encoding="utf-8")
        counts = {"blocks": len(re.findall(r'<section id="b-', html)), "images": len(re.findall(r"<img\b", html)),
            "tables": len(re.findall(r"<table\b", html)), "bytes": len(html.encode("utf-8"))}
        assert counts["blocks"] > 0 and 'name="easyread-format"' in html
    else:
        counts = json.loads(subprocess.check_output(["node", "-e", render, str(raw), str(output)], cwd=ROOT))
    from playwright.sync_api import sync_playwright
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True, chromium_sandbox=True)
        for theme in ["light", "dark"]:
            context = browser.new_context(java_script_enabled=False, color_scheme=theme)
            context.set_offline(True)
            context.route("**/*", lambda route: route.abort())
            page = context.new_page()
            for width in [360, 390, 768, 1280]:
                page.set_viewport_size({"width": width, "height": 844})
                page.set_content(output.read_text(encoding="utf-8"), wait_until="load")
                page.locator("img").evaluate_all("images => Promise.all(images.map(image => image.decode()))")
                page.evaluate("document.fonts.ready")
                metrics = page.evaluate("""() => ({
                    blocks:document.querySelectorAll('main > .block').length,
                    images:document.images.length,
                    brokenImages:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length,
                    tables:document.querySelectorAll('table').length,
                    formulas:document.querySelectorAll('.katex').length,
                    formulaErrors:document.querySelectorAll('.katex-error').length,
                    scripts:document.scripts.length,
                    brokenAnchors:[...document.querySelectorAll('a[href^="#"]')].filter(a=>!document.getElementById(a.getAttribute('href').slice(1))).length,
                    remoteImages:[...document.images].filter(i=>!i.src.startsWith('data:image/')).length,
                    pageWidth:document.documentElement.scrollWidth,
                    viewport:innerWidth,
                    text:document.querySelector('main').innerText.length,
                    background:getComputedStyle(document.body).backgroundColor
                })""")
                assert metrics["blocks"] == counts["blocks"], metrics
                assert metrics["images"] == counts["images"], metrics
                assert metrics["tables"] == counts["tables"], metrics
                assert not any(metrics[k] for k in ["scripts", "brokenImages", "formulaErrors", "brokenAnchors", "remoteImages"]), metrics
                assert metrics["pageWidth"] <= width + 1, metrics
                page.evaluate("document.querySelector('details').open=true")
                assert page.locator("nav a").first.is_visible()
                page.screenshot(path=str(work / f"reading-{theme}-{width}.png"))
                results.append({"theme": theme, "width": width, **metrics})
            context.close()
        browser.close()
    report = {"ok": True, "source": "stored attachment" if args.html else "live EasyRead" if args.easyread_url else "synthetic fixture", "document": counts, "checks": results}
    (work / "reading-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
