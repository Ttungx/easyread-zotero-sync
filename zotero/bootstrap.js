/* SPDX-License-Identifier: MIT */
var EasyReadCore;
var EasyReadTranslation;
var EasyReadMarkup;
var ZoteroEasyRead;
var katex;

async function startup({ rootURI }) {
  await Zotero.initializationPromise;
  Services.scriptloader.loadSubScript(rootURI + "core.js");
  Services.scriptloader.loadSubScript(rootURI + "vendor/katex.min.js");
  EasyReadMarkup = {
    esc:value => EasyReadCore.escape(value),
    t:(text, args = {}) => text.replace(/\{(\w+)\}/g, (_all,key) => String(args[key] ?? ""))
  };
  Services.scriptloader.loadSubScript(rootURI + "vendor/markup.js", {EasyReadMarkup,katex,URL});
  Services.scriptloader.loadSubScript(rootURI + "translation.js");
  Services.scriptloader.loadSubScript(rootURI + "bridge.js");
  ZoteroEasyRead.resourceURI = rootURI;
  await ZoteroEasyRead.start();
}
function shutdown() {
  ZoteroEasyRead?.stop();
  ZoteroEasyRead = undefined; EasyReadCore = undefined; EasyReadTranslation = undefined; EasyReadMarkup = undefined; katex = undefined;
}
function install() {}
function uninstall() {}
