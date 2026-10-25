/* SPDX-License-Identifier: MIT */
var ZoteroEasyRead = {
  pluginID: "easyread-zotero-sync@local.research",
  version: "0.2.2",
  menus: [],
  preferencePaneID: "easyread-sync-preferences",
  preferenceObservers: [],
  busy: false,
  prefs: "extensions.easyread-zotero-sync.",

  defaultExecutable() { return PathUtils.join(Services.env.get("ProgramFiles") || "C:\\Program Files", "EasyRead", "EasyRead.exe"); },

  pref(key, fallback) {
    const current = Zotero.Prefs.get(this.prefs + key, true);
    if (current != null) return current;
    // Connection settings can be reused without sharing managed notes or mutating the old plugin's preferences.
    return (["home","executable"].includes(key) ? Zotero.Prefs.get("extensions.zotero-easyread." + key, true) : null) ?? fallback;
  },
  legacyHome() { return PathUtils.join(Services.dirsvc.get("Home", Components.interfaces.nsIFile).path, "EasyRead"); },
  home() { return this.resolvedHome || this.pref("home", this.legacyHome()); },
  homeCandidates() {
    const executable = this.pref("executable", this.defaultExecutable());
    return [...new Set([this.pref("home",this.legacyHome()),PathUtils.join(PathUtils.parent(executable),"data"),this.legacyHome()].filter(Boolean))];
  },
  bridgeDir() { return PathUtils.join(this.home(), "zotero-bridge"); },
  // The attachment is titled by the paper's translated title, not a fixed name.
  translationFileName(title) {
    const base = String(title || "").replace(/[\u0000-\u001f\\/:*?"<>|]/g,"").replace(/\s+/g," ").trim().replace(/[.\s]+$/,"").slice(0,100).replace(/[.\s]+$/,"");
    return (base || "EasyRead翻译") + ".html";
  },
  registryPath() { return PathUtils.join(Zotero.Profile.dir, "easyread-zotero-sync.json"); },
  async loadRegistry() {
    const path = this.registryPath(), exists = await IOUtils.exists(path);
    const previous = exists ? await this.readJSON(path) : null;
    const registry = EasyReadCore.migrateRegistry(previous);
    if (previous && previous.schema !== registry.schema) {
      const base = path + ".v" + previous.schema;
      let backup = base + ".bak", index = 1;
      while (await IOUtils.exists(backup)) backup = base + "." + index++ + ".bak";
      await IOUtils.copy(path, backup, {noOverwrite:true});
      await this.writeJSON(path, registry);
    }
    this.registry = registry;
  },
  async readJSON(path, fallback = null) {
    try { return JSON.parse(await IOUtils.readUTF8(path)); }
    catch (error) { if (fallback !== null) return fallback; throw error; }
  },
  async writeJSON(path, data) {
    await IOUtils.makeDirectory(PathUtils.parent(path), {ignoreExisting:true});
    await IOUtils.writeUTF8(path, JSON.stringify(data, null, 2), {tmpPath: path + ".tmp"});
  },
  sha(bytes) {
    const hash = Components.classes["@mozilla.org/security/hash;1"].createInstance(Components.interfaces.nsICryptoHash);
    hash.init(hash.SHA256); hash.update(bytes, bytes.length);
    return Array.from(hash.finish(false), c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  },
  hashHTML(html) { return this.sha(new TextEncoder().encode(html)); },
  async start() {
    this.alive = true;
    await this.loadRegistry();
    this.preferencePane = await Zotero.PreferencePanes.register({
      pluginID:this.pluginID, id:this.preferencePaneID, label:"EasyRead Sync",
      src:this.resourceURI + "preferences.xhtml", scripts:[this.resourceURI + "preferences.js"],
      stylesheets:[this.resourceURI + "preferences.css"]
    });
    for (const key of ["home", "executable"]) this.preferenceObservers.push(Zotero.Prefs.registerObserver(
      this.prefs + key, () => { this.resolvedHome = null; }, true
    ));
    const menu = (label, action, needsSelection = true) => ({
      menuType: "menuitem",
      onShowing: (_event, context) => {
        context.menuElem.label = label;
        context.setEnabled(!this.busy && (!needsSelection || (context.items || Zotero.getMainWindow()?.ZoteroPane.getSelectedItems() || []).length > 0));
      },
      onCommand: (_event, context) => this.run(action, context.items || Zotero.getMainWindow().ZoteroPane.getSelectedItems())
    });
    this.menus.push(Zotero.MenuManager.registerMenu({menuID:"easyread-sync-context",pluginID:this.pluginID,target:"main/library/item",menus:[
      menu("同步翻译内容", "syncViews"), menu("用 EasyRead 阅读", "open"), menu("发送到 EasyRead（批量，先不翻译）", "batch"), menu("同步 EasyRead 阅读笔记", "sync")
    ]}));
    this.menus.push(Zotero.MenuManager.registerMenu({menuID:"easyread-sync-tools",pluginID:this.pluginID,target:"main/menubar/tools",menus:[
      menu("EasyRead Sync：同步所有已关联翻译内容", "syncViewsAll", false), menu("EasyRead Sync：同步所有已关联笔记", "syncAll", false), menu("EasyRead Sync：连接设置…", "settings", false)
    ]}));
    this.protocol = Services.io.getProtocolHandler("zotero").wrappedJSObject;
    const owner = this;
    this.protocolExtension = {loadAsChrome:false, newChannel(uri) {
      owner.openLink(uri.spec).catch(error => owner.alert(error.message));
      return undefined;
    }};
    this.protocol._extensions["zotero://easyread-sync"] = this.protocolExtension;
    if (this.menus.some(id => !id)) throw new Error("EasyRead 菜单注册失败。");
    await this.writeJSON(PathUtils.join(Zotero.Profile.dir,"easyread-zotero-sync-status.json"),{
      ready:true,version:this.version,zoteroVersion:Zotero.version,menus:this.menus,started:new Date().toISOString()
    });
  },
  stop() {
    this.alive = false;
    for (const id of this.menus) Zotero.MenuManager.unregisterMenu(id);
    this.menus = [];
    for (const observer of this.preferenceObservers) Zotero.Prefs.unregisterObserver(observer);
    this.preferenceObservers = [];
    if (this.preferencePane) Zotero.PreferencePanes.unregister(this.preferencePane);
    this.preferencePane = null;
    if (this.protocol?._extensions["zotero://easyread-sync"] === this.protocolExtension) delete this.protocol._extensions["zotero://easyread-sync"];
  },
  alert(message) { Services.prompt.alert(Zotero.getMainWindow(), "EasyRead Sync", String(message)); },
  confirmViewUpdate(message) {
    const prompt = Services.prompt;
    return prompt.confirmEx(Zotero.getMainWindow(), "更新 EasyRead翻译", message,
      prompt.STD_YES_NO_BUTTONS | prompt.BUTTON_POS_1_DEFAULT, null, null, null, null, {}) === 0;
  },
  async run(action, items) {
    if (action === "settings") return this.settings();
    if (this.busy) return this.alert("已有 EasyRead 任务正在处理，请稍候。");
    this.busy = true;
    const progress = new Zotero.ProgressWindow({closeOnClick:true});
    progress.changeHeadline("EasyRead Sync");
    progress.addDescription(action.startsWith("syncViews") ? "正在同步翻译内容…" : action.startsWith("sync") ? "正在同步阅读笔记…" : "正在连接 EasyRead…");
    progress.show();
    try {
      let result;
      if (action === "syncViewsAll") result = (await this.syncAllViews(progress)).summary;
      else if (action === "syncViews") result = (await this.syncSelectedViews(items, progress)).summary;
      else if (action === "syncAll") result = await this.syncAll();
      else {
        const files = await this.prepare(items);
        if (action === "sync") result = await this.sync(files);
        else {
          if (action === "open" && files.length > 1) throw new Error("直接阅读请选中一篇论文。多篇请使用“发送到 EasyRead（批量，先不翻译）”。");
          const conn = await this.connect();
          const imported = [];
          for (const file of files) imported.push(await this.ensurePaper(file, conn, action === "open" && this.pref("translate", true)));
          await this.navigate(conn, action === "open" ? imported[0].id : "", "", action === "open" ? imported[0].sha256 : "");
          result = `已发送 ${imported.length} 篇${action === "batch" ? "，未自动翻译，可在 EasyRead 中选择翻译" : "，已打开 EasyRead"}。`;
        }
      }
      progress.addDescription(result); progress.startCloseTimer(6000);
    } catch (error) {
      progress.close(); Zotero.logError(error); this.alert(error.message || error);
    } finally { this.busy = false; }
  },
  async request(conn, endpoint, body = undefined, contentType = "application/json", responseType = "json") {
    if (!EasyReadCore.validBase(conn.url) || !endpoint.startsWith("/api/")) throw new Error("无效的本地 EasyRead 接口。");
    const options = {responseType,timeout:120000,followRedirects:false,errorDelayMax:0,logBodyLength:0};
    if (body !== undefined) {
      options.body = contentType === "application/pdf" ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : JSON.stringify(body);
      options.headers = {"Content-Type":contentType,"X-Token":conn.token};
    }
    try {
      const response = await Zotero.HTTP.request(body === undefined ? "GET" : "POST", conn.url + endpoint, options);
      return response.response;
    } catch (error) {
      const message = error.xmlhttp?.response?.error;
      throw new Error(message || `无法访问 EasyRead（${error.status || error.message || "连接失败"}）。请检查 EasyRead 是否已打开。`);
    }
  },
  async probe() {
    const configured = this.pref("serverURL", "");
    if (configured && !EasyReadCore.validBase(configured)) throw new Error("服务地址只接受 http://127.0.0.1:端口，不接受远程地址。");
    for (const home of configured ? [null, ...this.homeCandidates()] : this.homeCandidates()) {
      const info = home ? await this.readJSON(PathUtils.join(home, ".server.json"), {}) : {url:configured};
      if (!EasyReadCore.validBase(info.url)) continue;
      const options = {responseType:"json",timeout:2500,followRedirects:false};
      let api = 0, version = "";
      try {
        const response = await Zotero.HTTP.request("GET",info.url + "/api/version",options);
        if (response.response?.api !== 1) throw new Error("EasyRead API 版本不兼容，请更新 Zotero EasyRead 插件。");
        api = 1; version = response.response.version || "";
      } catch (error) {
        if (error.message?.includes("API 版本不兼容")) throw error;
        if (error.status !== 404) continue; // EasyRead 1.3.0 did not expose /api/version.
      }
      try {
        const response = await Zotero.HTTP.request("GET",info.url + "/api/library",options);
        const library = response.response;
        if (!library?.token || !Array.isArray(library.items)) continue;
        if (home) this.resolvedHome = home;
        return {url:info.url,token:library.token,library,home,api,version};
      } catch (_) {}
    }
    return null;
  },
  launch() {
    const executable = this.pref("executable", this.defaultExecutable());
    // Pass a path and arguments, never evaluate a shell command.
    Zotero.Utilities.Internal.exec(executable, []).catch(error => Zotero.logError(error));
  },
  async connect() {
    let conn = await this.probe();
    if (conn) return conn;
    const executable = this.pref("executable", this.defaultExecutable());
    if (!await IOUtils.exists(executable)) throw new Error("找不到 EasyRead.exe，请在「工具 → EasyRead Sync：连接设置」中设置路径。");
    this.launch();
    for (let i = 0; i < 60 && this.alive; i++) {
      await Zotero.Promise.delay(500); conn = await this.probe(); if (conn) return conn;
    }
    throw new Error("EasyRead 启动超时。请手动打开 EasyRead 后重试。");
  },
  async prepare(items) {
    const attachments = new Map(), missing = [];
    for (const selected of items) {
      const item = selected?.isAttachment() && selected.attachmentContentType === "text/html" && selected.parentID
        ? Zotero.Items.get(selected.parentID) : selected;
      if (item?.deleted) continue;
      if (item?.isAttachment() && item.attachmentContentType === "application/pdf") attachments.set(item.id, item);
      else if (item?.isRegularItem()) {
        const candidates = item.getAttachments().map(id => Zotero.Items.get(id)).filter(a => a && !a.deleted && a.attachmentContentType === "application/pdf");
        const best = candidates.length ? await item.getBestAttachment() : null;
        if (!candidates.length) { missing.push(item.getField("title")); continue; }
        const attachment = candidates.find(a => a.id === best?.id) || candidates[0];
        attachments.set(attachment.id, attachment);
      }
    }
    if (missing.length) throw new Error("以下文献没有 PDF：\n" + missing.join("\n"));
    if (!attachments.size) throw new Error("请选中论文或 PDF 附件。");
    if (attachments.size > 20) throw new Error("每批最多发送 20 篇论文，请分批选择。");
    const files = [];
    for (const attachment of attachments.values()) {
      const path = await attachment.getFilePathAsync();
      if (!path || !await IOUtils.exists(path)) throw new Error("部分 PDF 尚未下载到本机，请先在 Zotero 下载附件。");
      const stat = await IOUtils.stat(path);
      if (stat.size > 200 * 1024 * 1024) throw new Error("单篇 PDF 超过 EasyRead 的 200 MB 导入上限。");
      const header = await IOUtils.read(path, {maxBytes:5});
      if (String.fromCharCode(...header) !== "%PDF-") throw new Error("所选附件不是有效的 PDF。");
      const parent = attachment.parentID ? Zotero.Items.get(attachment.parentID) : null;
      files.push({attachment, parent, path, stat, libraryID:attachment.libraryID, attachmentKey:attachment.key,
        mapKey:`${attachment.libraryID}:${attachment.key}`, title:parent?.getField("title") || attachment.getField("title"), filename:PathUtils.filename(path)});
    }
    return files;
  },
  async fingerprint(file) {
    const bytes = await IOUtils.read(file.path);
    const stat = await IOUtils.stat(file.path);
    if (stat.size !== file.stat.size || stat.lastModified !== file.stat.lastModified) throw new Error("PDF 在发送时发生变化，请重试。");
    return {bytes, sha256:this.sha(bytes)};
  },
  async ensurePaper(file, conn, translate) {
    const {bytes, sha256} = await this.fingerprint(file);
    const id = sha256.slice(0,12);
    const current = conn.library.items.find(item => item.id === id);
    if (current) {
      // Verify the full digest instead of trusting the 48-bit folder name.
      const paper = await this.request(conn, `/api/p/${id}/part/paper`);
      if (paper.data?.meta?.source_sha256 !== sha256) throw new Error("EasyRead 的 PDF 指纹不匹配，已停止自动关联。");
    } else {
      const result = await this.request(conn, "/api/import?name=" + encodeURIComponent(file.filename) + "&translate=" + (translate ? "1" : "0"), bytes, "application/pdf");
      if (result.id !== id) throw new Error("EasyRead 返回的论文标识与 PDF 指纹不一致。");
      conn.library.items.push({id});
    }
    this.registry.attachments[file.mapKey] = {id,sha256,parentKey:file.parent?.key || null,libraryID:file.libraryID,attachmentKey:file.attachmentKey,title:file.title};
    await this.writeJSON(this.registryPath(), this.registry);
    return {id,sha256};
  },
  async navigate(conn, id, anchor = "", sha256 = "") {
    if (id && !EasyReadCore.validID(id)) throw new Error("无效的 EasyRead 论文标识。");
    if (conn.api === 1) {
      const target = id ? EasyReadCore.officialOpen(id,anchor,sha256) : "";
      const executable = this.pref("executable",this.defaultExecutable());
      if (await IOUtils.exists(executable)) {
        try { await Zotero.Utilities.Internal.exec(executable,target ? ["easyread://" + target] : []); return; }
        catch (error) { Zotero.logError(error); }
      }
      Zotero.launchURL(conn.url + (target ? "/" + target : "/"));
      return;
    }
    const nonce = Services.uuid.generateUUID().toString().replace(/[{}-]/g, "");
    await this.writeJSON(PathUtils.join(this.bridgeDir(), "open.json"), {schema:1,nonce,id,anchor:String(anchor).slice(0,256),at:Date.now(),url:conn.url});
    this.launch();
    for (let i = 0; i < 24; i++) {
      await Zotero.Promise.delay(250);
      const ack = await this.readJSON(PathUtils.join(this.bridgeDir(), "ack.json"), {});
      if (ack.nonce === nonce && ack.ok) return;
      if (ack.nonce === nonce && ack.error) throw new Error("EasyRead 桌面跳转失败：" + ack.error);
    }
    // An unpatched or upgraded desktop app can still read through its local UI.
    Zotero.launchURL(conn.url + (id ? "/read/" + id : "/") + (anchor ? "#b-" + encodeURIComponent(anchor.split("#")[0]) : ""));
  },
  async openLink(spec) {
    if (this.busy) throw new Error("已有 EasyRead 任务正在处理，请稍候。");
    this.busy = true;
    try {
      const {libraryID,key,anchor} = EasyReadCore.parseLink(spec);
      const attachment = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key);
      if (!attachment || attachment.deleted || !attachment.isAttachment()) throw new Error("这条阅读链接对应的 Zotero 附件已不存在。");
      const files = await this.prepare([attachment]);
      const conn = await this.connect();
      const paper = await this.ensurePaper(files[0], conn, false);
      await this.navigate(conn, paper.id, anchor, paper.sha256);
    } finally { this.busy = false; }
  },
  async saveNote(file, mapping, state) {
    if (!file.parent) throw new Error("独立 PDF 请先关联到 Zotero 文献条目，再同步子笔记。");
    if (!Zotero.Libraries.get(file.libraryID).editable) throw new Error("该 Zotero 文献库为只读，不能回写笔记。");
    const noteMapKey = `${file.libraryID}:${file.parent.key}:${mapping.sha256}`;
    const record = this.registry.notes[noteMapKey];
    const html = EasyReadCore.render(state, {...file,id:mapping.id}, {includeAI:this.pref("includeAI",true),englishContext:this.pref("englishContext",true)});
    const sourceHash = this.hashHTML(html);
    let note = record?.noteKey ? await Zotero.Items.getByLibraryAndKeyAsync(file.libraryID, record.noteKey) : null;
    if (note && (!note.isNote() || note.deleted || note.parentID !== file.parent.id)) note = null;
    let preserved = false;
    if (note && this.hashHTML(note.getNote()) !== record.noteHash) {
      // Keep manually edited note untouched; make a new managed version even if source is unchanged.
      note = null; preserved = true;
    }
    if (note && sourceHash === record.sourceHash) return {changed:false,preserved:false};
    if (!note) {
      note = new Zotero.Item("note"); note.libraryID = file.libraryID; note.parentID = file.parent.id;
      note.addTag("EasyRead");
    }
    note.setNote(html);
    await note.saveTx({undoAction:"undo-action-edit-metadata",undoActionArgs:{count:1}});
    this.registry.notes[noteMapKey] = {noteKey:note.key,noteHash:this.hashHTML(note.getNote()),sourceHash,id:mapping.id,updated:new Date().toISOString()};
    await this.writeJSON(this.registryPath(), this.registry);
    return {changed:true,preserved};
  },
  async readingState(conn,id) {
    const parts = ["paper","reader",...(this.pref("includeAI",true) ? ["discussion"] : [])];
    const responses = await Promise.all(parts.map(part => this.request(conn,`/api/p/${id}/part/${part}`)));
    return Object.fromEntries(parts.map((part,i) => [part,responses[i]?.data || {}]));
  },
  async sync(files) {
    const conn = await this.connect();
    let changed = 0, preserved = 0; const failures = [], seen = new Set();
    for (const file of files) {
      try {
        const {sha256} = await this.fingerprint(file);
        const id = sha256.slice(0,12);
        const key = `${file.libraryID}:${file.parent?.key || file.attachmentKey}:${sha256}`;
        if (seen.has(key)) continue; seen.add(key);
        // Also supports PDFs imported manually into EasyRead before installing this plugin.
        if (!conn.library.items.some(p => p.id === id)) throw new Error("尚未在 EasyRead 中导入，请先右键“用 EasyRead 阅读”。");
        const state = await this.readingState(conn,id);
        if (state.paper?.meta?.source_sha256 !== sha256) throw new Error("PDF 指纹不一致，已停止回写。");
        const mapping = {id,sha256};
        this.registry.attachments[file.mapKey] = {...mapping,parentKey:file.parent?.key,libraryID:file.libraryID,attachmentKey:file.attachmentKey,title:file.title};
        const result = await this.saveNote(file,mapping,state);
        changed += Number(result.changed); preserved += Number(result.preserved);
      } catch (error) { failures.push(`${file.title}：${error.message}`); }
    }
    await this.writeJSON(this.registryPath(), this.registry);
    if (failures.length) throw new Error(`已更新 ${changed} 份笔记${preserved ? `，保留 ${preserved} 份手动编辑版本` : ""}。以下项目未同步：\n` + failures.join("\n"));
    return `已更新 ${changed} 份笔记，其余内容未变化${preserved ? `；保留了 ${preserved} 份手动编辑版本` : ""}。`;
  },
  async syncAll() {
    const items = [];
    for (const record of Object.values(this.registry.attachments)) {
      const item = await Zotero.Items.getByLibraryAndKeyAsync(record.libraryID,record.attachmentKey);
      if (item && !item.deleted) items.push(item);
    }
    if (!items.length) return "尚无已关联论文，请先使用“用 EasyRead 阅读”。";
    // Apply per-file checks without imposing the batch import selection limit.
    const files = [];
    for (const item of items) files.push(...await this.prepare([item]));
    return this.sync(files);
  },
  async readingCSS() {
    // Packed XPI resources use jar: URIs, not HTTP URLs.
    if (!this.translationCSS) this.translationCSS = await Zotero.File.getResourceAsync(this.resourceURI + "vendor/katex.css")
      + "\n" + await Zotero.File.getResourceAsync(this.resourceURI + "reader.css");
    return this.translationCSS;
  },
  async syncSelectedViews(items, progress, all = false) {
    const files = new Map(), failures = [];
    for (const item of items) {
      try { for (const file of await this.prepare([item])) files.set(file.mapKey, file); }
      catch (error) { failures.push(`${item?.getField?.("title") || "所选条目"}：${error.message}`); }
    }
    if (!all && files.size > 20) throw new Error("每批最多同步 20 篇，请分批选择。");
    return this.syncViews([...files.values()], {progress,failures,allowPrompt:files.size === 1 && !all && !failures.length});
  },
  async syncAllViews(progress) {
    const items = [];
    for (const record of Object.values(this.registry.attachments)) {
      const item = await Zotero.Items.getByLibraryAndKeyAsync(record.libraryID, record.attachmentKey);
      if (item && !item.deleted) items.push(item);
    }
    return this.syncSelectedViews(items, progress, true);
  },
  async syncViews(files, {progress, failures = [], allowPrompt = false} = {}) {
    const report = {changed:0,unchanged:0,skipped:0,failed:failures.length,details:[...failures]};
    if (files.length) {
      const conn = await this.connect();
      if (conn.api !== 1) throw new Error("同步翻译内容需要 EasyRead API v1，请更新 EasyRead。");
      const seen = new Set();
      for (const [index,file] of files.entries()) {
        try {
          if (!this.alive) throw new Error("插件已停止，任务已取消。");
          if (!file.parent) throw new Error("独立 PDF 请先关联文献条目，再同步翻译内容。");
          const library = Zotero.Libraries.get(file.libraryID);
          if (!library?.editable || !library.filesEditable) throw new Error("该文献库没有附件写入权限。");
          progress?.addDescription(`正在处理 ${index + 1} / ${files.length}：${file.title}`);
          const {sha256} = await this.fingerprint(file), id = sha256.slice(0,12);
          const key = `${file.libraryID}:${file.parent.key}:${sha256}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!conn.library.items.some(p => p.id === id)) throw new Error("尚未在 EasyRead 中导入，请先导入并完成全文翻译。");
          const [paper,job] = await Promise.all(["paper","job"].map(part => this.request(conn,`/api/p/${id}/part/${part}`)));
          if (paper.data?.meta?.source_sha256 !== sha256) throw new Error("PDF 完整指纹不匹配，已停止同步。");
          EasyReadTranslation.complete(paper.data,job.data);
          const raw = await this.request(conn,`/api/p/${id}/export?mobile=1`,undefined,"application/json","text");
          const data = EasyReadTranslation.parseExport(raw);
          if (data.paper.meta.source_sha256 !== sha256) throw new Error("导出文献指纹不匹配。");
          const [latestPaper,latestJob,latestReader] = await Promise.all(["paper","job","reader"].map(part => this.request(conn,`/api/p/${id}/part/${part}`)));
          EasyReadTranslation.complete(data.paper,latestJob.data);
          if (JSON.stringify(latestPaper.data) !== JSON.stringify(data.paper)
            || JSON.stringify(latestReader.data?.edits || {}) !== JSON.stringify(data.reader?.edits || {})) throw new Error("导出期间译文发生变化，请重试。");
          const rendered = EasyReadTranslation.render(data,{markup:EasyReadMarkup,css:await this.readingCSS()});
          const currentStat = await IOUtils.stat(file.path);
          if (currentStat.size !== file.stat.size || currentStat.lastModified !== file.stat.lastModified) throw new Error("PDF 在同步期间发生变化，请重试。");
          if (!this.alive) throw new Error("插件已停止，任务已取消。");
          const saved = await this.saveView(file,{id,sha256},rendered.html,{allowPrompt,title:rendered.title});
          report[saved.changed ? "changed" : "unchanged"]++;
        } catch (error) {
          const skipped = error.code === "INCOMPLETE" || error.code === "PROTECTED";
          report[skipped ? "skipped" : "failed"]++;
          report.details.push(`${file.title}：${error.message}`);
          if (!skipped) Zotero.logError(error);
        }
      }
    }
    report.summary = `翻译内容：已更新 ${report.changed} 篇，未变化 ${report.unchanged} 篇，跳过 ${report.skipped} 篇，失败 ${report.failed} 篇。`
      + (report.details.length ? "\n" + report.details.join("\n") : !files.length ? "尚无已关联论文，请先选择已完成翻译的论文同步。" : "");
    this.lastViewSyncReport = report;
    return report;
  },
  async saveView(file, mapping, html, {allowPrompt = false, title} = {}) {
    const protect = message => Object.assign(new Error(message),{code:"PROTECTED"});
    const desiredTitle = String(title || "").trim() || "EasyRead翻译";
    if (!file.parent || file.parent.deleted) throw new Error("翻译附件必须属于有效的文献条目。");
    const library = Zotero.Libraries.get(file.libraryID);
    if (!library?.editable || !library.filesEditable) throw new Error("该文献库没有附件写入权限。");
    if (EasyReadTranslation.sourceIdentity(html) !== mapping.sha256) throw new Error("生成的译文来源标记无效。");
    const key = `${file.libraryID}:${file.parent.key}:${mapping.sha256}`, record = this.registry.views[key];
    const valid = item => item && !item.deleted && item.isAttachment() && item.parentID === file.parent.id
      && item.libraryID === file.libraryID && item.attachmentContentType === "text/html"
      && item.attachmentLinkMode === Zotero.Attachments.LINK_MODE_IMPORTED_FILE;
    let attachment = record?.attachmentKey ? await Zotero.Items.getByLibraryAndKeyAsync(file.libraryID,record.attachmentKey) : null;
    if (!valid(attachment)) attachment = null;
    let adopting = false;
    if (!attachment) {
      const matches = [], unknown = [];
      for (const id of file.parent.getAttachments()) {
        const candidate = Zotero.Items.get(id);
        if (!valid(candidate)) continue;
        const path = await candidate.getFilePathAsync();
        let identity = null;
        if (path && await IOUtils.exists(path)) {
          const stat = await IOUtils.stat(path);
          if (stat.size <= EasyReadTranslation.maxBytes) identity = EasyReadTranslation.sourceIdentity(await IOUtils.readUTF8(path));
        }
        if (identity === mapping.sha256) matches.push(candidate);
        else if (!identity && candidate.getField("title") === "EasyRead翻译" && candidate.hasTag("EasyRead")) unknown.push(candidate);
      }
      if (matches.length > 1 || (!matches.length && unknown.length > 1)) throw protect("存在多个候选译文附件，无法安全接管，请先整理附件。");
      attachment = matches[0] || unknown[0] || null;
      adopting = !matches.length && !!attachment;
    }
    const digest = this.hashHTML(html);
    const path = attachment ? await attachment.getFilePathAsync() : null;
    const exists = path && await IOUtils.exists(path);
    let current = null, currentHash = null;
    if (exists) {
      if ((await IOUtils.stat(path)).size > EasyReadTranslation.maxBytes) throw protect("现有附件超过 32 MB，未自动覆写。");
      current = await IOUtils.readUTF8(path); currentHash = this.hashHTML(current);
      const identity = EasyReadTranslation.sourceIdentity(current);
      if (identity && identity !== mapping.sha256) throw protect("现有附件属于另一份 PDF，未覆写。");
    }
    const remember = async () => {
      const oldView = this.registry.views[key], oldSource = this.registry.attachments[file.mapKey];
      this.registry.views[key] = {attachmentKey:attachment.key,sourceHash:digest,id:mapping.id,updated:new Date().toISOString()};
      this.registry.attachments[file.mapKey] = {...mapping,parentKey:file.parent.key,libraryID:file.libraryID,attachmentKey:file.attachmentKey,title:file.title};
      try { await this.writeJSON(this.registryPath(),this.registry); }
      catch (error) {
        if (oldView === undefined) delete this.registry.views[key]; else this.registry.views[key] = oldView;
        if (oldSource === undefined) delete this.registry.attachments[file.mapKey]; else this.registry.attachments[file.mapKey] = oldSource;
        throw error;
      }
    };
    if (attachment && currentHash === digest) {
      // Previously synced attachments keep the fixed EasyRead翻译 name; fall through to rename them.
      if (attachment.attachmentFilename === this.translationFileName(desiredTitle) && attachment.getField("title") === desiredTitle) {
        if (record?.attachmentKey !== attachment.key || record.sourceHash !== digest || !this.registry.attachments[file.mapKey]) await remember();
        return {changed:false,attachmentKey:attachment.key};
      }
    }
    if (attachment) {
      const storage = Zotero.Sync.Storage.Local;
      if ([storage.SYNC_STATE_TO_DOWNLOAD,storage.SYNC_STATE_FORCE_DOWNLOAD,storage.SYNC_STATE_IN_CONFLICT].includes(attachment.attachmentSyncState)) throw protect("译文附件存在待下载或同步冲突，请先完成 Zotero 同步。");
      const reasons = [];
      if (adopting) reasons.push("现有同名附件没有可核验的来源标记，将接管为此 PDF 的受管理译文。");
      if (exists && record && currentHash !== record.sourceHash) reasons.push("现有译文文件在上次同步后被修改。");
      if (attachment.getAnnotations().length && (!record || record.sourceHash !== digest)) reasons.push("此附件已有 Zotero 原生批注，更新正文可能使划线位置变化；不会删除或自动迁移批注。");
      if (reasons.length && (!allowPrompt || !this.confirmViewUpdate(reasons.join("\n") + "\n更新前会保留一份本地备份。是否继续？"))) throw protect(reasons.join(" ") + "已跳过；可单选后再次同步并确认。");
    }
    const runner = Zotero.Sync.Runner;
    if (runner.syncInProgress) throw protect("Zotero 正在同步，请等待同步完成后重试。");
    const resumeSync = runner.delayIndefinite();
    let temporary;
    try {
      if (!this.alive) throw new Error("插件已停止，任务已取消。");
      temporary = PathUtils.join(Zotero.getTempDirectory().path,"easyread-sync-" + Services.uuid.generateUUID().toString().replace(/[{}-]/g,""));
      await IOUtils.makeDirectory(temporary);
      const name = this.translationFileName(desiredTitle);
      if (/[\\/:]/.test(name) || !/\.html?$/i.test(name)) throw protect("译文文件名无效，未覆写。");
      const tempPath = PathUtils.join(temporary,name);
      await IOUtils.writeUTF8(tempPath,html);
      if (exists) {
        const backup = PathUtils.join(Zotero.Profile.dir,"easyread-zotero-sync-backups",attachment.key + ".previous.html");
        await IOUtils.makeDirectory(PathUtils.parent(backup),{ignoreExisting:true});
        await IOUtils.writeUTF8(backup,current,{tmpPath:backup + ".tmp"});
        if (this.hashHTML(await IOUtils.readUTF8(path)) !== currentHash) throw protect("现有译文在更新期间发生变化，未覆写，请重试。");
      }
      if (!this.alive) throw new Error("插件已停止，任务已取消。");
      if (attachment) await attachment.relinkAttachmentFile(tempPath);
      else attachment = await Zotero.Attachments.importFromFile({file:tempPath,parentItemID:file.parent.id,title:desiredTitle,contentType:"text/html",charset:"utf-8"});
      attachment.setField("title",desiredTitle);
      attachment.addTag("EasyRead");
      attachment.attachmentSyncState = "to_upload";
      await attachment.saveTx();
      // Renaming leaves the previous EasyRead翻译.html unreferenced in storage.
      if (path && path !== await attachment.getFilePathAsync() && await IOUtils.exists(path)) {
        try { await IOUtils.remove(path); } catch (error) { Zotero.logError(error); }
      }
      await remember();
      return {changed:true,attachmentKey:attachment.key};
    } finally {
      try { if (temporary) await IOUtils.remove(temporary,{recursive:true,ignoreAbsent:true}); }
      catch (error) { Zotero.logError(error); }
      finally { resumeSync(); }
    }
  },
  settings() {
    Zotero.Utilities.Internal.openPreferences(this.preferencePaneID);
  }
};
