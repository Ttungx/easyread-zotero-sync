# Validation

## Evidence levels

- The user accepted one 17-page static-HTML experiment on Android Zotero. This covers that single paper only, not the plugin.
- Candidate build 0.2.1 passed automated core tests, isolated native-host checks and offline browser rendering, described below. This does not prove real-library use, WebDAV delivery or physical-device behavior.
- Physical Android acceptance remains manual.

## Core checks

```bash
node --test tests/core.test.cjs tests/compat.test.cjs
python -m unittest discover -s tests -p "test_*.py" -v
python build.py
```

36 Node tests and 5 Python tests passed (version 0.2.2). Coverage: full-translation guards, inert JSON extraction, escaping, deterministic output, attachment create/update/no-op/recovery, permission and annotation protections, registry migration and backup, resource-read failure and retry, title-based filename sanitization, Preferences logic and packaging.

## Native host checks

```bash
python tests/setup_native.py --run --zotero /absolute/path/to/zotero.exe
# Optional read-only live-paper run:
#   --easyread-url http://127.0.0.1:<port> --paper-id <12-character fingerprint>
```

Each run installs the release XPI (identity metadata adjusted, harness appended) **packed** into a fresh headless Profile under ignored `test-work/native-*/`, points it at a loopback HTTP fixture server, and launches a separate `-headless -no-remote` Zotero process. Results are written to `test-work/native-report.json`. A timeout, missing report or abnormal exit is a failure, never a pass. Tests do not modify the real Zotero library or control the desktop.

**Passed on Zotero 10.0.6 (version 0.2.1):**

- 32 synthetic end-to-end assertions: real HTTP discovery/export, packed `jar:` resource loading, native Preferences initialization and saving, attachment creation with title-based naming, same-key in-place updates, unchanged no-ops, backups, missing-file recovery, manual-edit protection, full/zero-page guards, legacy `EasyRead翻译` renaming, cleanup and stop/restart.
- 4 assertions against live EasyRead 1.4.4 / API v1 for the 22-page paper *Persistent Billable State: Denial-of-Wallet Attacks and Defenses in Tool-Calling LLM Agents*: source PDF copied over HTTP into the isolated library, initial sync created one attachment titled and named by the translated title (持久计费状态：工具调用 LLM 智能体中的拒绝钱包攻击与防御), repeat sync skipped the unchanged file. Only GET requests reached the real service.

**Offline rendering of the actual stored live attachment** (Chromium, JavaScript disabled, network blocked): 196 blocks, 15 figures, 15 tables, 137 formula instances; zero scripts, broken images, broken anchors, formula errors or remote images; no page overflow at 360/390/768/1280 px in light and dark themes.

## Changes in 0.2.2

Attachments are titled and named by the paper's translated title instead of the fixed `EasyRead翻译` (the `EasyRead` tag remains the marker). Filesystem-unsafe characters are stripped and the basename is capped at 100 characters. Existing `EasyRead翻译` attachments are renamed on the next sync even when their content is unchanged: the rename reuses the same attachment key, keeps content and annotations untouched, backs up the previous file, marks it for re-upload and removes the orphaned old file. Renaming counts as an update in the sync report.

## Root causes fixed in 0.2.1

1. Packed-XPI CSS loading used `getContentsFromURLAsync()`, which routes `jar:` URIs through `HTTP.request()` and its unsupported `nsIURI.username` getter — the reported `0x80004005` failure. Resources now use `Zotero.File.getResourceAsync()`. Earlier tests prefilled the CSS cache and unpacked addons, missing the `jar:` case.
2. Windows `PathUtils.filename()` requires an absolute path; calling it on a bare filename blocked attachment creation. Validation now rejects separators and drive syntax directly.
3. The Preferences script defined `init()` without binding the pane's load event. It now listens for the root-node `load` event on `document`.
4. KaTeX's absolutely positioned MathML nodes in wide tables escaped the scroll container (360 px page widened to 973 px). A positioned `.katex` ancestor contains them.

## Limits


Desktop baseline: Zotero 10.0.6. Export baseline: EasyRead 1.4.3 / API v1, additionally exercised live on 1.4.4. iOS, other desktop versions and long-document performance are unverified. The private export endpoint can change; incompatible output leaves the existing attachment untouched. Browser tests are not Android application tests.
