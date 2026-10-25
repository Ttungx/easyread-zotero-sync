/* Runs only inside setup_native.py's fresh headless Profile; the HTTP service and PDF are synthetic. */
const originalStartup = startup;
startup = async function (args) {
  try { await originalStartup(args); setTimeout(runNativeTests,100); }
  catch (error) {
    await IOUtils.writeUTF8(PathUtils.join(TEST_ROOT,"native-report.json"),JSON.stringify({ok:false,error:String(error),stack:error.stack}));
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  }
};
async function runNativeTests() {
  const report = {zoteroVersion:Zotero.version,checks:[]};
  const check = (name,value) => { if (!value) throw new Error("FAILED: " + name); report.checks.push(name); };
  const owner = ZoteroEasyRead;
  const payloadPath = PathUtils.join(TEST_ROOT,"fixtures","export-data.json");
  const savePayload = payload => IOUtils.writeUTF8(payloadPath,JSON.stringify(payload),{tmpPath:payloadPath + ".tmp"});
  let preferences;
  try {
    await Zotero.uiReadyPromise;
    check("fresh isolated Profile and data directory",Zotero.Profile.dir === PathUtils.join(TEST_ROOT,"profile") && Zotero.DataDirectory.dir === PathUtils.join(TEST_ROOT,"data"));
    check("new plugin identity and menus",owner.pluginID === "easyread-sync-native-test@local.research" && owner.menus.length === 2);
    check("registry migration preserved unknown data",owner.registry.schema === 2 && owner.registry.testMarker === "keep");
    check("registry migration backup preserved schema 1",(await owner.readJSON(owner.registryPath() + ".v1.bak")).schema === 1);
    check("extension runs from a packed XPI",owner.resourceURI.startsWith("jar:file:"));
    check("CSS cache starts empty",!owner.translationCSS);
    const server = await owner.readJSON(PathUtils.join(TEST_ROOT,"server.json"));
    Zotero.Prefs.set(owner.prefs + "serverURL",server.url,true);
    Zotero.Prefs.set(owner.prefs + "executable",PathUtils.join(TEST_ROOT,"nonexistent-EasyRead.exe"),true);
    const conn = await owner.connect();
    check("real HTTP discovery reaches only the synthetic API",conn.url === server.url && conn.api === 1 && conn.version === "synthetic-test");

    preferences = Zotero.Utilities.Internal.openPreferences(owner.preferencePaneID);
    preferences.addEventListener("error",event => { (report.preferenceErrors ||= []).push(event.message); });
    if (preferences.document.readyState !== "complete") {
      await new Promise(resolve => preferences.addEventListener("load",resolve,{once:true}));
    }
    await preferences.Zotero_Preferences.waitForFirstPaneLoad();
    await preferences.Zotero_Preferences._loadPane(owner.preferencePaneID);
    const doc = preferences.document, field = doc.getElementById("easyread-sync-server-url");
    check("real native preferences pane initializes via load event",field?.value === server.url && doc.getElementById("easyread-sync-translate").checked);
    field.value = "http://127.0.0.1:65536";
    field.dispatchEvent(new preferences.Event("change"));
    check("native pane rejects invalid ports without changing saved settings",Zotero.Prefs.get(owner.prefs + "serverURL",true) === server.url && doc.getElementById("easyread-sync-status").textContent.includes("65535"));
    field.value = server.url;
    field.dispatchEvent(new preferences.Event("change"));
    const checkbox = doc.getElementById("easyread-sync-include-ai");
    checkbox.checked = false;
    checkbox.dispatchEvent(new preferences.Event("command"));
    check("native pane saves checkboxes as isolated preferences",Zotero.Prefs.get(owner.prefs + "includeAI",true) === false && Zotero.Prefs.get("extensions.zotero-easyread.includeAI",true) == null);
    owner.resolvedHome = "cached";
    doc.getElementById("easyread-sync-home").value = PathUtils.join(TEST_ROOT,"synthetic-home");
    doc.getElementById("easyread-sync-home").dispatchEvent(new preferences.Event("change"));
    check("native preferences invalidate the connection path cache",owner.resolvedHome === null);
    preferences.close(); preferences = null;
    await Zotero.Promise.delay(0);

    const article = new Zotero.Item("journalArticle"); article.setField("title","EasyRead Sync native test"); await article.saveTx();
    const source = await Zotero.Attachments.importFromFile({file:PathUtils.join(TEST_ROOT,"fixtures","source.pdf"),parentItemID:article.id});
    const [file] = await owner.prepare([article,source]);
    const {sha256} = await owner.fingerprint(file);
    const payload = await owner.readJSON(payloadPath);
    check("fixture fingerprint matches local PDF",payload.paper.meta.source_sha256 === sha256);
    let exports = 0;
    const request = owner.request;
    owner.request = function (conn,endpoint,...args) {
      if (endpoint.includes("/export?mobile=1")) exports++;
      return request.call(this,conn,endpoint,...args);
    };
    owner.alert = message => { throw new Error("Unexpected alert: " + message); };
    await owner.run("syncViews",[article]);
    const first = owner.lastViewSyncReport;
    report.firstSync = first;
    check("menu action completes full HTTP-to-attachment sync",first?.changed === 1 && first.failed === 0 && owner.busy === false);
    check("packed KaTeX and reader CSS load through the resource channel",owner.translationCSS.includes("data:font/woff2;base64,") && owner.translationCSS.includes(".table-scroll"));
    const mapKey = `${file.libraryID}:${article.key}:${sha256}`;
    const record = owner.registry.views[mapKey];
    const item = await Zotero.Items.getByLibraryAndKeyAsync(file.libraryID,record.attachmentKey);
    const storedPath = await item.getFilePathAsync(), oldHTML = await IOUtils.readUTF8(storedPath);
    check("stored attachment is titled and named by the translated paper title",item.attachmentLinkMode === Zotero.Attachments.LINK_MODE_IMPORTED_FILE && item.attachmentContentType === "text/html" && item.getField("title") === payload.paper.meta.title_zh && item.hasTag("EasyRead") && storedPath.endsWith(payload.paper.meta.title_zh + ".html"));
    report.attachmentPath = storedPath;
    check("complete HTML, embedded image and math exist without scripts",oldHTML.includes('class="katex"') && oldHTML.includes("data:image/png;base64") && !oldHTML.includes("<script"));
    check("private data and originals excluded",!oldHTML.includes("PRIVATE"));
    const firstStat = await IOUtils.stat(storedPath), registryBefore = await IOUtils.readUTF8(owner.registryPath());
    const repeated = await owner.syncSelectedViews([article]);
    check("identical content skips file and registry writes",repeated.unchanged === 1 && (await IOUtils.stat(storedPath)).lastModified === firstStat.lastModified && await IOUtils.readUTF8(owner.registryPath()) === registryBefore);
    payload.reader.progress = {ratio:.9,at:"later"}; payload.reader.notes.changed = {body:"PRIVATE NEW NOTE"};
    await savePayload(payload);
    check("reading progress and notes do not dirty HTML",(await owner.syncSelectedViews([article])).unchanged === 1);
    payload.reader.edits.p1 = {zh:"原生宿主验证：这是一段更新后的译文。"};
    await savePayload(payload);
    const updated = await owner.syncSelectedViews([article]);
    check("changed translation updates bytes at the same attachment path and key",updated.changed === 1 && owner.registry.views[mapKey].attachmentKey === item.key && await item.getFilePathAsync() === storedPath && (await IOUtils.readUTF8(storedPath)).includes("这是一段更新后的译文"));
    check("previous version is backed up outside storage",await IOUtils.readUTF8(PathUtils.join(Zotero.Profile.dir,"easyread-zotero-sync-backups",item.key + ".previous.html")) === oldHTML);
    check("file is marked for upload",item.attachmentSyncState === Zotero.Sync.Storage.Local.SYNC_STATE_TO_UPLOAD);
    check("only one translation attachment exists",article.getAttachments().map(id=>Zotero.Items.get(id)).filter(a=>a.attachmentContentType === "text/html").length === 1);
    const current = await IOUtils.readUTF8(storedPath);
    await IOUtils.writeUTF8(storedPath,current + "<p>Manual edit</p>");
    check("manual file edits are protected without a modal prompt",(await owner.syncSelectedViews([article],null,true)).skipped === 1 && (await IOUtils.readUTF8(storedPath)).endsWith("<p>Manual edit</p>"));
    await IOUtils.writeUTF8(storedPath,current);
    await IOUtils.remove(storedPath);
    check("missing file restored with same attachment key",(await owner.syncSelectedViews([article])).changed === 1 && await IOUtils.readUTF8(await item.getFilePathAsync()) === current && owner.registry.views[mapKey].attachmentKey === item.key);
    const currentHTML = await IOUtils.readUTF8(storedPath);
    const legacyArticle = new Zotero.Item("journalArticle"); legacyArticle.setField("title","EasyRead Sync legacy rename test"); await legacyArticle.saveTx();
    await Zotero.Attachments.importFromFile({file:PathUtils.join(TEST_ROOT,"fixtures","source.pdf"),parentItemID:legacyArticle.id});
    const legacyDir = PathUtils.join(TEST_ROOT,"legacy"); await IOUtils.makeDirectory(legacyDir,{ignoreExisting:true});
    const legacyFile = PathUtils.join(legacyDir,"EasyRead翻译.html");
    await IOUtils.writeUTF8(legacyFile,currentHTML);
    const legacyAttachment = await Zotero.Attachments.importFromFile({file:legacyFile,parentItemID:legacyArticle.id,title:"EasyRead翻译",contentType:"text/html",charset:"utf-8"});
    legacyAttachment.addTag("EasyRead"); await legacyAttachment.saveTx();
    const legacyKey = legacyAttachment.key, legacyStored = await legacyAttachment.getFilePathAsync();
    const legacySync = await owner.syncSelectedViews([legacyArticle],null,true);
    check("legacy EasyRead翻译 attachment is renamed to the translated title on the next sync",legacySync.changed === 1 && legacySync.failed === 0 && legacyAttachment.key === legacyKey && legacyAttachment.getField("title") === payload.paper.meta.title_zh && !(await IOUtils.exists(legacyStored)) && (await legacyAttachment.getFilePathAsync()).endsWith(payload.paper.meta.title_zh + ".html"));
    check("renamed legacy attachment keeps identical content and does not duplicate",await IOUtils.readUTF8(await legacyAttachment.getFilePathAsync()) === currentHTML && legacyArticle.getAttachments().map(id=>Zotero.Items.get(id)).filter(a=>a.attachmentContentType === "text/html").length === 1);
    for (const pages of [[1],[]]) {
      payload.paper.translation.done_pages = pages;
      await savePayload(payload);
      const beforeGuard = exports, incomplete = await owner.syncSelectedViews([article]);
      check(pages.length ? "incomplete guard precedes export" : "zero-page guard precedes export",incomplete.skipped === 1 && exports === beforeGuard);
    }
    check("temporary attachment files are cleaned",!(await IOUtils.getChildren(Zotero.getTempDirectory().path)).some(path => PathUtils.filename(path).startsWith("easyread-sync-")));
    if (await IOUtils.exists(PathUtils.join(TEST_ROOT,"live.json"))) {
      const live = await owner.readJSON(PathUtils.join(TEST_ROOT,"live.json"));
      Zotero.Prefs.set(owner.prefs + "serverURL",live.url,true);
      const liveRequest = owner.request;
      report.liveRequests = [];
      owner.request = function (conn,endpoint,body,...args) {
        const allowed = ["part/paper","part/job","part/reader","export?mobile=1"].map(path => `/api/p/${live.id}/${path}`);
        if (conn.url !== live.url || body !== undefined || !allowed.includes(endpoint)) throw new Error("Live regression permits only read-only paper GET endpoints");
        report.liveRequests.push(endpoint);
        return liveRequest.call(this,conn,endpoint,body,...args);
      };
      const liveArticle = new Zotero.Item("journalArticle");
      liveArticle.setField("title","Read-only live EasyRead regression"); await liveArticle.saveTx();
      const liveSource = await Zotero.Attachments.importFromFile({file:PathUtils.join(TEST_ROOT,"fixtures","live-source.pdf"),parentItemID:liveArticle.id});
      const [liveFile] = await owner.prepare([liveSource]);
      const fingerprint = await owner.fingerprint(liveFile);
      check("live PDF full fingerprint matches the requested paper",fingerprint.sha256.startsWith(live.id));
      owner.translationCSS = null;
      const liveSync = await owner.syncSelectedViews([liveArticle],null,true);
      report.liveSync = liveSync;
      check("live EasyRead export creates a stored translation in the isolated library",liveSync.changed === 1 && liveSync.failed === 0);
      const liveRecord = owner.registry.views[`${liveFile.libraryID}:${liveArticle.key}:${fingerprint.sha256}`];
      const liveAttachment = await Zotero.Items.getByLibraryAndKeyAsync(liveFile.libraryID,liveRecord.attachmentKey);
      const livePath = await liveAttachment.getFilePathAsync(), liveHTML = await IOUtils.readUTF8(livePath);
      check("live stored translation is static and source-marked",EasyReadTranslation.sourceIdentity(liveHTML) === fingerprint.sha256 && !/<script\\b/i.test(liveHTML));
      check("live repeat sync creates no duplicate and leaves the stored file unchanged",(await owner.syncSelectedViews([liveArticle],null,true)).unchanged === 1 && await liveAttachment.getFilePathAsync() === livePath);
      report.liveAttachmentPath = livePath;
    }
    owner.stop();
    check("shutdown removes menus, preference observers, pane and own protocol",owner.menus.length === 0 && owner.preferenceObservers.length === 0 && !Zotero.PreferencePanes.pluginPanes.some(pane => pane.id === owner.preferencePaneID) && !owner.protocol._extensions["zotero://easyread-sync"]);
    await owner.start();
    check("restart registers resources without duplicate pane IDs",owner.menus.length === 2 && Zotero.PreferencePanes.pluginPanes.filter(pane => pane.id === owner.preferencePaneID).length === 1);
    report.ok = true;
  } catch (error) {
    report.ok = false; report.error = String(error); report.stack = error.stack;
    report.lastSync = owner.lastViewSyncReport;
  } finally {
    preferences?.close();
  }
  await IOUtils.writeUTF8(PathUtils.join(TEST_ROOT,"native-report.json"),JSON.stringify(report,null,2));
  Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
}
