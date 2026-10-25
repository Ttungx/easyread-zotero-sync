const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../zotero/core.js');
const translation = require('../zotero/translation.js');
const katex = require('../zotero/vendor/katex.min.js');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V0AAAAASUVORK5CYII=';
function markup() {
  const m = {esc:value => core.escape(value),t:(text,args={})=>text.replace(/\{(\w+)\}/g,(_all,key)=>String(args[key]??''))};
  const context = vm.createContext({EasyReadMarkup:m,katex,URL});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../zotero/vendor/markup.js'),'utf8'),context);
  return m;
}
function data(sha = 'a'.repeat(64)) {
  return {paper:{schema:2,meta:{title_zh:'测试论文',title_en:'Test paper',page_count:2,source_sha256:sha},translation:{done_pages:[1,2],en_pages:[]},
    blocks:[{id:'s-title',type:'heading',level:1,page:1,zh:'测试论文',en:'Test paper'},
      {id:'intro',type:'heading',level:1,page:1,zh:'引言',en:'Introduction'},
      {id:'p1',type:'para',page:1,zh:'你好，公式 $E=mc^2$，见图 1 与文献 [1]。',en:'PRIVATE ORIGINAL PARAGRAPH'},
      {id:'math1',type:'math',page:1,tex:'\\frac{1}{2}',tag:'1'},
      {id:'list1',type:'list',page:1,items:[{zh:'第一项',en:'PRIVATE LIST ORIGINAL'}]},
      {id:'tab1',type:'table',page:2,num:'1',head:[['方法','准确率']],rows:[['宽表模型'.repeat(20),'$93.6\\%$']],caption_zh:'表 1：测试',caption_en:'PRIVATE CAPTION'},
      {id:'fig1',type:'figure',page:2,num:'1',src:'figures/test.png',caption_zh:'图 1：测试',image_zh:'图内译文',image_en:'PRIVATE IMAGE ORIGINAL'},
      {id:'conclusion',type:'heading',level:1,page:2,zh:'结论',en:'Conclusion'},
      {id:'refs',type:'references',page:2,zh:'参考文献'}],references:[{id:'1',text:'Reference one.'}]},
    reader:{edits:{},notes:{private:{body:'PRIVATE NOTE'}},progress:{ratio:.3}},discussion:{entries:[{body:'PRIVATE DISCUSSION'}]},item:{last_opened:'2026-01-01'},images:{'figures/test.png':png}};
}
function exported(d) { return '<script>throw new Error("UNTRUSTED SCRIPT")</script><script id="pr-data" type="application/json">'+JSON.stringify(d).replace(/</g,'\\u003c')+'</script>'; }
function render(d, css='body{color:black}') { return translation.render(d,{markup:markup(),css}); }
module.exports = {markup,data,exported,render,translation,png};
