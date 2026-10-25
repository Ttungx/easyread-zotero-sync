# EasyRead Sync

An independent Zotero plugin based on [zotero-easyread](https://github.com/apple5089/zotero-easyread). It saves fully translated EasyRead papers as script-free HTML attachments titled `EasyRead翻译` for offline reading inside Zotero, with Android as the mobile target.

## Features

- Right-click **同步翻译内容** to sync up to 20 selected papers. Only papers with completed full-text translation are exported; incomplete, running or failed jobs are skipped. Translation sync never imports PDFs or starts a model job.
- Static HTML with translation, KaTeX formulas, tables, figures and references, plus a collapsible TOC and dark/print styles. No runtime scripts, chat, private notes or reading-progress data.
- The first sync creates one stored attachment tagged `EasyRead`; later syncs update it in place. Unchanged bytes are skipped; missing files are restored.
- File delivery uses Zotero's existing sync (including WebDAV); no cloud credentials are handled.

The upstream open/import and note-sync operations are retained, but translation sync never sends or translates PDFs.

## Install

Requires Zotero 10.0.x and a running EasyRead service (export baseline: 1.4.3 / API v1). The PDF must be downloaded in Zotero.

1. Run `python build.py` to get `dist/easyread-zotero-sync-0.2.1.xpi`.
2. Install the XPI through Zotero's Add-ons manager. Upgrading from 0.2.0 needs no cleanup.
3. Finish the full-text translation in EasyRead, then run the translation-sync command on the item. Matching uses the PDF's full SHA-256 fingerprint.
4. After desktop file sync finishes, sync and download the attachment on Android.

This is a candidate build: isolated-host and live-paper rendering checks passed; real-library use and physical Android remain acceptance gates. See [VALIDATION.md](VALIDATION.md).

## Connection settings

The plugin reuses the original plugin's configured directory and executable path read-only. If discovery fails, open Tools → EasyRead Sync: Connection Settings and set the data directory containing `.server.json`, or an explicit `http://127.0.0.1:port` service URL. Settings save as they change.

## Update protection

**Updating text may invalidate existing Zotero highlight positions on the HTML attachment.** Annotations are never deleted or repositioned automatically.

- Annotated or manually edited attachments are skipped in batch sync; single-item sync asks for confirmation.
- One previous HTML copy is kept locally under `easyread-zotero-sync-backups/` before each overwrite.
- Attachments pending download, in conflict, or during an active Zotero sync are never overwritten.

The plugin has its own ID, preferences, protocol and `easyread-zotero-sync.json` registry; the original extension's data is untouched. Uninstalling does not delete imported attachments. The manifest's update feed is the original repository's empty `updates.json`, present only to satisfy Zotero's metadata requirements.

## Development

From the project root (Node.js 22+, Python 3.10+, no npm/pip runtime dependencies):

```bash
node --test tests/core.test.cjs tests/compat.test.cjs
python -m unittest discover -s tests -p "test_*.py" -v
python build.py
```

KaTeX and Markdown resources are bundled from the upstream EasyRead sources (MIT licensed).

## License

MIT, see [LICENSE](LICENSE). Bundled KaTeX and Markdown rendering resources are MIT-licensed upstream code. Not affiliated with Zotero or EasyRead.
