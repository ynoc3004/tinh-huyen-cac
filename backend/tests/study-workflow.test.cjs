const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element {
 constructor(){this.value='';this.textContent='';this.children=[];this.hidden=false;this.disabled=false;this.dataset={};this.attributes={};const classes=new Set();this.classList={toggle:(name,on)=>{on??=!classes.has(name);on?classes.add(name):classes.delete(name);return on;},contains:name=>classes.has(name)};this.style={setProperty(){}};}
 setAttribute(k,v){this.attributes[k]=v;} getAttribute(k){return this.attributes[k];}
 replaceChildren(...items){this.children=items;if(items.length&&'value' in items[0])this.value=items[0].value;}
 focus(){} scrollIntoView(){} append(...items){this.children.push(...items);} remove(){} click(){return this.onclick?.();}
}
(async()=>{
 const root=path.join(__dirname,'../static');
 const html=fs.readFileSync(path.join(root,'study.html'),'utf8'),elements={};
 for(const [,id] of html.matchAll(/id="([^"]+)"/g))elements[id]=new Element();
 const body=new Element(),docRoot=new Element();
 const document={body,documentElement:docRoot,getElementById:id=>{assert.ok(elements[id],`Missing HTML control: ${id}`);return elements[id]},createElement:()=>new Element(),createElementNS:()=>new Element(),querySelector:()=>new Element(),querySelectorAll:selector=>selector==='.scan-card'?elements['scan-results'].children:[]};
 const {Chess}=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(root,'vendor/chess.js')).toString('base64'));
 let scanResolve,translateResolve,batchResolve,batchJob={},batchSteps=0;const batchWait=new Promise(r=>batchResolve=r);const scanWait=new Promise(r=>scanResolve=r),translateWait=new Promise(r=>translateResolve=r),calls=[];
 const board={placement:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',turn:'w',orientation:'white',image:'data:image/png;base64,example'};
 const fetch=async(url,options={})=>{
 calls.push({url,options});let data={};
 if(url==='/api/library?kind=book')data=[{id:1,ext:'.pdf',title:'Book'}];
 else if(url.endsWith('/state'))data={page:1,model:'deepl:en-vi'};
 else if(url.endsWith('/models'))data={models:['deepl:en-vi','gemini:configured']};
 else if(url.endsWith('/scan-probe'))data={ok:true,message:"Model nhận ảnh nhỏ thành công."};
 else if(url.endsWith('/batch/start')){const settings=JSON.parse(options.body);batchJob={...settings,done:batchJob.done||0,chunk:0,chunks:0,phase:"ready"};data=batchJob;}
 else if(url.endsWith('/batch/step')){batchSteps++;if(batchSteps===1)await batchWait;batchJob={...batchJob,done:batchSteps,phase:batchSteps===2?"completed":"ready"};data=batchJob;}
 else if(url.endsWith('/batch'))data=batchJob;
 else if(url.endsWith('/scan-local'))data={installed:true,ready:true,message:'Local miễn phí · sẵn sàng'};
 else if(url.endsWith('/scan-models'))data={models:['local:chessvision','gemini-configured','gemini-selected'],default:'local:chessvision',available:true};
 else if(url.includes('/page?page=')&&!url.includes('/batch/'))data={page:1,pages:10,text:'White plays Nf3.',title:'Book'};
 else if(url.includes('/study/boards')){if(options.method==='POST'){await scanWait;data={boards:[board,board]};}else data={boards:null,available:true};}
 else if(url.endsWith('/translate')){await translateWait;data={translation:'Trắng đi Nf3.'};}
 return {ok:true,status:200,json:async()=>data};
 };
 const store=new Map(),context={Chess,PIECE_DEFS:'',document,fetch,location:{search:'?id=1'},URLSearchParams,Option:class extends Element{constructor(text,value){super();this.textContent=text;this.value=value;}},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},setInterval(){},setTimeout,Date,console};
 const code=fs.readFileSync(path.join(root,'study.js'),'utf8').replace(/^import .*;\n/gm,'');vm.runInNewContext(code,context,{filename:'study.js'});
 for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));
 assert.equal(elements.pdf.src,"/api/library/translation/1/study/page-image?page=1");
 assert.equal(elements.model.value,'deepl:en-vi');assert.equal(elements['scan-model'].value,'local:chessvision');
 assert.equal(elements['scan-download'].href,elements.pdf.src);assert.equal(elements['scan-download'].download,'sach-1-trang-1.png');
 elements['scan-model'].value='gemini-selected';await elements['scan-model'].onchange();
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
 await elements['scan-probe'].onclick();assert.ok(elements['scan-probe-status'].textContent.includes('thành công'));
 assert.equal(JSON.parse(calls.find(c=>c.url.endsWith('/scan-probe')).options.body).model,'gemini-selected');
 elements['batch-start'].value='1';elements['batch-end'].value='2';elements['batch-size'].value='1500';
 const batch=elements['batch-run'].onclick();for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));
 assert.equal(elements.model.disabled,true);assert.equal(elements['scan-page'].disabled,false);assert.equal(elements.prev.disabled,true);assert.equal(elements.next.disabled,false,'Reading navigation stays available during batch translation');
 elements['batch-pause'].onclick();batchResolve();await batch;
 assert.equal(batchSteps,1,'Pause stops before submitting the next chunk');assert.equal(elements['batch-export'].hidden,false);assert.equal(elements.model.disabled,false);
 await elements['batch-run'].onclick();assert.equal(batchSteps,2);assert.ok(elements['batch-status'].textContent.includes('hoàn thành'));
 assert.equal(calls.filter(c=>c.url.endsWith('/study/boards')&&c.options.method==='POST').length,1,'Batch does not run a diagram scan');
 elements['scan-model'].value='local:chessvision';await elements['scan-model'].onchange();
 assert.ok(calls.at(-1).url.includes('engine=local'));assert.ok(elements['scan-privacy'].textContent.includes('không gửi'));
 await elements['scan-page'].onclick();const scans=calls.filter(c=>c.url.endsWith('/study/boards')&&c.options.method==='POST');
 assert.equal(JSON.parse(scans.at(-1).options.body).model,'local:chessvision');assert.equal(calls.filter(c=>c.url.endsWith('/translate')).length,1);
 elements['scan-import'].onclick();assert.equal(elements['position-panel'].open,true);
 elements['pgn-file'].files=[{size:150,text:async()=>'[Event \"Imported diagram\"]\n[SetUp \"1\"]\n[FEN \"8/8/8/8/8/4k3/8/4K3 w - - 0 1\"]\n\n*'}];
 await elements['pgn-file'].onchange();assert.ok(elements['board-status'].textContent.includes('Đã mở'));
 assert.equal(elements.board.children.filter(x=>x.innerHTML?.includes('<use')).length,2);
 elements.position.value='broken';elements['load-position'].onclick();assert.ok(elements['board-status'].textContent.includes('không hợp lệ'));
 assert.equal(elements.board.children.filter(x=>x.innerHTML?.includes('<use')).length,2,'Invalid imports preserve current board');
 const legacy=fs.readFileSync(path.join(root,'translate.html'),'utf8'),script=legacy.match(/<script>([\s\S]*?)<\/script>/)[1];let redirected='';
 vm.runInNewContext(script,{URL,location:{origin:'http://localhost:8000',search:'?id=1',replace:value=>redirected=value},document:{getElementById:()=>new Element()}});
 assert.equal(redirected,'http://localhost:8000/study.html?id=1#batch-panel');
 console.log('PASS: independent models/tasks, selected page preview, diagram correction, small-image probe, batch pause/resume/export local default/provider caches, external image download/PGN import and legacy page redirect');
})().catch(e=>{console.error(e);process.exitCode=1});
