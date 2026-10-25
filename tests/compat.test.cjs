const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const core=require('../zotero/core.js');
const preferencesSource=fs.readFileSync(path.join(__dirname,'../zotero/preferences.js'),'utf8');
function preferencesHarness(initial={}) {
  const values={...initial},fields={
    'easyread-sync-translate':{checked:true,addEventListener(event,fn){this[event]=fn;}},
    'easyread-sync-include-ai':{checked:true,addEventListener(event,fn){this[event]=fn;}},
    'easyread-sync-english-context':{checked:true,addEventListener(event,fn){this[event]=fn;}},
    'easyread-sync-executable':{value:'C:\\EasyRead\\EasyRead.exe',addEventListener(event,fn){this[event]=fn;}},
    'easyread-sync-home':{value:'C:\\EasyRead\\data',addEventListener(event,fn){this[event]=fn;}},
    'easyread-sync-server-url':{value:'',addEventListener(event,fn){this[event]=fn;}},
    'easyread-sync-status':{textContent:''},
  };
  const root={id:'easyread-sync-preferences',ownerDocument:{getElementById:id=>fields[id]},listeners:{},addEventListener(event,fn){this.listeners[event]=fn;}};
  const ctx={Zotero:{Prefs:{get:(key)=>values[key],set:(key,value)=>values[key]=value,registerObserver:(key,handler)=>{ctx.observed={key,handler};return key;},unregisterObserver:key=>{ctx.unregistered=key;}}},
    Services:{env:{get:()=> 'C:\\Program Files'},dirsvc:{get:()=>({path:'C:\\User'})}},
    Components:{interfaces:{nsIFile:{}}},PathUtils:{join:path.win32.join},
    document:{listeners:{},addEventListener(event,fn,capture){assert.equal(capture,true);this.listeners[event]=fn;},removeEventListener(event,fn,capture){assert.equal(capture,true);assert.equal(this.listeners[event],fn);delete this.listeners[event];}}};
  vm.createContext(ctx);vm.runInContext(preferencesSource,ctx);
  return {api:ctx.EasyReadSyncPreferences,fields,values,ctx,root};
}
function bridge(prefs={},http=async()=>{throw {status:404};}) {
  const calls=[],launched=[],reads=[];
  const ctx={EasyReadCore:core,TextEncoder,Components:{interfaces:{nsIFile:{}}},
    PathUtils:{join:path.win32.join,parent:path.win32.dirname},
    Services:{env:{get:()=> 'C:\\Program Files'},dirsvc:{get:()=>({path:'C:\\User'})}},
    IOUtils:{exists:async()=>true},
    Zotero:{Prefs:{get:key=>prefs[key.replace('extensions.easyread-zotero-sync.','')],registerObserver:(key,handler)=>{(prefs.observers??=[]).push({key,handler});return key;},unregisterObserver:key=>{prefs.removedObservers=(prefs.removedObservers||[]).concat(key);}},
      HTTP:{request:async(method,url)=>{calls.push(url);return http(url);}},
      Utilities:{Internal:{exec:async(exe,args)=>launched.push({exe,args})}},
      logError(){},launchURL:url=>launched.push({url})}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../zotero/bridge.js'),'utf8'),ctx);
  return {owner:ctx.ZoteroEasyRead,ctx,calls,launched,reads,prefs};
}
test('native preferences pane saves isolated settings and rejects non-loopback URLs',()=>{
  const b=preferencesHarness({"extensions.zotero-easyread.home":"D:\\Legacy\\EasyRead"});
  b.ctx.document.listeners.load({target:{id:"other-pane"}});assert.ok(b.ctx.document.listeners.load);
  b.ctx.document.listeners.load({target:b.root});assert.equal(b.ctx.document.listeners.load,undefined);
  assert.equal(b.fields['easyread-sync-home'].value,'D:\\Legacy\\EasyRead');
  assert.equal(b.fields['easyread-sync-include-ai'].checked,true);
  b.fields['easyread-sync-server-url'].value='http://127.0.0.1:65536';b.fields['easyread-sync-server-url'].change();
  assert.match(b.fields['easyread-sync-status'].textContent,/65535/);assert.deepEqual(b.values,{"extensions.zotero-easyread.home":"D:\\Legacy\\EasyRead"});
  b.fields['easyread-sync-server-url'].value='https://127.0.0.1:1234';b.fields['easyread-sync-server-url'].change();
  assert.match(b.fields['easyread-sync-status'].textContent,/无效/);assert.deepEqual(b.values,{"extensions.zotero-easyread.home":"D:\\Legacy\\EasyRead"});
  b.fields['easyread-sync-server-url'].value='http://127.0.0.1:1234';b.fields['easyread-sync-server-url'].change();
  assert.equal(b.values['extensions.easyread-zotero-sync.serverURL'],'http://127.0.0.1:1234');
  assert.equal(b.values['extensions.easyread-zotero-sync.translate'],true);
  assert.equal(b.fields['easyread-sync-status'].textContent,'设置已保存。');
  b.ctx.observed.handler();assert.equal(b.fields['easyread-sync-server-url'].value,'http://127.0.0.1:1234');
  b.root.listeners.unload();assert.equal(b.ctx.unregistered,'extensions.easyread-zotero-sync.serverURL');
});
test('detect migrated install data when old configured directory disappears',async()=>{
  const b=bridge({home:'C:\\Old',executable:'D:\\Apps\\EasyRead\\EasyRead.exe'},async url=>({response:url.endsWith('/api/version')?{api:1,version:'1.3.2'}:{items:[],token:'fixture'}}));
  b.owner.readJSON=async file=>file==='D:\\Apps\\EasyRead\\data\\.server.json'?{url:'http://127.0.0.1:52341'}:{};
  const conn=await b.owner.probe();assert.equal(conn.home,'D:\\Apps\\EasyRead\\data');assert.equal(conn.api,1);
  assert.equal(b.owner.home(),conn.home);
});
test('preserve explicit live custom directory and support older servers',async()=>{
  const b=bridge({home:'E:\\Custom'},async url=>{if(url.endsWith('/api/version'))throw {status:404};return {response:{items:[],token:'fixture'}};});
  b.owner.readJSON=async()=>({url:'http://127.0.0.1:52341'});
  const conn=await b.owner.probe();assert.equal(conn.home,'E:\\Custom');assert.equal(conn.api,0);
});
test('reject unsupported API before importing or syncing',async()=>{
  const b=bridge({},async()=>({response:{api:2}}));b.owner.readJSON=async()=>({url:'http://127.0.0.1:52341'});
  await assert.rejects(b.owner.probe(),/API 版本不兼容/);assert.equal(b.calls.length,1);
});
test('official desktop link uses fingerprint and paragraph without archive inbox',async()=>{
  const b=bridge({executable:'D:\\Apps\\EasyRead\\EasyRead.exe'});
  b.owner.writeJSON=()=>{throw new Error('Legacy bridge should not be used');};
  await b.owner.navigate({api:1,url:'http://127.0.0.1:52341'},'abcdef123456','p3-2#selection','a'.repeat(64));
  assert.equal(b.launched[0].args[0],'easyread://open?sha256='+'a'.repeat(64)+'&block=p3-2');
  assert.throws(()=>core.officialOpen('abcdef123456','p1&url=https'),/段落/);
  assert.throws(()=>core.officialOpen('abcdef123456','','bad'),/指纹/);
});
test('read only documented parts and never the side-effecting state endpoint',async()=>{
  const b=bridge();const calls=[];
  b.owner.request=async(_conn,url)=>{calls.push(url);return {data:url.endsWith('/paper')?{meta:{}}:{}};};
  const state=await b.owner.readingState({},'abcdef123456');assert.ok(state.paper.meta);
  assert.equal(calls.length,3);assert.ok(calls.every(url=>url.includes('/part/')));
  b.ctx.Zotero.Prefs.get=key=>key.endsWith('includeAI')?false:undefined;
  calls.length=0;await b.owner.readingState({},'abcdef123456');assert.equal(calls.length,2);
});
test('batch import focuses native application without opening a browser tab',async()=>{
  const b=bridge();await b.owner.navigate({api:1,url:'http://127.0.0.1:52341'},'');
  assert.equal(b.launched.length,1);assert.equal(b.launched[0].args.length,0);
});

const crypto=require('node:crypto'),reading=require('./reading-fixture.cjs');
function viewHarness() {
  const b=bridge(),disk=new Map(),items=new Map(),calls={imports:0,relinks:0,saves:0,resumes:0,pauses:0,writes:0,exports:0};
  const owner=b.owner,ctx=b.ctx,sha='a'.repeat(64),payload=reading.data(sha),job={state:'done',failed:{}};
  ctx.EasyReadTranslation=reading.translation;ctx.EasyReadMarkup=reading.markup();
  ctx.PathUtils.filename=value=>{if(!path.win32.isAbsolute(value))throw new Error('PathUtils requires an absolute path');return path.win32.basename(value);};
  ctx.Services.uuid={generateUUID:()=>({toString:()=>'{00000000-0000-0000-0000-000000000001}'})};
  const parent={id:1,key:'PARENT01',getAttachments:()=>[...items.keys()],getField:()=> 'Fixture'};
  const file={parent,libraryID:1,mapKey:'1:PDF00001',attachmentKey:'PDF00001',title:'Fixture',path:'C:\\Fixture\\source.pdf',stat:{size:5,lastModified:1}};
  disk.set(file.path,'%PDF-');
  function attachment(id=100,key='VIEW0001') {
    const item={id,key,parentID:1,libraryID:1,deleted:false,attachmentContentType:'text/html',attachmentLinkMode:0,
      attachmentFilename:'EasyRead翻译.html',attachmentSyncState:2,tags:new Set(),annotations:[],title:'EasyRead翻译',
      path:'C:\\Storage\\'+key+'\\EasyRead翻译.html',
      isAttachment:()=>true,getField(){return this.title;},setField(_field,value){this.title=value;},addTag(tag){this.tags.add(tag);},hasTag(tag){return this.tags.has(tag);},
      getAnnotations(){return this.annotations;},async getFilePathAsync(){return this.path;},
      async relinkAttachmentFile(source){calls.relinks++;disk.set(this.path,disk.get(source));},async saveTx(){calls.saves++;}};
    items.set(id,item);return item;
  }
  ctx.IOUtils={exists:async p=>disk.has(p),readUTF8:async p=>{if(!disk.has(p))throw new Error('Missing file');return disk.get(p);},
    writeUTF8:async(p,value)=>{calls.writes++;disk.set(p,value);},makeDirectory:async()=>{},stat:async p=>({size:Buffer.byteLength(disk.get(p)||''),lastModified:1}),
    copy:async(a,c)=>disk.set(c,disk.get(a)),remove:async(p,opts)=>{for(const key of disk.keys())if(key===p||(opts?.recursive&&key.startsWith(p+'\\')))disk.delete(key);}};
  ctx.Zotero.Profile={dir:'C:\\Profile'};ctx.Zotero.getTempDirectory=()=>({path:'C:\\Temp'});
  ctx.Zotero.Libraries={get:()=>({editable:true,filesEditable:true})};
  ctx.Zotero.Items={get:id=>items.get(id),getByLibraryAndKeyAsync:async(lib,key)=>[...items.values()].find(i=>i.libraryID===lib&&i.key===key)||null};
  ctx.Zotero.Attachments={LINK_MODE_IMPORTED_FILE:0,importFromFile:async({file:source,title,contentType,parentItemID})=>{
    calls.imports++;const item=attachment(100+calls.imports,'VIEW000'+calls.imports);item.title=title;item.attachmentContentType=contentType;item.parentID=parentItemID;disk.set(item.path,disk.get(source));return item;
  }};
  ctx.Zotero.Sync={Storage:{Local:{SYNC_STATE_TO_DOWNLOAD:1,SYNC_STATE_FORCE_DOWNLOAD:4,SYNC_STATE_IN_CONFLICT:5}},Runner:{syncInProgress:false,delayIndefinite:()=>{calls.pauses++;return()=>calls.resumes++;}}};
  owner.alive=true;owner.registry=core.migrateRegistry(null);owner.translationCSS='body{color:black}';
  owner.hashHTML=html=>crypto.createHash('sha256').update(html).digest('hex');
  owner.confirmViewUpdate=()=>false;owner.fingerprint=async()=>({sha256:sha});
  owner.connect=async()=>({api:1,url:'http://127.0.0.1:52341',library:{items:[{id:sha.slice(0,12)}]}});
  owner.request=async(_conn,endpoint)=>{
    if(endpoint.includes('/export?')){calls.exports++;return reading.exported(payload);}
    if(endpoint.endsWith('/paper'))return {data:JSON.parse(JSON.stringify(payload.paper))};
    if(endpoint.endsWith('/reader'))return {data:JSON.parse(JSON.stringify(payload.reader))};
    if(endpoint.endsWith('/job'))return {data:job};
    throw new Error('Unexpected endpoint '+endpoint);
  };
  return {...b,disk,items,calls,owner,ctx,file,mapping:{id:sha.slice(0,12),sha256:sha},payload,job,attachment,html:()=>reading.render(payload).html};
}
test('packed reading resources use the resource API, cache only success and retry failed reads',async()=>{
  const b=bridge(),root='jar:file:///C:/plugins/easyread-sync.xpi!/',reads=[];
  b.owner.resourceURI=root;
  let fail=true;
  b.ctx.Zotero.File={
    getContentsFromURLAsync:()=>{throw new Error('NS_ERROR_FAILURE [nsIURI.username]');},
    getResourceAsync:async uri=>{
      reads.push(uri);
      if(uri.endsWith('reader.css')&&fail)throw new Error('Resource unavailable');
      return uri.endsWith('reader.css')?'body{color:black}':'.katex{color:inherit}';
    }
  };
  await assert.rejects(b.owner.readingCSS(),/Resource unavailable/);assert.equal(b.owner.translationCSS,undefined);
  fail=false;
  assert.equal(await b.owner.readingCSS(),'.katex{color:inherit}\nbody{color:black}');
  const count=reads.length;await b.owner.readingCSS();assert.equal(reads.length,count);
  assert.ok(reads.every(uri=>uri.startsWith(root)));
});

test('text export requests retain local-address validation and request text, not JSON',async()=>{
  const b=bridge();let options;
  b.ctx.Zotero.HTTP.request=async(_method,_url,opts)=>{options=opts;return {response:'<html>test</html>'};};
  assert.equal(await b.owner.request({url:'http://127.0.0.1:1234'},'/api/p/abcdef123456/export?mobile=1',undefined,'application/json','text'),'<html>test</html>');
  assert.equal(options.responseType,'text');assert.equal(options.followRedirects,false);
  await assert.rejects(b.owner.request({url:'http://evil.test:1234'},'/api/version'),/无效/);
});
test('fresh sync imports one stored HTML and persists separate registry; no-op does not write',async()=>{
  const b=viewHarness();let result=await b.owner.saveView(b.file,b.mapping,b.html());
  assert.equal(result.changed,true);assert.equal(b.calls.imports,1);assert.equal(b.calls.relinks,0);
  const item=[...b.items.values()][0];assert.ok(item.hasTag('EasyRead'));assert.equal(item.attachmentSyncState,'to_upload');
  assert.match(b.owner.registryPath(),/easyread-zotero-sync.json$/);const writes=b.calls.writes;
  result=await b.owner.saveView(b.file,b.mapping,b.html());assert.equal(result.changed,false);assert.equal(b.calls.writes,writes);
  assert.equal(b.calls.resumes,b.calls.pauses);
});
test('changed content updates same key, keeps a local backup and restores a missing file',async()=>{
  const b=viewHarness();const first=b.html();await b.owner.saveView(b.file,b.mapping,first);
  const item=[...b.items.values()][0],key=item.key;
  b.payload.reader.edits.p1={zh:'Updated translation'};const next=b.html();await b.owner.saveView(b.file,b.mapping,next);
  assert.equal(b.calls.imports,1);assert.equal(b.calls.relinks,1);assert.equal(item.key,key);assert.equal(b.disk.get(item.path),next);
  assert.equal(b.disk.get('C:\\Profile\\easyread-zotero-sync-backups\\'+key+'.previous.html'),first);
  b.disk.delete(item.path);await b.owner.saveView(b.file,b.mapping,next);assert.equal(b.calls.relinks,2);assert.equal(b.disk.get(item.path),next);
});
test('stored HTML filename rejects paths before importing or overwriting',async()=>{
  const b=viewHarness();await b.owner.saveView(b.file,b.mapping,b.html());
  const item=[...b.items.values()][0],stored=b.disk.get(item.path);
  b.payload.reader.edits.p1={zh:'Changed'};
  for(const name of ['../other.html','C:\\other.html','C:other.html','other.txt']){
    item.attachmentFilename=name;
    await assert.rejects(b.owner.saveView(b.file,b.mapping,b.html()),/文件名无效/);
    assert.equal(b.disk.get(item.path),stored);assert.equal(b.calls.relinks,0);
    assert.equal(b.calls.pauses,b.calls.resumes);
  }
});

test('registry loss recovers only a uniquely source-marked attachment',async()=>{
  const b=viewHarness();await b.owner.saveView(b.file,b.mapping,b.html());b.owner.registry=core.migrateRegistry(null);
  assert.equal((await b.owner.saveView(b.file,b.mapping,b.html())).changed,false);assert.equal(b.calls.imports,1);
  b.attachment(500,'SECOND01');b.disk.set(b.items.get(500).path,b.html());b.owner.registry=core.migrateRegistry(null);
  await assert.rejects(b.owner.saveView(b.file,b.mapping,b.html()),/多个候选/);
});
test('edited files, existing annotations and unknown legacy attachments need explicit confirmation',async()=>{
  const b=viewHarness();await b.owner.saveView(b.file,b.mapping,b.html());const item=[...b.items.values()][0];
  b.payload.reader.edits.p1={zh:'Changed'};item.annotations=[123];
  await assert.rejects(b.owner.saveView(b.file,b.mapping,b.html()),/原生批注/);assert.equal(b.calls.relinks,0);
  b.owner.confirmViewUpdate=()=>true;await b.owner.saveView(b.file,b.mapping,b.html(),{allowPrompt:true});assert.equal(b.calls.relinks,1);
  item.annotations=[];b.disk.set(item.path,b.disk.get(item.path)+'<p>Manual edit</p>');
  await assert.rejects(b.owner.saveView(b.file,b.mapping,b.html()),/被修改/);
  b.owner.registry=core.migrateRegistry(null);b.disk.set(item.path,'<html>Legacy experiment</html>');
  await assert.rejects(b.owner.saveView(b.file,b.mapping,b.html()),/没有可核验/);assert.equal(b.calls.imports,1);
});
test('readonly libraries, pending downloads and active sync never overwrite attachments',async()=>{
  const b=viewHarness();b.ctx.Zotero.Libraries.get=()=>({editable:true,filesEditable:false});
  await assert.rejects(b.owner.saveView(b.file,b.mapping,b.html()),/权限/);assert.equal(b.calls.imports,0);
  b.ctx.Zotero.Libraries.get=()=>({editable:true,filesEditable:true});await b.owner.saveView(b.file,b.mapping,b.html());
  b.payload.reader.edits.p1={zh:'Changed'};const item=[...b.items.values()][0];item.attachmentSyncState=1;
  await assert.rejects(b.owner.saveView(b.file,b.mapping,b.html()),/待下载/);item.attachmentSyncState=2;
  b.ctx.Zotero.Sync.Runner.syncInProgress=true;await assert.rejects(b.owner.saveView(b.file,b.mapping,b.html()),/正在同步/);
  assert.equal(b.calls.relinks,0);
});
test('schema migration snapshots before atomic write and future registry is untouched',async()=>{
  const b=viewHarness(),p=b.owner.registryPath(),old={schema:1,attachments:{keep:{id:'old'}},notes:{},extra:42};
  b.disk.set(p,JSON.stringify(old));await b.owner.loadRegistry();assert.deepEqual(JSON.parse(b.disk.get(p+'.v1.bak')),old);
  assert.equal(b.owner.registry.schema,2);assert.equal(b.owner.registry.extra,42);
  const future=JSON.stringify({...old,schema:99});b.disk.set(p,future);await assert.rejects(b.owner.loadRegistry(),/不兼容/);assert.equal(b.disk.get(p),future);
});
test('incomplete translations stop before export and normal sync ignores progress changes',async()=>{
  const b=viewHarness();b.payload.paper.translation.done_pages=[1];let report=await b.owner.syncViews([b.file]);
  assert.equal(report.skipped,1);assert.equal(b.calls.exports,0);assert.equal(b.calls.imports,0);
  b.payload.paper.translation.done_pages=[1,2];report=await b.owner.syncViews([b.file]);assert.equal(report.changed,1);
  b.payload.reader.progress={ratio:.99};report=await b.owner.syncViews([b.file]);assert.equal(report.unchanged,1);assert.equal(b.calls.relinks,0);
});
test('a PDF replaced during export does not get an attachment for its old bytes',async()=>{
  const b=viewHarness(),request=b.owner.request;
  b.owner.request=async(c,e)=>{const result=await request(c,e);if(e.includes('/export?'))b.disk.set(b.file.path,'%PDF-CHANGED');return result;};
  const result=await b.owner.syncViews([b.file]);assert.equal(result.failed,1);assert.equal(b.calls.imports,0);assert.match(result.details[0],/PDF.*发生变化/);
});
test('failed registry write leaves recoverable attachment and always releases the sync pause',async()=>{
  const b=viewHarness(),write=b.ctx.IOUtils.writeUTF8;
  b.ctx.IOUtils.writeUTF8=async(p,value)=>{if(p===b.owner.registryPath())throw new Error('Disk full');return write(p,value);};
  await assert.rejects(b.owner.saveView(b.file,b.mapping,b.html()),/Disk full/);assert.equal(b.calls.imports,1);assert.equal(b.calls.resumes,b.calls.pauses);
  assert.equal(Object.keys(b.owner.registry.views).length,0);
  b.ctx.IOUtils.writeUTF8=write;
  assert.equal((await b.owner.saveView(b.file,b.mapping,b.html())).changed,false);assert.equal(b.calls.imports,1);
});
test('packaged bootstrap registers a native Zotero preferences pane and cleans it up',async()=>{
  const b=viewHarness(),ctx=b.ctx,registered=[],removed=[],removedPanes=[],oldHandler={old:true};
  const protocol={_extensions:{'zotero://easyread':oldHandler}};
  ctx.URL=URL;ctx.Zotero.initializationPromise=Promise.resolve();ctx.Zotero.version='10.0.6';
  ctx.Zotero.MenuManager={registerMenu:config=>{registered.push(config);return config.menuID;},unregisterMenu:id=>removed.push(id)};
  ctx.Zotero.PreferencePanes={register:async config=>{registered.push(config);return config.id;},unregister:id=>removedPanes.push(id)};
  ctx.Zotero.Utilities.Internal.openPreferences=id=>{ctx.openedPreference=id;};
  ctx.Services.io={getProtocolHandler:()=>({wrappedJSObject:protocol})};
  ctx.Services.scriptloader={loadSubScript:(uri,scope)=>{
    const rel=uri.replace('fixture:///','');
    const code=fs.readFileSync(path.join(__dirname,'../zotero',rel),'utf8');
    vm.runInContext(code,scope?vm.createContext(scope):ctx,{filename:rel});
  }};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../zotero/bootstrap.js'),'utf8'),ctx);
  await ctx.startup({rootURI:'fixture:///'});
  assert.equal(ctx.ZoteroEasyRead.pluginID,'easyread-zotero-sync@local.research');assert.equal(ctx.ZoteroEasyRead.version,'0.2.1');assert.equal(ctx.katex.version,'0.16.22');
  assert.equal(registered.length,3);assert.equal(registered[0].pluginID,ctx.ZoteroEasyRead.pluginID);
  const pane=registered.find(entry=>entry.id==='easyread-sync-preferences');
  assert.match(pane.src,/preferences\.xhtml$/);assert.match(pane.scripts[0],/preferences\.js$/);assert.match(pane.stylesheets[0],/preferences\.css$/);
  ctx.ZoteroEasyRead.settings();assert.equal(ctx.openedPreference,pane.id);
  assert.ok(protocol._extensions['zotero://easyread-sync']);assert.equal(protocol._extensions['zotero://easyread'],oldHandler);
  ctx.ZoteroEasyRead.resolvedHome='C:\\Cached';b.prefs.observers[0].handler();assert.equal(ctx.ZoteroEasyRead.resolvedHome,null);
  const rendered=ctx.EasyReadTranslation.render(reading.data(),{markup:ctx.EasyReadMarkup,css:'body{}'});
  assert.match(rendered.html,/class="katex"/);
  ctx.shutdown();assert.equal(removed.length,2);assert.deepEqual(removedPanes,[pane.id]);assert.equal(b.prefs.removedObservers.length,2);assert.equal(protocol._extensions['zotero://easyread-sync'],undefined);assert.equal(protocol._extensions['zotero://easyread'],oldHandler);
});
