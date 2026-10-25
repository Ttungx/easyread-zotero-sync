const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../zotero/core.js');
const desktop = require('../desktop/zotero-bridge.cjs');

const source = {id:'abc123abc123',libraryID:1,attachmentKey:'ABCD1234',title:'论文 <script>alert(1)</script>'};
const state = {paper:{meta:{},blocks:[{id:'p1',page:3,en:'English context'},{id:'p2',page:4,en:'Second'}]},
  reader:{paper_note:{body:'整篇心得'},notes:{a:{id:'a',kind:'note',anchor:'p2',body:'第二段'},b:{id:'b',kind:'highlight',anchor:'p1',quote:'中文摘录 <img onerror=alert(1)>',color:'yellow'},c:{id:'c',deleted:true,body:'删除内容'}}},
  discussion:{entries:[{id:'d',kind:'qa',anchor:'p1',body:'AI 辅助回答'}]},chat:{threads:[{messages:[{content:'私有未选聊天'}]}]}};

test('notes include page, source paragraph, selected AI, and stable deep link',()=>{
  const html=core.render(state,source);
  assert.match(html,/第 3 页/); assert.match(html,/English context/); assert.match(html,/AI 辅助回答/);
  assert.match(html,/zotero:\/\/easyread-sync\/1\/ABCD1234\?anchor=p1/);
  assert.ok(html.indexOf('中文摘录')<html.indexOf('第二段'));
  assert.doesNotMatch(html,/删除内容|私有未选聊天/);
  assert.equal(html,core.render(JSON.parse(JSON.stringify(state)),source));
});
test('untrusted input remains escaped and includes no executable markup',()=>{
  const html=core.render(state,source); assert.doesNotMatch(html,/<script>|<img /);
  assert.match(html,/&lt;script&gt;/); assert.match(html,/&lt;img onerror/);
});
test('AI/context can be excluded without losing user notes',()=>{
  const html=core.render(state,source,{includeAI:false,englishContext:false});
  assert.doesNotMatch(html,/AI 辅助回答|English context/); assert.match(html,/整篇心得|中文摘录/);
});
test('validate local addresses, IDs, and parse encoded paragraph links',()=>{
  assert.ok(core.validBase('http://127.0.0.1:60452'));
  for(const v of ['https://127.0.0.1:1','http://evil.test:80','http://127.0.0.1:65536','http://127.0.0.1:12/path']) assert.ok(!core.validBase(v));
  assert.ok(!core.validID('../file'));
  assert.deepEqual(core.parseLink(core.link(2,'ABCD1234','p1#caption')),{libraryID:2,key:'ABCD1234',anchor:'p1#caption'});
  assert.throws(()=>core.parseLink('zotero://easyread/1/../x'));
});
test('desktop rejects stale, remote, and malformed requests',()=>{
  const req={schema:1,nonce:'a'.repeat(32),id:source.id,anchor:'p1',url:'http://127.0.0.1:54321',at:1000000};
  assert.ok(desktop.validRequest(req,1000000));
  assert.ok(!desktop.validRequest({...req,id:'../config'},1000000));
  assert.ok(!desktop.validRequest({...req,url:'http://evil.test:123'},1000000));
  assert.ok(!desktop.validRequest(req,1200001));
});
test('desktop navigates current window, acknowledges exactly once, and blocks another service',async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'easyread-bridge-test-'));
  const directory=path.join(home,'zotero-bridge'); fs.mkdirSync(directory);
  const loads=[], events={};
  const window={isDestroyed:()=>false,isMinimized:()=>true,restore(){},show(){},focus(){},async loadURL(url){loads.push(url);}};
  const req={schema:1,nonce:'a'.repeat(32),id:source.id,anchor:'p1#caption',url:'http://127.0.0.1:54321',at:Date.now()};
  fs.writeFileSync(path.join(directory,'open.json'),JSON.stringify(req));
  const control=desktop.start({app:{once:(event,fn)=>events[event]=fn},fs,path,os,home,getWindow:()=>window,getUrl:()=>req.url,createWindow:async()=>{}});
  await new Promise(r=>setTimeout(r,20)); await control.tick();
  assert.deepEqual(loads,[req.url+'/read/'+source.id+'#b-p1']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'ack.json'))).ok,true);
  fs.writeFileSync(path.join(directory,'open.json'),JSON.stringify({...req,nonce:'b'.repeat(32),url:'http://127.0.0.1:12345'}));
  await control.tick(); assert.equal(loads.length,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'ack.json'))).ok,false);
  control.stop(); fs.rmSync(home,{recursive:true,force:true});
});

