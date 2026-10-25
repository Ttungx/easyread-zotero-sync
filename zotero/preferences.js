/* SPDX-License-Identifier: MIT */
var EasyReadSyncPreferences = {
  prefix: "extensions.easyread-zotero-sync.",
  observer: null,
  pref(key, fallback) {
    const current = Zotero.Prefs.get(this.prefix + key, true);
    if (current != null) return current;
    const legacy = ["home", "executable"].includes(key) ? Zotero.Prefs.get("extensions.zotero-easyread." + key, true) : null;
    return legacy ?? fallback;
  },
  init(event) {
    const root = event.target;
    if (root.id !== "easyread-sync-preferences") return;
    const doc = root.ownerDocument, programFiles = Services.env.get("ProgramFiles") || "C:\\Program Files";
    const home = PathUtils.join(Services.dirsvc.get("Home", Components.interfaces.nsIFile).path, "EasyRead");
    const executable = PathUtils.join(programFiles, "EasyRead", "EasyRead.exe");
    for (const [id, key, fallback] of [
      ["easyread-sync-executable", "executable", executable],
      ["easyread-sync-home", "home", home],
      ["easyread-sync-server-url", "serverURL", ""]
    ]) {
      const field = doc.getElementById(id);
      field.value = this.pref(key, fallback);
      field.addEventListener("change", () => this.save(root));
    }
    for (const [id, key, fallback] of [
      ["easyread-sync-translate", "translate", true],
      ["easyread-sync-include-ai", "includeAI", true],
      ["easyread-sync-english-context", "englishContext", true]
    ]) {
      const field = doc.getElementById(id);
      field.checked = !!this.pref(key, fallback);
      field.addEventListener("command", () => this.save(root));
    }
    root.addEventListener("unload", () => {
      if (this.observer) Zotero.Prefs.unregisterObserver(this.observer);
      this.observer = null;
    }, {once:true});
    this.observer = Zotero.Prefs.registerObserver(this.prefix + "serverURL", () => {
      root.ownerDocument.getElementById("easyread-sync-server-url").value = Zotero.Prefs.get(this.prefix + "serverURL", true) || "";
    }, true);
  },
  save(root) {
    const doc = root.ownerDocument, url = doc.getElementById("easyread-sync-server-url").value.trim();
    const status = doc.getElementById("easyread-sync-status");
    if (url && (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(url) || Number(url.split(":").pop()) > 65535)) {
      status.textContent = "服务地址无效。请输入端口为 1 到 65535 的 http://127.0.0.1:端口，或留空自动发现。";
      return;
    }
    for (const [id, key] of [
      ["easyread-sync-executable", "executable"],
      ["easyread-sync-home", "home"],
      ["easyread-sync-server-url", "serverURL"]
    ]) Zotero.Prefs.set(this.prefix + key, doc.getElementById(id).value.trim(), true);
    for (const [id, key] of [
      ["easyread-sync-translate", "translate"],
      ["easyread-sync-include-ai", "includeAI"],
      ["easyread-sync-english-context", "englishContext"]
    ]) Zotero.Prefs.set(this.prefix + key, doc.getElementById(id).checked, true);
    status.textContent = "设置已保存。";
  }
};
document.addEventListener("load", function onLoad(event) {
  if (event.target.id !== "easyread-sync-preferences") return;
  document.removeEventListener("load", onLoad, true);
  EasyReadSyncPreferences.init(event);
}, true);
