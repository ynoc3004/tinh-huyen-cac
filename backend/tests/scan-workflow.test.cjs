const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element {
 constructor(){this.value='';this.textContent='';this.children=[];this.hidden=false;this.disabled=false;this.dataset={};this.attributes={};const classes=new Set();this.classList={toggle:(name,on)=>{on??=!classes.has(name);on?classes.add(name):classes.delete(name);return on;},contains:name=>classes.has(name)};this.style={setProperty(){}};}
 setAttribute(k,v){this.attributes[k]=v;} getAttribute(k){return this.attributes[k];}
 replaceChildren(...items){this.children=items;if(items.length&&'value' in items[0])this.value=items[0].value;}
 focus(){} scrollIntoView(){} append(...items){this.children.push(...items);} remove(){} click(){return this.onclick?.();}
}

const root=path.join(__dirname,'../static');
const flush=async()=>{for(let i=0;i<25;i++)await new Promise(r=>setImmediate(r));};
async function client({search='?id=1',locked=false,cached=false}={}){
 const html=fs.readFileSync(path.join(root,'scan.html'),'utf8'),els={};
 for(const [,id] of html.matchAll(/id="([^"]+)"/g))els[id]=new Element();
 Element.prototype.removeAttribute=function(k){delete this.attributes[k];delete this[k];};
 const document={body:new Element(),getElementById:id=>{assert(els[id],`Missing HTML control ${id}`);return els[id];},createElement:()=>new Element(),createElementNS:()=>new Element(),querySelector:()=>new Element(),querySelectorAll:s=>s==='.scan-card'?els['scan-results'].children:[]};
 const {Chess}=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(root,'vendor/chess.js')).toString('base64'));
 const board={placement:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',turn:'w',orientation:'white',image:'data:image/png;base64,example'};
 let resolveScan;const wait=new Promise(r=>resolveScan=r),calls=[],intervals=[];let isLocked=locked,state={page:2,bookmark:1,note:'Ghi chú cũ',model:'deepl:en-vi',translation_mode:'automatic'};
 const fetch=async(url,options={})=>{
 calls.push({url,options});if(isLocked)return {ok:false,status:401,json:async()=>({detail:'Locked'})};
 let data={};
 if(url==='/api/library?kind=book')data=[{id:1,ext:'.pdf',title:'Book'}];
 else if(url.endsWith('/state')){if(options.method==='PUT')state=JSON.parse(options.body);data=state;}
 else if(url.endsWith('/study/info'))data={pages:3,title:'Book'};
 else if(url.endsWith('/scan-models'))data={models:['local:chessvision','gemini-selected'],default:'local:chessvision'};
 else if(url.endsWith('/scan-local'))data={ready:true,message:'Local sẵn sàng'};
 else if(url.endsWith('/scan-probe'))data={message:'Kiểm tra thành công'};
 else if(url.includes('/study/boards')){if(options.method==='POST'){await wait;data={boards:[board,board],engine:'local'};}else data={boards:cached?[board]:null,cached:true,available:true,engine:'local'};}
 else if(url.includes('/import?'))data={ok:true};
 else if(!url.startsWith('/api/library/item/'))throw Error('Unexpected request '+url);
 return {ok:true,status:200,json:async()=>data};
 };
 const storage=new Map(),location={search},context={Chess,PIECE_DEFS:'',document,fetch,location,URLSearchParams,URL,Option:class extends Element{constructor(t,v){super();this.textContent=t;this.value=v;}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setInterval:fn=>intervals.push(fn),setTimeout,Date,console};
 context.window=context;context.addEventListener=()=>{};
 vm.runInNewContext(fs.readFileSync(path.join(root,'scan.js'),'utf8').replace(/^import .*;\n/gm,''),context,{filename:'scan.js'});await flush();
 return {els,calls,location,intervals,resolveScan,lock:()=>isLocked=true,state:()=>state};
}
(async()=>{
 const c=await client(),e=c.els;
 assert.equal(e.pdf.src,'/api/library/translation/1/study/page-image?page=2');assert.equal(e.note.value,'Ghi chú cũ');assert.equal(e['scan-page'].disabled,false);assert.equal(e['board-stage'].hidden,true);
 assert.equal(e['scan-download'].href,e.pdf.src);assert.equal(e['scan-download'].download,'sach-1-trang-2.png');
 assert(!c.calls.some(x=>/\/(models|translate|cached|batch|page)(?:[?/]|$)/.test(x.url.replace('/study/page-image','/image'))),'Scanner must not invoke translator, OCR or batch APIs');
 e['scan-model'].value='gemini-selected';await e['scan-model'].onchange();
 const scanning=e['scan-page'].onclick();await flush();assert(e.next.disabled);assert(e.books.disabled);assert(e.upload.disabled);assert.equal(e['scan-section'].getAttribute('aria-busy'),'true');
 await e.next.onclick();assert.equal(e.page.value,2,'Navigation waits for scan');
 c.resolveScan();await scanning;assert.equal(e['scan-results'].children.length,2);assert(!e.next.disabled);
 const request=c.calls.find(x=>x.options.method==='POST'&&x.url.endsWith('/study/boards'));assert.equal(JSON.parse(request.options.body).model,'gemini-selected');
 e['scan-results'].children[1].onclick();assert(!e['board-stage'].hidden);assert(e['board-empty'].hidden);
 e.board.children.find(x=>x.title==='e2').click();e.board.children.find(x=>x.title==='e4').click();assert(e.moves.textContent.includes('e4'));e['restore-position'].click();assert.equal(e.moves.textContent,'');
 e['scan-edit'].click();e['scan-piece'].value='';e.board.children.find(x=>x.title==='a2').click();assert(e.position.value.includes('1PPPPPPP'));e['scan-piece'].value='wP';e.board.children.find(x=>x.title==='a2').click();e['scan-play'].click();assert(e['scan-status'].textContent.includes('hiệu đính'));
 e.note.value='Ghi chú mới';await e['save-note'].click();assert.equal(c.state().note,'Ghi chú mới');assert.equal(c.state().model,'deepl:en-vi');assert.equal(c.state().translation_mode,'automatic','Preserve old reader preferences');
 await e.bookmark.click();assert.equal(c.state().bookmark,2);await e.next.click();assert.equal(e.page.value,3);assert(e.next.disabled);await e.return.click();assert.equal(e.page.value,2);
 e.page.value='99';await e.page.onchange();assert.equal(e.page.value,2);
 e['scan-model'].value='local:chessvision';await e['scan-model'].onchange();assert(e['board-stage'].hidden);assert(e['scan-privacy'].textContent.includes('không gửi'));await e['scan-probe'].click();assert(e['scan-probe-status'].textContent.includes('thành công'));
 e.position.value='1. e4 e5 2. Nf3';e['load-position'].click();assert(e.moves.textContent.includes('Nf3'));e.position.value='invalid';e['load-position'].click();assert(e['board-status'].textContent.includes('không hợp lệ'));
 const saved=await client({cached:true});assert.equal(saved.els['scan-results'].children.length,1);assert(!saved.calls.some(x=>x.url.endsWith('/study/boards')&&x.options.method==='POST'),'Opening saved scans must not rescan');
 const race=saved.els['scan-page'].click();await flush();saved.lock();await saved.intervals[0]();saved.resolveScan();await race;assert.equal(saved.els['scan-results'].children.length,0,'Late scan response cannot reopen locked data');assert.equal(saved.els.pdf.src,undefined);assert.equal(saved.els.note.value,'');assert(saved.els['scan-page'].disabled);
 const empty=await client({search:''});assert(!empty.els.books.disabled);assert(!empty.els.upload.disabled);assert(empty.els['scan-page'].disabled);assert(!empty.calls.some(x=>x.url.endsWith('/study/info')));
 const locked=await client({locked:true});assert(locked.els.status.textContent.includes('khóa'));assert(locked.els['scan-page'].disabled);
 // Exercise compatibility routes using their actual inline scripts.
 for(const [file,search,target] of [['books.html','','/study.html'],['books.html','?id=1','/study.html'],['translate.html','?id=1','/scan.html'],['study.html','?id=1','/scan.html']]){
  let redirected='';const text=fs.readFileSync(path.join(root,file),'utf8'),script=[...text.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInNewContext(script,{URL,URLSearchParams,location:{origin:'https://local.example',search,hash:'',replace:v=>redirected=v},document:{getElementById:()=>({})}});
  assert.equal(new URL(redirected).pathname,target);assert.equal(new URL(redirected).search,search);
 }
 console.log('PASS: scanner independent of translation, cached scans, moves/corrections, notes/bookmarks, navigation locks/bounds, PDF selection, vault lock race and legacy URLs');
})().catch(error=>{console.error(error);process.exitCode=1});