const reading = require('./reading-fixture.cjs');
test('registry migration keeps data and rejects damaged/future schemas',()=>{
  assert.equal(core.migrateRegistry(null).schema,2);
  const old={schema:1,attachments:{pdf:{id:'paper'}},notes:{n:{noteKey:'OLDNOTE1'}},custom:'keep'};
  const migrated=core.migrateRegistry(old);
  assert.deepEqual(migrated,{...old,schema:2,views:{}});assert.equal(old.schema,1);
  assert.deepEqual(core.migrateRegistry(migrated),migrated);
  for(const broken of [{schema:3,attachments:{},notes:{}},{schema:1,attachments:[],notes:{}},{schema:2,attachments:{},notes:{}}]) assert.throws(()=>core.migrateRegistry(broken),/不兼容/);
});
test('full-translation guard checks actual page coverage, English pages and running/failed jobs',()=>{
  const d=reading.data();assert.deepEqual(reading.translation.complete(d.paper,{state:'done'}),{done:2,total:2});
  for(const done of [[],[1],[0,1],[1,9],['1',2],[1,1]]) {
    d.paper.translation.done_pages=done;assert.throws(()=>reading.translation.complete(d.paper));
  }
  d.paper.translation.done_pages=[1,2];d.paper.translation.en_pages=[2];assert.throws(()=>reading.translation.complete(d.paper),/未完成/);
  d.paper.translation.en_pages=[];
  for(const state of ['queued','running','confirm','partial','error','cancelled']) assert.throws(()=>reading.translation.complete(d.paper,{state}),/尚未成功/);
  assert.throws(()=>reading.translation.complete(d.paper,{state:'done',failed:{2:'bad'}}));
  d.paper.meta.page_count=0;assert.throws(()=>reading.translation.complete(d.paper));
});
test('inert export parsing ignores scripts and rejects ambiguous/malformed payloads',()=>{
  const raw=reading.exported(reading.data());assert.equal(reading.translation.parseExport(raw).paper.schema,2);
  assert.throws(()=>reading.translation.parseExport(raw+raw),/格式不兼容/);
  assert.throws(()=>reading.translation.parseExport('<html>no data</html>'));
  assert.throws(()=>reading.translation.parseExport('<script id="pr-data">not json</script>'),/JSON/);
  const bad=reading.data();bad.paper.schema=99;assert.throws(()=>reading.translation.parseExport(reading.exported(bad)),/结构/);
});
test('static translation keeps formulas/tables/images/references and omits originals and private data',()=>{
  const result=reading.render(reading.data());
  assert.equal(result.images,1);assert.equal(result.tables,1);assert.equal(result.blocks,9);
  assert.match(result.html,/class="katex"/);assert.match(result.html,/<table>/);assert.match(result.html,/data:image\/png;base64/);
  assert.match(result.html,/href="#ref-1"/);assert.match(result.html,/href="#b-fig1"/);assert.match(result.html,/<summary>目录<\/summary>/);
  assert.doesNotMatch(result.html,/PRIVATE|<script|<button|pr-data|UNTRUSTED|last_opened/);
  assert.equal(reading.translation.sourceIdentity(result.html),'a'.repeat(64));
});
test('reading/progress/notes do not dirty the document, while a manual translation edit does',()=>{
  const d=reading.data(),first=reading.render(d).html;
  d.reader.progress={ratio:.99,at:'later'};d.reader.notes.new={body:'another private note'};d.item.last_opened='later';d.discussion.entries.push({body:'more chat'});
  assert.equal(reading.render(d).html,first);
  d.reader.edits.p1={zh:'手动修订译文'};d.reader.edits['fig1#caption']={zh:'修订后的图注'};
  const changed=reading.render(d).html;assert.notEqual(changed,first);assert.match(changed,/手动修订译文|修订后的图注/);
  assert.doesNotMatch(changed,/你好，公式/);
});
test('malicious content remains inert and active/missing images or bad IDs stop export',()=>{
  const d=reading.data();d.paper.blocks[2].zh='<script>evil()</script> [bad](javascript:evil) $\\href{javascript:evil}{x}$';
  const html=reading.render(d).html;assert.doesNotMatch(html,/<script|href="javascript:| onerror=/);assert.match(html,/&lt;script&gt;/);
  for(const src of ['https://evil.test/image.webp','data:image/svg+xml;base64,PHN2Zz4=','data:image/webp;base64,\" onerror=evil']) {
    d.images['figures/test.png']=src;assert.throws(()=>reading.render(d),/插图/);
  }
  d.images['figures/test.png']=reading.png;d.paper.blocks[2].id='bad\" onclick=evil';assert.throws(()=>reading.render(d),/标识/);
  d.paper.blocks[2].id='p1';d.paper.meta.source_sha256='bad';assert.throws(()=>reading.render(d),/指纹/);
});
test('chapter numbers already present in translated headings are not repeated',()=>{
  const d=reading.data(),b=d.paper.blocks.find(b=>b.id==='intro');b.num='IV';b.zh='IV. 系统设计';
  const html=reading.render(d).html;assert.match(html,/<h2>IV\. 系统设计<\/h2>/);assert.doesNotMatch(html,/IV IV/);
});
test('invalid table shapes and unsupported block types do not silently lose content',()=>{
  const d=reading.data();d.paper.blocks.find(b=>b.type==='table').rows='broken';assert.throws(()=>reading.render(d),/表格/);
  d.paper.blocks.find(b=>b.type==='table').rows=[['safe']];d.paper.blocks[2].type='unsupported';assert.throws(()=>reading.render(d),/不支持/);
});
