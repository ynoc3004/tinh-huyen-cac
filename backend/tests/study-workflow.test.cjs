const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element {
 constructor(){this.value='';this.textContent='';this.children=[];this.hidden=false;this.disabled=false;this.dataset={};this.attributes={};const classes=new Set();this.classList={toggle:(name,on)=>{on??=!classes.has(name);on?classes.add(name):classes.delete(name);return on;},contains:name=>classes.has(name)};this.style={setProperty(){}};}
 setAttribute(k,v){this.attributes[k]=v;} getAttribute(k){return this.attributes[k];}
 replaceChildren(...items){this.children=items;if(items.length&&'value' in items[0])this.value=items[0].value;}
 focus(){} scrollIntoView(){} append(...items){this.children.push(...items);} remove(){} click(){return this.onclick?.();}
}
async function run(offline=false){
 const root=path.join(__dirname,'../static');
 const html=fs.readFileSync(path.join(root,'study.html'),'utf8'),elements={};
 for(const [,id] of html.matchAll(/id="([^"]+)"/g))elements[id]=new Element();
 const body=new Element(),docRoot=new Element();body.dataset.view='bilingual';
 const sections=['original','reading','board'].map(section=>{const b=new Element();b.dataset.section=section;return b;});
 const document={body,documentElement:docRoot,getElementById:id=>{assert.ok(elements[id],`Missing HTML control: ${id}`);return elements[id]},createElement:()=>new Element(),createElementNS:()=>new Element(),querySelector:()=>new Element(),querySelectorAll:selector=>selector==='button[data-section]'?sections:selector==='.scan-card'?elements['scan-results'].children:selector==='[data-view]'?[body]:[]};
 const {Chess}=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(root,'vendor/chess.js')).toString('base64'));
 let confirmAnswer=true,ocrMissing=false,ollamaAvailable=false,pageChunks=null,failChunk='',pauseChunk='',chunkActions=[];
 let scanResolve,translateResolve,batchResolve,batchJob={},batchSteps=0;const batchWait=new Promise(r=>batchResolve=r);const scanWait=new Promise(r=>scanResolve=r),translateWait=new Promise(r=>translateResolve=r),calls=[];
 const board={placement:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',turn:'w',orientation:'white',image:'data:image/png;base64,example'};
 const fetch=async(url,options={})=>{
 calls.push({url,options});let data={};
 if(ocrMissing&&url.includes('/page?page=')&&url.includes('ocr=true'))return {ok:false,status:503,json:async()=>({detail:'Không tìm thấy eng.traineddata. Tạm tắt OCR.'})};
 if(offline&&url.endsWith('/models'))return {ok:false,status:503,json:async()=>({detail:'Bộ dịch ngoại tuyến'})};
 if(offline&&url.endsWith('/cached'))return {ok:true,status:200,json:async()=>({translation:'Bản dịch tiếng Việt đã lưu.'})};
 if(url==='/api/library?kind=book')data=[{id:1,ext:'.pdf',title:'Book'}];
 else if(url.endsWith('/state'))data={page:1,model:'deepl:en-vi'};
 else if(url.endsWith('/models'))data={models:['deepl:en-vi','gemini:configured',...(ollamaAvailable?['qwen3:4b']:[])],local_models:ollamaAvailable?['qwen3:4b']:[],recommended_local:ollamaAvailable?'qwen3:4b':''};
 else if(url.endsWith('/scan-probe'))data={ok:true,message:"Model nhận ảnh nhỏ thành công."};
 else if(url.endsWith('/batch/start')){const settings=JSON.parse(options.body);batchJob={...settings,done:batchJob.done||0,chunk:0,chunks:0,phase:"ready"};data=batchJob;}
 else if(url.endsWith('/batch/step')){batchSteps++;if(batchSteps===1)await batchWait;batchJob={...batchJob,done:batchSteps,phase:batchSteps===2?"completed":"ready"};data=batchJob;}
 else if(url.endsWith('/batch'))data=batchJob;
 else if(url.endsWith('/scan-local'))data={installed:true,ready:true,message:'Local miễn phí · sẵn sàng'};
 else if(url.endsWith('/scan-models'))data={models:['local:chessvision','gemini-configured','gemini-selected'],default:'local:chessvision',available:true};
 else if(url.includes('/page?page=')&&!url.includes('/batch/'))data={page:Number(new URL(url,'http://local').searchParams.get('page')),pages:10,text:'White plays Nf3.',title:'Book'};
 else if(url.includes('/study/boards')){if(options.method==='POST'){await scanWait;data={boards:[board,board]};}else data={boards:null,available:true};}
 else if(url.endsWith('/translate/plan'))data={chunks:pageChunks||[JSON.parse(options.body).text]};
 else if(url.endsWith('/translate/complete'))data={translation:'Trắng đi Nf3.'};
 else if(url.endsWith('/translate')){
 await translateWait;const request=JSON.parse(options.body);
 if(pageChunks){chunkActions.push(request);if(request.text===failChunk)return {ok:false,status:504,json:async()=>({detail:'Ollama chưa trả kết quả trong thời gian chờ.'})};if(request.text===pauseChunk)elements['translate-stop'].onclick();}
 data={translation:'Trắng đi Nf3.'};
 }
 return {ok:true,status:200,json:async()=>data};
 };
 const store=new Map(),context={Chess,PIECE_DEFS:'',document,fetch,location:{search:'?id=1'},URLSearchParams,URL,Option:class extends Element{constructor(text,value){super();this.textContent=text;this.value=value;}},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},setInterval(){},setTimeout,Date,console,confirm:()=>confirmAnswer};
 context.window=context;context.addEventListener=()=>{};
 const code=fs.readFileSync(path.join(root,'study.js'),'utf8').replace(/^import .*;\n/gm,'');vm.runInNewContext(code,context,{filename:'study.js'});
 for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));
 if(offline){assert.equal(elements.pdf.src,'/api/library/translation/1/study/page-image?page=1');assert.equal(elements.result.textContent,'Bản dịch tiếng Việt đã lưu.');assert.equal(elements.translate.disabled,true);assert.equal(elements['batch-run'].disabled,true);assert.equal(elements['scan-page'].disabled,false);console.log('PASS: offline translation does not block book reading, saved Vietnamese text, or diagram scanning');return;}
 assert.equal(body.classList.contains('active'),false,'View selection must not paint the whole document as an active control');
 sections[1].click();assert.equal(body.dataset.section,'reading');assert.equal(sections[1].getAttribute('aria-pressed'),'true');sections[2].click();assert.equal(body.dataset.section,'board');assert.equal(sections[1].getAttribute('aria-pressed'),'false');sections[0].click();
 assert.equal(elements['board-stage'].hidden,true,'No unrelated starting position before a book diagram is selected');
 assert.equal(elements['board-empty'].hidden,false);
 elements['options-toggle'].onclick();assert.equal(elements['reader-options'].open,true);
 elements['focus'].onclick();assert.equal(body.classList.contains('focus'),true);elements['options-toggle'].onclick();assert.equal(body.classList.contains('focus'),false,'Focus mode must retain an accessible exit');
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
 translateResolve();await translation;assert.equal(JSON.parse(calls.find(c=>c.url.endsWith('/translate')).options.body).force,true,'Explicit translation replaces bad cached output');assert.equal(elements.translate.textContent,'Dịch lại');assert.equal(elements.result.textContent,'Trắng đi Nf3.');assert.equal(elements.model.value,'deepl:en-vi');
 elements['scan-results'].children[1].onclick();assert.equal(elements['board-stage'].hidden,false);assert.equal(elements['board-empty'].hidden,true);
 elements.board.children.find(x=>x.title==='e2').onclick();elements.board.children.find(x=>x.title==='e4').onclick();assert.ok(elements.moves.textContent.includes('e4'));elements['restore-position'].onclick();assert.equal(elements.moves.textContent,'','Restore returns to the selected book diagram');
 assert.equal(elements['scan-selected'].textContent,'Thế 2 · trang 1');assert.equal(elements['scan-editor'].open,false);
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
 assert.equal(elements['board-stage'].hidden,true,'Changing scan provider clears the old book diagram');assert.equal(elements['restore-position'].disabled,true);
 assert.ok(calls.at(-1).url.includes('engine=local'));assert.ok(elements['scan-privacy'].textContent.includes('không gửi'));
 await elements['scan-page'].onclick();const scans=calls.filter(c=>c.url.endsWith('/study/boards')&&c.options.method==='POST');
 assert.equal(JSON.parse(scans.at(-1).options.body).model,'local:chessvision');assert.equal(calls.filter(c=>c.url.endsWith('/translate')).length,1);
 elements['scan-import'].onclick();assert.equal(elements['position-panel'].open,true);
 elements['pgn-file'].files=[{size:150,text:async()=>'[Event \"Imported diagram\"]\n[SetUp \"1\"]\n[FEN \"8/8/8/8/8/4k3/8/4K3 w - - 0 1\"]\n\n*'}];
 await elements['pgn-file'].onchange();assert.ok(elements['board-status'].textContent.includes('Đã mở'));assert.equal(elements['board-stage'].hidden,false,'Manual imports remain usable without a scanner');
 assert.equal(elements.board.children.filter(x=>x.innerHTML?.includes('<use')).length,2);
 elements.position.value='broken';elements['load-position'].onclick();assert.ok(elements['board-status'].textContent.includes('không hợp lệ'));
 assert.equal(elements.board.children.filter(x=>x.innerHTML?.includes('<use')).length,2,'Invalid imports preserve current board');
 await elements.next.onclick();assert.equal(elements.pdf.src,'/api/library/translation/1/study/page-image?page=2');assert.equal(elements['board-stage'].hidden,true,'Turning the page must hide the previous diagram');assert.equal(elements['restore-position'].disabled,true);
 const imageBefore=elements.pdf.src;const requestsBefore=calls.length;confirmAnswer=false;await elements['source-refresh'].onclick();assert.equal(calls.length,requestsBefore,'Cancelling source reload preserves edits');confirmAnswer=true;await elements['source-refresh'].onclick();assert.ok(calls.some(c=>c.url.includes('fresh=true')));assert.equal(elements.pdf.src,imageBefore,'Reloading text must keep the selected PDF page');assert.ok(elements['source-status'].textContent.includes('Đã đọc lại'));
 ocrMissing=true;elements.ocr.checked=true;await elements.ocr.onchange();assert.ok(elements.pdf.src.endsWith('page=2'),'Missing OCR data must not block PDF reading');assert.ok(elements['translation-status'].textContent.includes('eng.traineddata'));assert.ok(calls.at(-1));elements.source.value='Manual edits stay.';await elements['source-refresh'].onclick();assert.equal(elements.source.value,'Manual edits stay.','Failed explicit OCR must preserve current edits');assert.ok(elements['source-status'].textContent.includes('eng.traineddata'));
 const beforeNatural=calls.filter(c=>c.url.endsWith('/translate')).length;await elements['natural-translate'].onclick();assert.equal(calls.filter(c=>c.url.endsWith('/translate')).length,beforeNatural,'No local model must not trigger a paid fallback');assert.ok(elements['translation-status'].textContent.includes('Ollama'));ollamaAvailable=true;await elements['natural-translate'].onclick();const natural=calls.filter(c=>c.url.endsWith('/translate')).at(-1);assert.equal(JSON.parse(natural.options.body).model,'qwen3:4b');assert.ok(elements['model-info'].textContent.includes('qwen3:4b'));
 // A failed retranslation must resume saved chunks even when an older full page exists.
 pageChunks=['First sentence.','Second sentence.'];failChunk=pageChunks[1];
 await elements.translate.onclick();assert.equal(elements.result.textContent,'Trắng đi Nf3.');assert.ok(elements['translation-status'].textContent.includes('1 / 2'));assert.equal(elements['translate-stop'].hidden,true);
 assert.deepEqual(chunkActions.map(x=>x.force),[true,true]);
 failChunk='';chunkActions=[];await elements.translate.onclick();assert.deepEqual(chunkActions.map(x=>x.force),[false,true]);assert.ok(elements['translation-status'].textContent.includes('Bản dịch đã lưu'));
 chunkActions=[];pauseChunk=pageChunks[0];const completeBefore=calls.filter(c=>c.url.endsWith('/translate/complete')).length;
 await elements.translate.onclick();assert.equal(chunkActions.length,1);assert.ok(elements['translation-status'].textContent.includes('tạm dừng'));assert.equal(calls.filter(c=>c.url.endsWith('/translate/complete')).length,completeBefore);
 pauseChunk='';chunkActions=[];await elements.translate.onclick();assert.deepEqual(chunkActions.map(x=>x.force),[false,true]);assert.equal(elements['translate-stop'].hidden,true);
 elements['reader-options'].open=false;elements['focus'].onclick();elements['choose-model'].onclick();assert.equal(elements['reader-options'].open,true);assert.equal(body.classList.contains('focus'),false,'Model selection must be visible in focus mode');
 const legacy=fs.readFileSync(path.join(root,'translate.html'),'utf8'),script=legacy.match(/<script>([\s\S]*?)<\/script>/)[1];let redirected='';
 vm.runInNewContext(script,{URL,location:{origin:'http://localhost:8000',search:'?id=1',replace:value=>redirected=value},document:{getElementById:()=>new Element()}});
 assert.equal(redirected,'http://localhost:8000/study.html?id=1');
 console.log('PASS: independent models/tasks, selected page preview, diagram correction, small-image probe, batch pause/resume/export local default/provider caches, external image download/PGN import and legacy page redirect');
}
(async()=>{await run();await run(true);})().catch(e=>{console.error(e);process.exitCode=1});
