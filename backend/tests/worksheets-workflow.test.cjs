const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../static/worksheets.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../static/worksheets.js'),'utf8').replace(/^import .*;\s*$/gm,'');
const nodes=new Map(),requests=[],storage=new Map(),saved=new Map(),versions=[];let serial=0,lastDownload=null;
function node(id){if(!nodes.has(id))nodes.set(id,{id,value:'',checked:false,disabled:false,hidden:false,textContent:'',innerHTML:'',dataset:{},events:{},classList:{toggle(){}},addEventListener(k,f){(this.events[k]??=[]).push(f)},querySelectorAll(){return[]},showModal(){this.open=true},close(){this.open=false},append(){},click(){lastDownload=this.download},remove(){}});return nodes.get(id)}
for(const m of html.matchAll(/id="([^"]+)"/g))node(m[1]);
node('pages').value='1';node('min-rating').value='400';node('max-rating').value='899';
const fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ex=id=>({id,fen,instruction:'Tìm nước đi tốt nhất.',solution:'e4',rating:800,source:'lichess',turn:'w',themes:[]});
let gen=0,failSelect=false,failLogo=false;
const logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
const fetch=async(url,opt)=>{const body=typeof opt?.body==='string'?JSON.parse(opt.body):opt?.body;requests.push({url,body,method:opt?.method});let data;
if(url==='/api/worksheets/options')data={levels:[{id:'beginner',name:'Mới bắt đầu',min:400,max:899},{id:'advanced',name:'Nâng cao',min:1800,max:2600}],themes:{'':'Mọi chủ đề',mateIn1:'Chiếu hết trong 1 nước'},bank:{name:'Kho đi kèm',count:20000}};
else if(url==='/api/worksheets/logo'){assert.equal(node('logo-input').disabled,true,'Editing must freeze while a logo is processed');if(failLogo)return{ok:false,json:async()=>({detail:'Ảnh không hợp lệ'})};data={logo,width:1,height:1};}
else if(url==='/api/worksheets/generate'){if(failSelect)return{ok:false,json:async()=>({detail:'Thiếu bài đúng độ khó'})};gen++;const document=structuredClone(body.document),selection=body.selection,chosen=Array.from({length:selection.count},(_,i)=>ex('G'+gen+'-'+i));if(body.mode==='replace')document.exercises[body.index]=chosen[0];else if(body.mode==='append')document.exercises.push(...chosen);else document.exercises=chosen;document.filters={min_rating:selection.min_rating,max_rating:selection.max_rating,theme:selection.theme};saved.set(body.document_id,structuredClone(document));versions.push({id:versions.length+1,document_id:body.document_id,document:structuredClone(document),title:document.title,count:document.exercises.length,answer_count:document.exercises.length,action:body.mode,created_at:'2026-10-13 05:00:00'});data={id:body.document_id,version_id:versions.length,document};}
else if(url.startsWith('/api/worksheets/history?')){const q=new URLSearchParams(url.split('?')[1]),offset=Number(q.get('offset')||0);data={items:versions.slice().reverse().slice(offset,offset+12),total:versions.length};}
else if(url.startsWith('/api/worksheets/history/')){const v=versions.find(v=>v.id===Number(url.split('/').at(-1)));data={id:v.document_id,document:structuredClone(v.document),version_id:v.id};}
else if(url==='/api/worksheets/edit'){const exercise={...body.exercise,turn:'w',solution:'e4'},document=structuredClone(body.document);if(body.index!==null)document.exercises[body.index]=exercise;else document.exercises.push(exercise);saved.set(body.document_id,structuredClone(document));data={document,exercise};}
else if(url.startsWith('/api/worksheets/pdf'))return{ok:true,blob:async()=>({type:'application/pdf'})};
else if(url==='/api/worksheets')data=[...saved].map(([id,document])=>({id,title:document.title,count:document.exercises.length}));
else{const id=url.split('/').at(-1);if(opt.method==='PUT'){saved.set(id,structuredClone(body));data={id,document:body}}else data={id,document:structuredClone(saved.get(id))};}
return{ok:true,json:async()=>data};};
async function flush(){for(let i=0;i<40;i++)await Promise.resolve()}
async function click(id){await node(id).onclick?.({target:node(id)});await flush()}
async function input(id,value){node(id).value=value;for(const f of node(id).events.input||[])await f({target:node(id)});await flush()}
(async()=>{
const chess=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../static/vendor/chess.js')).toString('base64'));
const ctx={Chess:chess.Chess,PIECE_DEFS:'',console,fetch,URLSearchParams,Date,confirm:()=>true,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},URL:{createObjectURL:()=>'/blob-pdf',revokeObjectURL(){}},setTimeout:()=>1,document:{getElementById:node,createElement:()=>node('download'),body:node('body')}};
vm.createContext(ctx);vm.runInContext(script,ctx);await flush();
assert.equal(node('export').disabled,true);assert(node('sheets').innerHTML.includes('Họ tên:'));assert(node('sheets').innerHTML.includes('Level:'));assert.equal(node('generate').disabled,false);
await click('generate');assert.equal((node('sheets').innerHTML.match(/data-exercise=/g)||[]).length,12);assert.equal(node('export').disabled,false);assert.equal(node('answers').disabled,false);
assert(!node('sheets').innerHTML.includes('>e4<'),'Student preview must not reveal solutions');
await input('title','Đề kiểm tra lớp Step 2');await input('level','Step 2');
await click('export');const exported=requests.find(r=>r.url.startsWith('/api/worksheets/pdf?')&&!r.url.includes('answers=true'));assert.equal(exported.body.title,'Đề kiểm tra lớp Step 2');assert.equal(exported.body.level,'Step 2');assert.equal(exported.body.exercises.length,12);assert.equal(lastDownload,'Đề kiểm tra lớp Step 2.pdf');
await click('answers');assert(requests.some(r=>r.url.includes('/api/worksheets/pdf?')&&r.url.includes('answers=true')));
await click('append-page');assert.equal((node('sheets').innerHTML.match(/class="sheet"/g)||[]).length,2);assert.equal((node('sheets').innerHTML.match(/data-exercise=/g)||[]).length,24);
for(const marker of ['class="student-fields"','class="sheet-details"','class="sheet-instructions"','data-sheet-title='])assert.equal(node('sheets').innerHTML.split(marker).length-1,1,'Student information/title/instructions must appear only on the first page');
assert.equal(node('sheets').innerHTML.split('class="sheet-brand"').length-1,2,'Header must repeat on subsequent pages');
assert(node('sheets').innerHTML.includes('data-continuation="true"'));
await click('save');assert.equal(saved.size,1);assert.equal([...saved.values()][0].exercises.length,24);
const stored=JSON.parse(storage.get('thc-worksheet-draft-v1'));assert.equal(stored.document.title,'Đề kiểm tra lớp Step 2');
await click('replace');assert.equal(requests.filter(r=>r.url.endsWith('/generate')).at(-1).body.selection.count,1);assert.equal(requests.filter(r=>r.url.endsWith('/generate')).at(-1).body.selection.exclude.length,24);
assert.equal(versions.length,3,'Creation, append and replacement should be archived automatically');
const before=node('sheets').innerHTML;failSelect=true;await click('replace');assert.equal(node('sheets').innerHTML,before);assert.equal(node('status').textContent,'Thiếu bài đúng độ khó');failSelect=false;
await click('remove');assert.equal(node('export').disabled,true);assert(node('count').textContent.includes('thiếu 1'));
await click('add-custom');assert.equal(node('editor').open,true);node('editor-solution').value='1. e4';await node('editor-form').onsubmit({preventDefault(){}});await flush();assert.equal(node('editor').open,false);assert.equal(node('export').disabled,false);
const custom=requests.find(r=>r.url.endsWith('/edit'));assert.equal(custom.body.exercise.source,'custom');assert.equal(custom.body.exercise.solution,'1. e4');assert.equal(custom.body.exercise.fen,fen);
await click('new');assert.equal(node('export').disabled,true);assert.equal(node('title').value,'BÀI TẬP CỜ VUA');
node('saved').value=[...saved.keys()][0];await node('saved').onchange();await flush();assert.equal(node('title').value,'Đề kiểm tra lớp Step 2');assert.equal(node('export').disabled,false);
node('difficulty').value='advanced';node('difficulty').onchange();assert.equal(node('min-rating').value,1800);assert.equal(node('max-rating').value,2600);
await input('min-rating','2000');node('min-rating').oninput();assert.equal(node('difficulty').value,'custom');
await click('save');await click('new');node('saved').value=[...saved.keys()][0];await node('saved').onchange();await flush();assert.equal(node('min-rating').value,2000);assert.equal(node('max-rating').value,2600,'Saved band must survive reopening before replacing a puzzle');
await click('edit');node('clear-board').onclick();assert.equal(node('editor-fen').value,'8/8/8/8/8/8/8/8 w - - 0 1');
const sq={dataset:{square:'60'}};node('editor-board').onclick({target:{closest:()=>sq}});assert(node('editor-fen').value.startsWith('8/8/8/8/8/8/8/4Q3'));
node('sheets').querySelectorAll=selector=>selector==='[data-sheet-title]'?[node('direct-title')]:[];
node('direct-title').dataset={sheetTitle:'0'};node('direct-title').textContent='Đề sửa trực tiếp';
for(const handler of node('sheets').events.input||[])await handler({target:node('direct-title')});
assert.equal(node('title').value,'Đề sửa trực tiếp');
await click('export');assert.equal(requests.filter(r=>r.url.includes('/pdf?')&&!r.url.includes('answers=true')).at(-1).body.title,'Đề sửa trực tiếp');
await click('view-answers');assert.equal(node('answers-dialog').open,true);assert(node('answers-list').innerHTML.includes('e4'));await click('answers-close');
await click('history-open');assert.equal(node('history-dialog').open,true);assert(node('history-list').innerHTML.includes('data-history-load="1"'));assert(node('history-list').innerHTML.includes('/history/1/pdf?answers=true'));
const historyButton={dataset:{historyLoad:'1'},disabled:false};await node('history-list').onclick({target:{closest:s=>s==='[data-history-load]'?historyButton:null}});
assert.equal(node('title').value,'BÀI TẬP CỜ VUA');assert.equal((node('sheets').innerHTML.match(/data-exercise=/g)||[]).length,12);assert.equal(node('history-dialog').open,false);
assert(html.includes('maxlength="120"'));assert(html.includes('PDF đáp án'));
// Layout settings are reflected in previews, exports, generation and archived snapshots.
node('show-prompts').checked=false;await input('show-prompts','');
assert(!node('sheets').innerHTML.includes('class="prompt"'));assert(node('sheets').innerHTML.includes('Trắng đi'));
await input('header-text','CLB CỜ VUA THỦ ĐỨC');await input('footer-text','Giáo viên Nguyễn An');
await input('page-number-format','Phiếu {page} trên {total}');
node('logo-input').files=[{size:1024,type:'image/png'}];await node('logo-input').onchange();await flush();
assert.equal(node('logo-preview').hidden,false);assert.equal(node('logo-preview').src,logo);
assert.equal(node('logo-input').value,'','Selecting the same file again must work');
await click('append-page');assert.equal((node('sheets').innerHTML.match(/class="sheet-logo"/g)||[]).length,1,'Only the first of two pages has a logo');
assert(node('sheets').innerHTML.includes('Phiếu 1 trên 2'));assert(node('sheets').innerHTML.includes('Phiếu 2 trên 2'));
assert.equal((node('sheets').innerHTML.match(/CLB CỜ VUA THỦ ĐỨC/g)||[]).length,2);
const archivedLayout=versions.at(-1);assert.equal(archivedLayout.document.logo,logo);assert.equal(archivedLayout.document.show_prompts,false);
await click('export');const layoutPdf=requests.filter(r=>r.url.includes('/pdf?')).at(-1).body;
assert.equal(layoutPdf.header_text,'CLB CỜ VUA THỦ ĐỨC');assert.equal(layoutPdf.footer_text,'Giáo viên Nguyễn An');assert.equal(layoutPdf.logo,logo);assert.equal(layoutPdf.show_prompts,false);
// Direct edits preserve the caret and mirror text on every page.
node('sheets').querySelectorAll=selector=>selector==='[data-sheet-field="header_text"]'?[node('direct-header'),node('other-header')]:selector==='[data-sheet-field="footer_text"]'?[node('direct-footer'),node('other-footer')]:[];
for(const key of ['header','footer']){const target=node('direct-'+key);target.dataset={sheetField:key+'_text'};target.textContent='Sửa trực tiếp '+key;for(const handler of node('sheets').events.input)await handler({target});assert.equal(node(key+'-text').value,target.textContent);assert.equal(node('other-'+key).textContent,target.textContent);}
await input('header-text','<img src=x onerror=alert(1)>');assert(node('sheets').innerHTML.includes('&lt;img'));assert(!node('sheets').innerHTML.includes('<img src=x'));
failLogo=true;await node('logo-input').onchange();await flush();assert.equal(node('logo-preview').src,logo);assert.equal(node('logo-state').textContent,'Ảnh không hợp lệ');failLogo=false;
const uploads=requests.filter(r=>r.url.endsWith('/logo')).length;
node('logo-input').files=[{size:6*1024*1024,type:'image/png'}];await node('logo-input').onchange();assert.equal(requests.filter(r=>r.url.endsWith('/logo')).length,uploads,'Large files must be rejected before upload');
await click('logo-remove');assert.equal(node('logo-preview').hidden,true);assert(!node('sheets').innerHTML.includes('class="sheet-logo"'));
node('show-page-numbers').checked=false;await input('show-page-numbers','');assert(!node('sheets').innerHTML.includes('Phiếu 1 trên 2'));
await input('header-text','');await input('footer-text','');assert(!node('sheets').innerHTML.includes('Sửa trực tiếp footer'));
await click('reset-branding');assert.equal(node('page-number-format').value,'Trang {page} / {total}');assert(node('header-text').value.includes('TĨNH HUYỀN QUÁN'));
// Opening a snapshot restores its logo and all settings, independently of the current draft.
const layoutButton={dataset:{historyLoad:String(archivedLayout.id)},disabled:false};await node('history-list').onclick({target:{closest:s=>s==='[data-history-load]'?layoutButton:null}});
assert.equal(node('logo-preview').src,logo);assert.equal(node('logo-preview').hidden,false);assert.equal(node('show-prompts').checked,false);assert.equal(node('footer-text').value,'Giáo viên Nguyễn An');assert.equal(node('page-number-format').value,'Phiếu {page} trên {total}');
ctx.crypto={getRandomValues:bytes=>{bytes.fill(7);return bytes}};
assert.match(vm.runInContext('uuid()',ctx),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,'UUID fallback should work over LAN HTTP');
const putsBefore=requests.filter(r=>r.method==='PUT').length;
vm.runInNewContext(script,{...ctx});await flush();
assert.equal(requests.filter(r=>r.method==='PUT').length,putsBefore+1,'An existing local draft must be archived automatically after upgrade/reload');
assert.equal(node('save-state').textContent,'Bản nháp đã đưa vào lịch sử');
assert.equal(node('logo-preview').src,logo);assert.equal(node('show-prompts').checked,false);
console.log('PASS: worksheet history, generation, editor, direct title/header/footer editing, prompt/page toggles, first-page logo upload/remove/error handling and snapshot/reload preservation');
})().catch(e=>{console.error(e);process.exitCode=1});
