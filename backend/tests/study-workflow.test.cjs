const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element {
 constructor(){this.value='';this.textContent='';this.children=[];this.hidden=false;this.disabled=false;this.dataset={};this.attributes={};const classes=new Set();this.classList={toggle:(name,on)=>{on??=!classes.has(name);on?classes.add(name):classes.delete(name);return on;},contains:name=>classes.has(name)};this.style={setProperty(){}};}
 setAttribute(k,v){this.attributes[k]=v;} getAttribute(k){return this.attributes[k];}
 replaceChildren(...items){this.children=items;if(items.length&&'value' in items[0])this.value=items[0].value;}
 append(...items){this.children.push(...items);} remove(){} click(){return this.onclick?.();}
}
(async()=>{
 const root=path.join(__dirname,'../static');
 const html=fs.readFileSync(path.join(root,'study.html'),'utf8'),elements={};
 for(const [,id] of html.matchAll(/id="([^"]+)"/g))elements[id]=new Element();
 const body=new Element(),docRoot=new Element();
 const document={body,documentElement:docRoot,getElementById:id=>{assert.ok(elements[id],`Missing HTML control: ${id}`);return elements[id]},createElement:()=>new Element(),createElementNS:()=>new Element(),querySelectorAll:selector=>selector==='.scan-card'?elements['scan-results'].children:[]};
 const {Chess}=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(root,'vendor/chess.js')).toString('base64'));
 let scanResolve,translateResolve;const scanWait=new Promise(r=>scanResolve=r),translateWait=new Promise(r=>translateResolve=r),calls=[];
 const board={placement:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',turn:'w',orientation:'white',image:'data:image/png;base64,example'};
 const fetch=async(url,options={})=>{
 calls.push({url,options});let data={};
 if(url==='/api/library?kind=book')data=[{id:1,ext:'.pdf',title:'Book'}];
 else if(url.endsWith('/state'))data={page:1,model:'deepl:en-vi'};
 else if(url.endsWith('/models'))data={models:['deepl:en-vi','gemini:configured']};
 else if(url.endsWith('/scan-models'))data={models:['gemini-configured','gemini-selected'],default:'gemini-configured',available:true};
 else if(url.includes('/page?page=')&&!url.includes('/batch/'))data={page:1,pages:10,text:'White plays Nf3.',title:'Book'};
 else if(url.includes('/study/boards')){if(options.method==='POST'){await scanWait;data={boards:[board,board]};}else data={boards:null,available:true};}
 else if(url.endsWith('/translate')){await translateWait;data={translation:'Trắng đi Nf3.'};}
 return {ok:true,status:200,json:async()=>data};
 };
 const store=new Map(),context={Chess,PIECE_DEFS:'',document,fetch,location:{search:'?id=1'},URLSearchParams,Option:class extends Element{constructor(text,value){super();this.textContent=text;this.value=value;}},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},setInterval(){},setTimeout,Date,console};
 const code=fs.readFileSync(path.join(root,'study.js'),'utf8').replace(/^import .*;\n/gm,'');vm.runInNewContext(code,context,{filename:'study.js'});
 for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));
 assert.equal(elements.model.value,'deepl:en-vi');assert.equal(elements['scan-model'].value,'gemini-configured');
 elements['scan-model'].value='gemini-selected';elements['scan-model'].onchange();
 const scan=elements['scan-page'].onclick();await new Promise(r=>setImmediate(r));
 assert.equal(calls.filter(c=>c.url.endsWith('/translate')).length,0,'Scan must not invoke translation');
 assert.equal(elements.translate.disabled,false);assert.equal(elements.model.disabled,false);assert.equal(elements['scan-section'].getAttribute('aria-busy'),'true');
 assert.equal(JSON.parse(calls.find(c=>c.url.endsWith('/study/boards')&&c.options.method==='POST').options.body).model,'gemini-selected');
 const translation=elements.translate.onclick();await new Promise(r=>setImmediate(r));
 assert.equal(elements['reading-pane'].getAttribute('aria-busy'),'true');scanResolve();await scan;
 assert.equal(elements.translate.textContent,'Đang dịch…');assert.equal(elements['scan-page'].disabled,false,'Completing scan must not reset translation state');
 translateResolve();await translation;assert.equal(elements.result.textContent,'Trắng đi Nf3.');assert.equal(elements.model.value,'deepl:en-vi');
 elements['scan-results'].children[1].onclick();assert.equal(elements['scan-selected'].textContent,'Thế 2 · trang 1');assert.equal(elements['scan-editor'].open,false);
 elements['scan-edit'].onclick();elements['scan-piece'].value='';elements.board.children.find(x=>x.title==='a2').onclick();assert.ok(elements.position.value.includes('1PPPPPPP'));
 elements['scan-piece'].value='wP';elements.board.children.find(x=>x.title==='a2').onclick();elements['scan-play'].onclick();assert.ok(elements['scan-status'].textContent.includes('hiệu đính'));
 assert.equal(calls.filter(c=>c.url.endsWith('/translate')).length,1);
 console.log('PASS: separate scan/translation models and requests, concurrent task states, selected diagram and piece correction');
})().catch(e=>{console.error(e);process.exitCode=1});
