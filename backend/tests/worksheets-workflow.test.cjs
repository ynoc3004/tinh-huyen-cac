const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../static/worksheets.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../static/worksheets.js'),'utf8').replace(/^import .*;\s*$/gm,'');
const nodes=new Map(),requests=[],storage=new Map(),saved=new Map();let serial=0,lastDownload=null;
function node(id){if(!nodes.has(id))nodes.set(id,{id,value:'',checked:false,disabled:false,hidden:false,textContent:'',innerHTML:'',dataset:{},events:{},classList:{toggle(){}},addEventListener(k,f){(this.events[k]??=[]).push(f)},querySelectorAll(){return[]},showModal(){this.open=true},close(){this.open=false},append(){},click(){lastDownload=this.download},remove(){}});return nodes.get(id)}
for(const m of html.matchAll(/id="([^"]+)"/g))node(m[1]);
node('pages').value='1';node('min-rating').value='400';node('max-rating').value='899';
const fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ex=id=>({id,fen,instruction:'Tìm nước đi tốt nhất.',solution:'e4',rating:800,source:'lichess',turn:'w',themes:[]});
let gen=0,failSelect=false;
const fetch=async(url,opt)=>{const body=opt?.body?JSON.parse(opt.body):undefined;requests.push({url,body,method:opt?.method});let data;
if(url==='/api/worksheets/options')data={levels:[{id:'beginner',name:'Mới bắt đầu',min:400,max:899},{id:'advanced',name:'Nâng cao',min:1800,max:2600}],themes:{'':'Mọi chủ đề',mateIn1:'Chiếu hết trong 1 nước'},bank:{name:'Kho đi kèm',count:192}};
else if(url==='/api/worksheets/select'){if(failSelect)return{ok:false,json:async()=>({detail:'Thiếu bài đúng độ khó'})};gen++;data={exercises:Array.from({length:body.count},(_,i)=>ex('G'+gen+'-'+i))};}
else if(url==='/api/worksheets/validate')data={exercise:{...body,turn:body.fen.split(' ')[1],solution:'e4'},svg:'<svg></svg>'};
else if(url.startsWith('/api/worksheets/pdf'))return{ok:true,blob:async()=>({type:'application/pdf'})};
else if(url==='/api/worksheets')data=[...saved].map(([id,document])=>({id,title:document.title,count:document.exercises.length}));
else{const id=url.split('/').at(-1);if(opt.method==='PUT'){saved.set(id,structuredClone(body));data={id,document:body}}else data={id,document:structuredClone(saved.get(id))};}
return{ok:true,json:async()=>data};};
async function flush(){for(let i=0;i<40;i++)await Promise.resolve()}
async function click(id){await node(id).onclick?.({target:node(id)});await flush()}
async function input(id,value){node(id).value=value;for(const f of node(id).events.input||[])await f({target:node(id)});await flush()}
(async()=>{
const chess=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../static/vendor/chess.js')).toString('base64'));
const ctx={Chess:chess.Chess,PIECE_DEFS:'',console,fetch,confirm:()=>true,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},URL:{createObjectURL:()=>'/blob-pdf',revokeObjectURL(){}},setTimeout:()=>1,document:{getElementById:node,createElement:()=>node('download'),body:node('body')}};
vm.createContext(ctx);vm.runInContext(script,ctx);await flush();
assert.equal(node('export').disabled,true);assert(node('sheets').innerHTML.includes('Họ tên:'));assert(node('sheets').innerHTML.includes('Level:'));assert.equal(node('generate').disabled,false);
await click('generate');assert.equal((node('sheets').innerHTML.match(/data-exercise=/g)||[]).length,12);assert.equal(node('export').disabled,false);assert.equal(node('answers').disabled,false);
assert(!node('sheets').innerHTML.includes('>e4<'),'Student preview must not reveal solutions');
await input('title','Đề kiểm tra lớp Step 2');await input('level','Step 2');
await click('export');const exported=requests.find(r=>r.url==='/api/worksheets/pdf');assert.equal(exported.body.title,'Đề kiểm tra lớp Step 2');assert.equal(exported.body.level,'Step 2');assert.equal(exported.body.exercises.length,12);assert.equal(lastDownload,'Đề kiểm tra lớp Step 2.pdf');
await click('answers');assert(requests.some(r=>r.url==='/api/worksheets/pdf?answers=true'));
await click('append-page');assert.equal((node('sheets').innerHTML.match(/class="sheet"/g)||[]).length,2);assert.equal((node('sheets').innerHTML.match(/data-exercise=/g)||[]).length,24);
await click('save');assert.equal(saved.size,1);assert.equal([...saved.values()][0].exercises.length,24);
const stored=JSON.parse(storage.get('thc-worksheet-draft-v1'));assert.equal(stored.document.title,'Đề kiểm tra lớp Step 2');
await click('replace');assert.equal(requests.filter(r=>r.url.endsWith('/select')).at(-1).body.count,1);assert.equal(requests.filter(r=>r.url.endsWith('/select')).at(-1).body.exclude.length,24);
const before=node('sheets').innerHTML;failSelect=true;await click('replace');assert.equal(node('sheets').innerHTML,before);assert.equal(node('status').textContent,'Thiếu bài đúng độ khó');failSelect=false;
await click('remove');assert.equal(node('export').disabled,true);assert(node('count').textContent.includes('thiếu 1'));
await click('add-custom');assert.equal(node('editor').open,true);node('editor-solution').value='1. e4';await node('editor-form').onsubmit({preventDefault(){}});await flush();assert.equal(node('editor').open,false);assert.equal(node('export').disabled,false);
const custom=requests.find(r=>r.url.endsWith('/validate'));assert.equal(custom.body.source,'custom');assert.equal(custom.body.solution,'1. e4');assert.equal(custom.body.fen,fen);
await click('new');assert.equal(node('export').disabled,true);assert.equal(node('title').value,'BÀI TẬP CỜ VUA');
node('saved').value=[...saved.keys()][0];await node('saved').onchange();await flush();assert.equal(node('title').value,'Đề kiểm tra lớp Step 2');assert.equal(node('export').disabled,false);
node('difficulty').value='advanced';node('difficulty').onchange();assert.equal(node('min-rating').value,1800);assert.equal(node('max-rating').value,2600);
await input('min-rating','2000');node('min-rating').oninput();assert.equal(node('difficulty').value,'custom');
await click('save');await click('new');node('saved').value=[...saved.keys()][0];await node('saved').onchange();await flush();assert.equal(node('min-rating').value,2000);assert.equal(node('max-rating').value,2600,'Saved band must survive reopening before replacing a puzzle');
await click('edit');node('clear-board').onclick();assert.equal(node('editor-fen').value,'8/8/8/8/8/8/8/8 w - - 0 1');
const sq={dataset:{square:'60'}};node('editor-board').onclick({target:{closest:()=>sq}});assert(node('editor-fen').value.startsWith('8/8/8/8/8/8/8/4Q3'));
assert(html.includes('maxlength="120"'));assert(html.includes('PDF đáp án'));
ctx.crypto={getRandomValues:bytes=>{bytes.fill(7);return bytes}};
assert.match(vm.runInContext('uuid()',ctx),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,'UUID fallback should work over LAN HTTP');
console.log('PASS: generate 12/24, exact counts, current-title PDF, separate answers, no answer leak, strict shortage preservation, save/reopen, local draft, custom editor, difficulty bands');
})().catch(e=>{console.error(e);process.exitCode=1});
