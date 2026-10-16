const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element {
 constructor(){this.value='';this.textContent='';this.children=[];this.hidden=false;this.disabled=false;this.dataset={};this.attributes={};const classes=new Set();this.classList={toggle:(k,on)=>{on??=!classes.has(k);on?classes.add(k):classes.delete(k);return on;},contains:k=>classes.has(k)};this.style={setProperty(){}};}
 setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}removeAttribute(k){delete this.attributes[k];}
 replaceChildren(...items){this.children=items;if(items.length&&'value' in items[0])this.value=items[0].value;}
 focus(){}select(){this.selected=true;}scrollIntoView(){}append(...items){this.children.push(...items);}click(){return this.onclick?.();}
}
async function boot({clipboardDenied=false,saved=new Map(),initialState={page:1}}={}){
 const root=path.join(__dirname,'../static'),html=fs.readFileSync(path.join(root,'study.html'),'utf8'),els={};
 const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size,'Unique HTML IDs');for(const id of ids)els[id]=new Element();
 const body=new Element(),document={body,documentElement:new Element(),getElementById:id=>{assert.ok(els[id],id);return els[id];},createElement:()=>new Element(),createElementNS:()=>new Element(),querySelectorAll:()=>[]};
 const {Chess}=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(root,'vendor/chess.js')).toString('base64'));
 const source=new Map([[1,'White plays Nf3 and O-O.'],[2,'Black plays d5.']]),calls=[],clipboard=[],intervals=[];
 let state=initialState,failImport=false,confirmAnswer=true,locked=false,delayPrompt=null;
 const ok=data=>({ok:true,status:200,json:async()=>data}),error=(status,detail)=>({ok:false,status,json:async()=>({detail})});
 const fetch=async(url,options={})=>{
  const data=options.body?JSON.parse(options.body):undefined;calls.push({url,data,method:options.method});
  if(url.startsWith('/api/library/item/'))return locked?error(401,'Locked'):ok({});
  if(url==='/api/library?kind=book')return ok([{id:1,ext:'.pdf',title:'Chess book'}]);
  if(url.endsWith('/state')){if(options.method==='PUT')state=data;return ok(state);}
  if(url.endsWith('/models'))return error(503,'Ollama is offline');
  if(url.endsWith('/batch'))return ok({phase:'idle'});
  if(url.includes('/batch/page?'))return ok({translation:null});
  if(url.includes('/page?page=')){const page=Number(new URL(url,'http://local').searchParams.get('page'));return ok({page,pages:2,text:source.get(page),title:'Chess book'});}
  if(url.endsWith('/study/source')){source.set(data.page,data.text);return ok({ok:true});}
  if(url.includes('/study/boards'))return ok({boards:null,available:true});
  if(url.endsWith('/scan-local'))return ok({ready:true,installed:true});
  if(url.endsWith('/scan-models'))return ok({models:['local:chessvision'],default:'local:chessvision'});
  if(url.endsWith('/web/prompt')){if(delayPrompt)await delayPrompt;return ok({...data,prompt:'Dịch sách cờ vua tự nhiên. Giữ nguyên SAN.\n\n'+data.text});}
  if(url.endsWith('/web/import')){if(failImport)return error(422,'Bản dịch làm thay đổi ký hiệu nước đi.');saved.set(data.page,data);return ok(data);}
  if(url.includes('/web?page='))return ok(saved.get(Number(new URL(url,'http://local').searchParams.get('page')))||{translation:null});
  if(url.endsWith('/cached'))return ok({translation:null});
  throw Error('Unexpected request: '+url);
 };
 const context={Chess,PIECE_DEFS:'',document,fetch,location:{search:'?id=1'},URLSearchParams,URL,Option:class extends Element{constructor(text,value){super();this.textContent=text;this.value=value;}},navigator:{clipboard:{writeText:async text=>{if(clipboardDenied)throw Error('Denied');clipboard.push(text);}}},localStorage:{getItem(){},setItem(){}},setInterval:(callback,ms)=>intervals.push({callback,ms}),setTimeout,Date,console,confirm:()=>confirmAnswer};
 context.window=context;context.addEventListener=()=>{};
 vm.runInNewContext(fs.readFileSync(path.join(root,'study.js'),'utf8').replace(/^import .*;\n/gm,''),context,{filename:'study.js'});
 for(let i=0;i<25;i++)await new Promise(r=>setImmediate(r));
 return {els,calls,clipboard,source,saved,intervals,get state(){return state;},set failImport(value){failImport=value;},set confirmAnswer(value){confirmAnswer=value;},set locked(value){locked=value;},set delayPrompt(value){delayPrompt=value;},html};
}
async function run(){
 const app=await boot(),{els,calls}=app;
 assert.equal(els['automatic-tools'].hidden,true);assert.equal(els['web-translation'].hidden,false);assert.equal(els['web-prepare'].disabled,false);assert.equal(els['web-save'].disabled,true);
 assert.equal(calls.filter(c=>c.url.endsWith('/models')).length,0,'Web workflow does not wait for Ollama or API providers');
 assert.ok(app.html.includes('href="https://claude.ai/new" target="_blank" rel="noopener noreferrer"'));
 assert.ok(app.html.includes('href="https://gemini.google.com/app" target="_blank" rel="noopener noreferrer"'));
 let release;app.delayPrompt=new Promise(r=>release=r);const preparing=els['web-prepare'].onclick();await new Promise(r=>setImmediate(r));
 assert.equal(els.next.disabled,true,'Capture cannot race a page turn');assert.equal(els['web-prepare'].disabled,true);release();await preparing;app.delayPrompt=null;
 assert.ok(app.clipboard[0].includes('White plays Nf3 and O-O.'));
 await els['web-prepare'].onclick();assert.equal(calls.filter(c=>c.url.endsWith('/web/prompt')).length,1,'Copy again keeps the original page snapshot');
 await els.next.onclick();assert.ok(els['web-page-label'].textContent.includes('trang 1'));assert.ok(els['web-page-label'].textContent.includes('trang 2'));
 els['web-result'].value='Trắng đi Nf3 và O-O.';els['web-result'].oninput();assert.equal(els['web-save'].disabled,false);
 app.failImport=true;await els['web-save'].onclick();assert.equal(els['web-result'].value,'Trắng đi Nf3 và O-O.');assert.ok(els['web-status'].textContent.includes('ký hiệu nước đi'));assert.equal(els['web-save'].disabled,false);
 app.confirmAnswer=false;const before=calls.length;await els['web-reset'].onclick();assert.equal(calls.length,before);assert.equal(els['web-result'].value,'Trắng đi Nf3 và O-O.');
 app.confirmAnswer=true;app.failImport=false;els['web-open-gemini'].onclick();assert.equal(els['web-provider'].value,'gemini');await els['web-save'].onclick();
 const imported=calls.filter(c=>c.url.endsWith('/web/import')).at(-1).data;
 assert.equal(imported.page,1);assert.equal(imported.text,'White plays Nf3 and O-O.');assert.equal(imported.provider,'gemini');assert.equal(els['web-result'].value,'');assert.ok(els['web-status'].textContent.includes('trang 1'));
 assert.notEqual(els.result.textContent,imported.translation,'Saving a draft for another page must not replace the current page display');
 await els.prev.onclick();assert.equal(els.result.textContent,imported.translation);assert.equal(els['web-translation'].open,false);
 assert.equal(app.state.translation_mode,'web');
 const reopened=await boot({saved:app.saved,initialState:app.state});assert.equal(reopened.els.result.textContent,imported.translation);assert.equal(reopened.calls.filter(c=>c.url.endsWith('/models')).length,0);
 els.source.value='White plays Nf3 and O-O. Changed commentary.';els.source.oninput();
 await els['automatic-mode'].onclick();assert.equal(els['automatic-tools'].hidden,false);
 await els['web-mode'].onclick();assert.ok(els['web-status'].textContent.includes('đã đổi'));assert.notEqual(els.result.textContent,imported.translation,'Old source translation is retained but not displayed against changed source');
 await els['web-prepare'].onclick();els['web-result'].value='Unsaved words';els['web-result'].oninput();app.locked=true;
 await app.intervals.find(x=>x.ms===30000).callback();
 assert.equal(els['web-prompt'].value,'');assert.equal(els['web-result'].value,'');assert.equal(els['web-save'].disabled,true);
 assert.ok(calls.every(c=>c.url.startsWith('/api/')),'The app never submits text to a chat service');
 const denied=await boot({clipboardDenied:true});await denied.els['web-prepare'].onclick();
 assert.equal(denied.els['web-prompt-details'].open,true);assert.equal(denied.els['web-prompt'].selected,true);assert.ok(denied.els['web-status'].textContent.includes('Ctrl+C'));
 console.log('PASS: free web chat without Ollama, clipboard fallback, captured-page import, failed-save recovery, mode/cache restoration, changed-source protection and vault cleanup');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
