/* SPDX-License-Identifier: MIT -- Inert export data to a script-free, self-contained reading attachment. */
var EasyReadTranslation = {
  format: "easyread-static-translation-v1",
  maxBytes: 32 * 1024 * 1024,
  escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  },
  complete(paper, job = {}) {
    const total = paper?.meta?.page_count, tr = paper?.translation;
    if (!Number.isSafeInteger(total) || total < 1 || !tr || !Array.isArray(tr.done_pages)
      || (tr.en_pages != null && !Array.isArray(tr.en_pages))) throw new Error("翻译进度数据无效，已停止导出。");
    const done = new Set(tr.done_pages), en = new Set(tr.en_pages || []);
    if ([...done,...en].some(p => !Number.isInteger(p) || p < 1 || p > total)) throw new Error("翻译页码无效，已停止导出。");
    const translated = [...done].filter(p => !en.has(p)).length;
    if (translated !== total) throw Object.assign(new Error(`尚未完成全文翻译（${translated} / ${total} 页），已跳过。`),{code:"INCOMPLETE"});
    if (["queued","running","confirm","partial","error","cancelled"].includes(job?.state)
      || Object.keys(job?.failed || {}).length) throw Object.assign(new Error("翻译任务尚未成功结束，请在 EasyRead 中检查后重试。"),{code:"INCOMPLETE"});
    if (!Array.isArray(paper.blocks) || !paper.blocks.length) throw new Error("论文正文为空，已停止导出。");
    return {done:translated,total};
  },
  parseExport(html) {
    if (typeof html !== "string") throw new Error("EasyRead 未返回 HTML 导出。");
    // Extract JSON only. Never execute the service's scripts or insert its HTML/CSS into a chrome document.
    const matches = [...html.matchAll(/<script\b[^>]*\bid=["']pr-data["'][^>]*>([\s\S]*?)<\/script\s*>/gi)];
    if (matches.length !== 1) throw new Error("EasyRead 导出格式不兼容，原附件未修改。");
    let data;
    try { data = JSON.parse(matches[0][1]); } catch (_) { throw new Error("EasyRead 导出数据不是有效的 JSON。"); }
    if (data?.paper?.schema !== 2 || !data.images || typeof data.images !== "object" || Array.isArray(data.images)
      || !/^[a-f0-9]{64}$/.test(data.paper.meta?.source_sha256 || "")) throw new Error("EasyRead 导出结构不兼容，原附件未修改。");
    this.complete(data.paper);
    return data;
  },
  sourceIdentity(html) {
    const source = /<meta name="easyread-source-sha256" content="([a-f0-9]{64})">/.exec(html);
    const format = /<meta name="easyread-format" content="easyread-static-translation-v1">/.test(html);
    return format && source ? source[1] : null;
  },
  render(data, {markup, css}) {
    const {paper} = data;
    this.complete(paper);
    if (!/^[a-f0-9]{64}$/.test(paper.meta.source_sha256 || "")) throw new Error("论文完整指纹无效。");
    const e = value => this.escape(value), m = markup;
    if (!m?.md || !m?.tex || typeof css !== "string" || /<\/style/i.test(css)) throw new Error("插件阅读资源未正确加载。");
    const edits = data.reader?.edits || {}, blocks = paper.blocks;
    const ids = new Set();
    m.blockById = Object.create(null); m.refById = Object.create(null);
    m.xindex = {eq:Object.create(null),tab:Object.create(null),fig:Object.create(null),sec:Object.create(null)};
    for (const b of blocks) {
      if (!b || !/^[A-Za-z0-9_-]{1,128}$/.test(b.id || "") || ids.has(b.id)) throw new Error("论文段落标识无效或重复，已停止导出。");
      if (!["heading","para","list","math","table","figure","references","note"].includes(b.type)) throw new Error(`不支持的论文块类型：${b.type}。`);
      ids.add(b.id); m.blockById[b.id] = b;
      const kind = {math:"eq",table:"tab",figure:"fig",heading:"sec"}[b.type];
      if (kind && (b.tag || b.num)) m.xindex[kind][b.tag || b.num] = b.id;
    }
    const references = paper.references || [];
    if (!Array.isArray(references)) throw new Error("参考文献数据无效。");
    for (const r of references) {
      if (!r || !/^[A-Za-z0-9_-]{1,64}$/.test(String(r.id || ""))) throw new Error("参考文献标识无效。");
      m.refById[String(r.id)] = r;
    }
    const fixLinks = html => html
      .replace(/<a class="cite" data-ref="(\d+)">/g, (_tag, id) => `<a class="cite" href="#ref-${id}">`)
      .replace(/<a class="xref" data-kind="(eq|tab|fig|sec)" data-key="([\w.:-]+)">/g,
        (tag, kind, key) => m.xindex[kind][key] ? `<a class="xref" href="#b-${e(m.xindex[kind][key])}">` : tag);
    const md = value => fixLinks(m.md(value));
    const text = (key, zh, en) => {
      const edit = Object.hasOwn(edits, key) ? edits[key] : null;
      if (edit?.zh != null) {
        if (typeof edit.zh !== "string") throw new Error(`段落 ${key} 的手动译文无效。`);
        return edit.zh;
      }
      return zh || en || "";
    };
    const caption = b => {
      const value = text(b.id + "#caption", b.caption_zh, b.caption_en);
      return value ? `<figcaption>${md(value)}</figcaption>` : "";
    };
    const rows = value => {
      if (value == null) return [];
      if (!Array.isArray(value)) throw new Error("表格行不是数组，已停止导出。");
      const out = value.length && value.every(v => !Array.isArray(v)) ? [value] : value;
      if (out.some(row => !Array.isArray(row) || row.some(v => v != null && typeof v === "object"))) throw new Error("表格单元格格式无效，已停止导出。");
      return out;
    };
    const title = paper.meta.title_zh || paper.meta.title_en || "EasyRead翻译";
    const first = blocks[0];
    const titleBlock = first.type === "heading" && first.page === 1
      && (/title/i.test(first.id) || first.zh === paper.meta.title_zh || first.en === paper.meta.title_en);
    const heading = b => {
      const value = String(text(b.id,b.zh,b.en)), number = String(b.num || "");
      const escaped = number.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
      const repeated = number && new RegExp("^" + escaped + "(?:[.、．:：)）\\s]|$)","i").test(value.trim());
      return {value,number:repeated ? "" : number};
    };
    const headings = blocks.filter(b => b.type === "heading" && !(b === first && titleBlock));
    const toc = headings.length > 1 ? '<nav aria-label="文章目录"><details><summary>目录</summary><ol>' + headings.map(b =>
      `<li class="toc-level-${Math.min(6,Math.max(1,Number(b.level) || 1))}"><a href="#b-${e(b.id)}">${e((heading(b).number ? heading(b).number + " " : "") + heading(b).value)}</a></li>`).join("") + "</ol></details></nav>" : "";
    let body = titleBlock ? "" : `<header><h1>${e(title)}</h1>${paper.meta.authors ? `<p class="byline">${e(paper.meta.authors)}</p>` : ""}</header>`;
    if (!titleBlock) body += toc;
    let images = 0, tables = 0;
    for (const b of blocks) {
      if (b.type === "note") continue; // Reading assistance is not part of the paper's translation.
      let content;
      switch (b.type) {
        case "heading": {
          const tag = b === first && titleBlock ? "h1" : "h" + Math.min(6,Math.max(2,(Number(b.level) || 1) + 1));
          const h = heading(b);
          content = `<${tag}>${h.number ? `<span class="section-number">${e(h.number)}</span> ` : ""}${md(h.value)}</${tag}>`;
          break;
        }
        case "para": content = `<div class="paragraph">${md(text(b.id,b.zh,b.en))}</div>`; break;
        case "list": {
          if (!Array.isArray(b.items)) throw new Error(`列表 ${b.id} 格式无效。`);
          const tag = b.ordered ? "ol" : "ul";
          content = `<${tag}>` + b.items.map((item,i) => `<li>${md(text(b.id + "#" + i,item?.zh,item?.en))}</li>`).join("") + `</${tag}>`;
          break;
        }
        case "math": content = `<div class="math-row"><div class="math-body">${m.tex(String(b.tex || ""),true)}</div>${b.tag ? `<span class="math-tag">(${e(b.tag)})</span>` : ""}</div>`; break;
        case "table": {
          tables++;
          const rowHTML = (row, tag) => "<tr>" + row.map((cell,i) => {
            const align = {l:"left",c:"center",r:"right"}[String(b.align || "")[i]];
            return `<${tag}${align ? ` style="text-align:${align}"` : ""}>${md(String(cell ?? ""))}</${tag}>`;
          }).join("") + "</tr>";
          const table = '<div class="table-scroll" role="region" aria-label="可横向滚动的表格" tabindex="0"><table><thead>'
            + rows(b.head).map(r => rowHTML(r,"th")).join("") + "</thead><tbody>"
            + rows(b.rows).map(r => rowHTML(r,"td")).join("") + "</tbody></table></div>";
          content = `<figure>${b.caption_pos === "above" ? caption(b) + table : table + caption(b)}</figure>`;
          break;
        }
        case "figure": {
          const src = Object.hasOwn(data.images,b.src) ? data.images[b.src] : null;
          if (typeof src !== "string" || !/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(src)) throw new Error(`插图 ${b.id} 缺失或不是内嵌图片，原附件未修改。`);
          images++;
          const imageText = text(b.id + "#image",b.image_zh,b.image_en);
          content = `<figure><img src="${src}" alt="${e(b.caption_zh || "论文插图")}" loading="eager">`
            + (imageText ? `<div class="figure-text"><span>图内文字</span>${md(imageText)}</div>` : "") + caption(b) + "</figure>";
          break;
        }
        case "references": content = `<h2>参考文献</h2><ol class="references">` + references.map(r => `<li id="ref-${e(r.id)}"><span class="reference-number">[${e(r.id)}]</span><span>${md(r.text || "")}</span></li>`).join("") + "</ol>"; break;
      }
      if (/class="katex-error"/.test(content)) throw new Error(`段落 ${b.id} 的公式无法渲染，请在 EasyRead 中修正。`);
      body += `<section id="b-${e(b.id)}" class="block block-${b.type}">${content}</section>`;
      if (b === first && titleBlock) body += toc;
    }
    // No data blob, timestamps, progress, chat, or reader notes: reading alone must not dirty the attachment.
    const html = '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
      + `<meta name="easyread-format" content="${this.format}"><meta name="easyread-source-sha256" content="${paper.meta.source_sha256}">`
      + `<meta name="color-scheme" content="light dark"><title>${e(title)}</title><style>${css}</style></head><body><main id="paper">${body}</main></body></html>`;
    if (new TextEncoder().encode(html).byteLength > this.maxBytes) throw new Error("译文附件超过 32 MB，暂不同步，请先检查插图体积。");
    return {html,images,tables,title,blocks:blocks.filter(b => b.type !== "note").length};
  }
};
if (typeof module !== "undefined") module.exports = EasyReadTranslation;
