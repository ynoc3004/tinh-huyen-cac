const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const root=path.join(__dirname,'../static'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
class Element{
 constructor(){this.hidden=false;this.disabled=false;this.value='';this.files=[];this.style={};this.textContent='';this.innerHTML='';this.open=false;this.attributes={};}
 setAttribute(k,v){this.attributes[k]=v;} showModal(){this.open=true;} close(){this.open=false;}
 click(){this.pending=this.onclick?.();return this.pending;} querySelector(){return null;} getBoundingClientRect(){return {left:0,width:1000};}
}
(async()=>{
 const chessUrl=moduleUrl(read('vendor/chess.js')),{Chess}=await import(chessUrl);
 const {parseReviewPgn,evaluationPoints,MAX_PGN_BYTES}=await import(moduleUrl(read('review-pgn.js').replace('"/vendor/chess.js"',JSON.stringify(chessUrl))));
 const math=await import(moduleUrl(read('review-math.js')));
 const pgn='[Event "Test"]\n[White "Thanh"]\n[Black "Opponent"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *';
 assert.equal(parseReviewPgn('\uFEFF'+pgn).board.history().length,4);
 assert.equal(parseReviewPgn('1. e4 {comment} e5 (1... c5) 2. Nf3 $1 Nc6 *').board.history().length,4);
 const setup='[SetUp "1"]\n[FEN "8/8/8/8/8/4k3/8/4K3 b - - 0 42"]\n\n42... Kf3 *';
 assert.equal(parseReviewPgn(setup).board.history({verbose:true})[0].color,'b');
 for(const bad of ['', '[Event "Empty"]\n\n*','1. e4 e5 2. Qh8 *'])assert.throws(()=>parseReviewPgn(bad));
 assert.throws(()=>parseReviewPgn(pgn+'\n\n'+pgn),/nhiều ván/);
 assert.throws(()=>parseReviewPgn('x'.repeat(MAX_PGN_BYTES+1)),/2 MB/);
 const points=evaluationPoints([{cp:0},{cp:20000},{cp:-20000}],4);
 assert.deepEqual(points.map(p=>p.y),[90,15,165]);assert.equal(points[2].x,500);
 async function review({search='?item=3',status=200,ext='.PGN',raw=pgn,stored=new Map(),scoreFor=null,depthLimit=null,onGo=null,snapshots=new Map(),saveStatus=200,readStatus=200}={}){
  const elements={};for(const [,id] of read('review.html').matchAll(/id="([^"]+)"/g))elements[id]=new Element();
  elements.quality.value='250';elements['workspace'].hidden=true;elements['library-unlock'].hidden=true;
  const calls=[],workers=[],commands=[];let poll,vaultStatus=status;
  class Worker{
   constructor(){workers.push(this);this.terminated=false;}
   terminate(){this.terminated=true;}
   emit(data){queueMicrotask(()=>{if(!this.terminated)this.onmessage?.({data});});}
   postMessage(command){
    commands.push(command);
    if(command==='uci')this.emit('uciok');else if(command==='isready')this.emit('readyok');
    else if(command.startsWith('setoption name MultiPV '))this.multi=Number(command.split(' ').at(-1));
    else if(command.startsWith('position fen ')){
     const [fen,history]=command.slice(13).split(' moves '),c=new Chess(fen);
     for(const uci of (history?.split(' ')||[]))c.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
     this.fen=c.fen();
    }
    else if(command.startsWith('go ')){
     const c=new Chess(this.fen),all=c.moves({verbose:true}),forced=command.match(/searchmoves (\S+)/)?.[1];
     const requested=Number(command.match(/depth (\d+)/)?.[1]);
     if(onGo?.({command,forced,requested,worker:this,stop:()=>elements.stop.click()})===false)return;
     const legal=forced?all.filter(m=>m.from+m.to+(m.promotion||'')===forced):all.slice(0,this.multi||3);
     legal.forEach((m,i)=>{
      const score=scoreFor?.({fen:this.fen,move:m,forced,depth:requested,rank:i+1})||'cp '+(35-i*10);
      this.emit('info depth '+(depthLimit||requested)+' multipv '+(i+1)+' score '+score+' pv '+m.from+m.to+(m.promotion||''));
     });
     this.emit('bestmove '+(legal[0]?legal[0].from+legal[0].to:'(none)'));
    }
   }
  }
  // Optional smoke test against the exact bundled engine, without browser downloads.
  class EngineProcess{
   constructor(){
    workers.push(this);this.terminated=false;this.buffer='';
    this.child=require('node:child_process').spawn(process.execPath,[path.join(root,'vendor/stockfish/stockfish-19-lite-single.js')]);
    this.child.stdout.on('data',chunk=>{
     this.buffer+=chunk.toString();const lines=this.buffer.split('\n');this.buffer=lines.pop();
     for(const line of lines)if(!this.terminated)this.onmessage?.({data:line.trim()});
    });
    this.child.on('error',()=>this.onerror?.());
    this.child.on('exit',()=>{if(!this.terminated)this.onerror?.();});
   }
   postMessage(command){commands.push(command);if(!this.terminated)this.child.stdin.write(command+'\n');}
   terminate(){this.terminated=true;this.child.kill();}
  }
  const ctx={Chess,parseReviewPgn,evaluationPoints,MAX_PGN_BYTES,...math,PIECE_DEFS:'',savePgnToLibrary:()=>{},
   document:{hidden:false,body:{insertAdjacentHTML(){}},getElementById:id=>{assert.ok(elements[id],id);return elements[id]},createElement:()=>new Element()},
   location:{search},history:{replaceState(){}},URLSearchParams,TextEncoder,crypto:webcrypto,URL,Blob,Worker:process.env.REVIEW_REAL_ENGINE?EngineProcess:Worker,
   localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},setTimeout,clearTimeout,
   setInterval:fn=>{poll=fn;return 1},clearInterval(){},addEventListener(){},
   fetch:async (url,options={})=>{calls.push(url);
    if(url==='/api/reviews'||url==='/api/library/reviews'){
     const protectedList=url.includes('/library/');
     if(protectedList&&vaultStatus!==200)return {ok:false,status:vaultStatus};
     const items=[...snapshots].filter(([key])=>key.includes('/library/')===protectedList).map(([key,data])=>({...data,item_id:protectedList?Number(key.split('/').at(-2)):null,analyzed:data.playedScores.length,complete:data.scores.length===data.plies+1&&data.playedScores.length===data.plies}));
     return {ok:true,status:200,json:async()=>({items})};
    }
    if(url.startsWith('/api/reviews/')||url.startsWith('/api/library/reviews/')){
     if(url.includes('/library/')&&vaultStatus!==200)return {ok:false,status:vaultStatus};
     if(options.method==='PUT'){
      if(saveStatus!==200)return {ok:false,status:saveStatus};
      snapshots.set(url,{...JSON.parse(options.body),game_key:url.split('/').at(-1),updated:Date.now()});
      return {ok:true,status:200,json:async()=>({saved:true})};
     }
     if(readStatus!==200)return {ok:false,status:readStatus};
     return {ok:snapshots.has(url),status:snapshots.has(url)?200:404,json:async()=>snapshots.get(url)};
    }
    if(url.startsWith('/api/game-archive/'))return {ok:true,status:200,json:async()=>({pgn:raw,user_color:'b'})};
    if(url.startsWith('/api/library/item/'))return {ok:vaultStatus===200,status:vaultStatus,json:async()=>({ext,size:raw.length})};
    if(url.startsWith('/api/library/file/'))return {ok:true,status:200,text:async()=>raw};
    if(url.startsWith('/openings-eco'))return {ok:true,json:async()=>({positions:{}})};
    throw Error('Unexpected fetch: '+url);}
  };
  vm.createContext(ctx);vm.runInContext(read('review.js').replace(/^import .*;\n/gm,'').replace(/load\(\);\s*$/,'globalThis.boot=load();'),ctx);
  await ctx.boot;await elements.analyze.pending;
  return {elements,calls,workers,commands,stored,snapshots,ctx,poll:()=>poll?.(),setStatus:value=>vaultStatus=value};
 }
 const app=await review();assert.equal(app.elements.workspace.hidden,false);assert.equal(app.workers.length,1);
 assert.match(app.elements['analysis-status'].textContent,/toàn bộ/);assert.equal(app.elements['review-back'].href,'/library.html');
 assert.match(app.elements['evaluation-chart'].innerHTML,/polyline/);assert.equal(app.elements['review-board'].innerHTML.match(/class="review-square/g).length,64);
 app.elements['chart-ply'].value='2';app.elements['chart-ply'].oninput();assert.equal(app.elements.position.textContent,'2 / 4');
 assert.match(app.elements['best-line'].textContent,/Gợi ý/);assert.match(app.elements['chart-ply'].attributes['aria-valuetext'],/e5/);
 app.elements['evaluation-chart'].onclick({clientX:990});assert.equal(app.elements.position.textContent,'4 / 4');
 const cached=await review({stored:app.stored});assert.equal(cached.workers.length,0,'Complete cached review does not rerun the engine');
 const remote=await review({snapshots:app.snapshots});assert.equal(remote.workers.length,0,'Clearing browser storage still restores server results without a worker');
 assert.equal(remote.elements['accuracy-white'].textContent,app.elements['accuracy-white'].textContent);
 assert.match(remote.elements['save-status'].textContent,/trong ứng dụng/);
 assert.ok(![...remote.stored.values()].some(value=>value.includes('[White')),'Vault PGN is never mirrored as plaintext browser history');
 await remote.elements['open-saved'].click();assert.match(remote.elements['saved-list'].innerHTML,/review.html\?item=3/);
 remote.elements['saved-search'].value='not-a-player';remote.elements['saved-search'].oninput();assert.match(remote.elements['saved-list'].innerHTML,/Không tìm thấy/);
 remote.elements['saved-search'].value='Thanh';remote.elements['saved-search'].oninput();assert.match(remote.elements['saved-list'].innerHTML,/Thanh/);
 const mateApp=await review({raw:'1. f3 e5 2. g4 Qh4# 0-1'});mateApp.elements.last.click();
 assert.match(mateApp.elements.evaluation.textContent,/Chiếu hết 0 · Đen/);
 assert.match(mateApp.elements['evaluation-chart'].innerHTML,/polyline/);
 assert.match(mateApp.elements['engine-lines'].innerHTML,/không còn phương án/);
 // Controlled UCI fixtures cover comparisons and failure/resume paths deterministically.
 if(!process.env.REVIEW_REAL_ENGINE){
  assert.ok(app.commands.some(c=>/go depth 12 movetime 750 searchmoves e2e4/.test(c)),'Played move is searched at the original root and reached depth');
  assert.ok(app.commands.some(c=>c.includes(' moves e2e4 e7e5 g1f3')),'Full move history is retained for repetition');
  assert.match(app.elements['acpl-white'].textContent,/ACPL: 0\.0/);
  const points=evaluationPoints([{cp:null,mate:0,mateWinner:'w'},{cp:null,mate:0,mateWinner:'b'}],2);
  assert.deepEqual(points.map(p=>p.y),[15,165]);
  const oldCache=new Map([...app.stored].map(([key,value])=>[key.replace(':v2:',':v1:'),value]));
  const upgraded=await review({stored:oldCache});assert.equal(upgraded.workers.length,1,'Previous formula cache is never reused');
  const low=await review({depthLimit:4});assert.match(low.elements['accuracy-status'].textContent,/cần phân tích sâu hơn/);
  assert.match(low.elements['evaluation-depth'].textContent,/Chưa đạt/);
  const mating=await review({scoreFor:()=> 'mate -3'});mating.elements.first.click();
  assert.match(mating.elements.evaluation.textContent,/Chiếu hết 3 · Đen/);
  mating.elements.next.click();assert.match(mating.elements.evaluation.textContent,/Chiếu hết 3 · Trắng/);
  assert.equal(mating.elements['acpl-white'].textContent,'ACPL: —','Mate comparisons are excluded from ACPL');
  const corrected=await review({scoreFor:({forced,depth})=>forced&&depth<16?'cp -400':'cp 35'});
  const correctedData=JSON.parse([...corrected.stored.values()][0]);
  assert.equal(correctedData.scores[0].rechecked,true,'Large losses trigger confirmation');
  assert.equal(correctedData.scores[0].depth,16);assert.equal(correctedData.playedScores[0].depth,16);
  assert.equal(corrected.elements['accuracy-white'].textContent,'100.0%','Use confirmed result rather than shallow blunder');
  const interrupted=await review({scoreFor:({forced})=>forced?'cp -400':'cp 35',onGo:({requested,stop})=>{
   if(requested>12){stop();return false;}
  }});
  assert.match(interrupted.elements['analysis-status'].textContent,/Đã dừng/);
  assert.equal(interrupted.stored.size,0,'An unconfirmed pair cannot be cached as a finished review');
  await interrupted.elements.analyze.click();assert.match(interrupted.elements['analysis-status'].textContent,/Đã dừng/);
  const partialData={...correctedData,scores:correctedData.scores.slice(0,1),playedScores:correctedData.playedScores.slice(0,1)};
  const partialCache=new Map([[[...corrected.stored.keys()][0],JSON.stringify(partialData)]]);
  const resumed=await review({stored:partialCache});assert.equal(resumed.workers.length,0,'Opening partial results does not automatically resume analysis');await resumed.elements.analyze.click();assert.equal(resumed.workers.length,1);
  assert.ok(!resumed.commands.some(c=>c.includes(' searchmoves e2e4')),'Completed pairs are retained during resume');
  assert.match(resumed.elements['analysis-status'].textContent,/toàn bộ/);
  const unavailable=await review({readStatus:503});assert.equal(unavailable.workers.length,0,'A failed saved-result lookup must not silently start reanalysis');
  assert.match(unavailable.elements['analysis-status'].textContent,/Không tải được/);
  const failedSave=await review({saveStatus:503});assert.match(failedSave.elements['save-status'].textContent,/chưa lưu được/);
  assert.equal(failedSave.elements['retry-save'].hidden,false);assert.ok(failedSave.stored.size>0,'Browser cache survives a failed server save');
  const localAgain=await review({stored:failedSave.stored});assert.equal(localAgain.workers.length,0);assert.equal(localAgain.snapshots.size,1,'Existing browser results migrate to durable storage without engine work');
  const imported=await review({search:'?source=bot&game=1'});assert.equal(imported.workers.length,0);
  await imported.elements.analyze.click();const publicKey=[...imported.snapshots.keys()][0].split('/').at(-1);
  const opened=await review({search:'?saved='+publicKey,snapshots:imported.snapshots});assert.equal(opened.workers.length,0);
  assert.match(opened.elements['evaluation-chart'].innerHTML,/polyline/);assert.equal(opened.elements['accuracy-white'].textContent,imported.elements['accuracy-white'].textContent);
  await opened.elements['open-saved'].click();assert.match(opened.elements['saved-list'].innerHTML,/review.html\?saved=/);
  const home=await review({search:'',snapshots:imported.snapshots});assert.equal(home.elements['saved-dialog'].open,true);assert.equal(home.elements['import-dialog'].open,false);
  opened.setStatus(401);await opened.elements['saved-refresh'].click();assert.match(opened.elements['saved-status'].textContent,/Mở khóa/);assert.match(opened.elements['saved-list'].innerHTML,/review.html\?saved=/);
  const noHistory=await review({search:''});assert.equal(noHistory.elements['import-dialog'].open,true);
  const missing=await review({search:'?saved='+publicKey});assert.equal(missing.workers.length,0);assert.match(missing.elements.loading.textContent,/Không mở được/);
  const archiveMany=new Map();for(let i=0;i<14;i++){const key=i.toString(16).padStart(64,'0');archiveMany.set('/api/reviews/'+key,{...imported.snapshots.values().next().value,game_key:key,white:i===0?'<script>bad</script>':'Player '+i});}
  const paged=await review({search:'',snapshots:archiveMany});assert.equal(paged.elements['saved-list'].innerHTML.match(/class="saved-review"/g).length,12);
  assert.ok(!paged.elements['saved-list'].innerHTML.includes('<script>'));paged.elements['saved-next'].click();assert.equal(paged.elements['saved-list'].innerHTML.match(/class="saved-review"/g).length,2);
  const badCache=new Map([[[...corrected.stored.keys()][0],JSON.stringify({...correctedData,playedScores:[{cp:null,mate:null,pv:[]}]})]]);
  const rejected=await review({stored:badCache});assert.equal(rejected.workers.length,1,'Malformed results are reanalyzed');
  const primary=await review({onGo:({worker,forced,requested})=>{
   if(forced)return;
   const c=new Chess(worker.fen),legal=c.moves({verbose:true}).slice(0,3);
   legal.forEach((m,i)=>worker.emit('info depth '+(requested-1)+' multipv '+(i+1)+' score cp 10 pv '+m.from+m.to+(m.promotion||'')));
   worker.emit('info depth '+requested+' multipv 1 score cp 120 pv '+legal[0].from+legal[0].to+(legal[0].promotion||''));
   worker.emit('bestmove '+legal[0].from+legal[0].to);return false;
  }});
  assert.equal(JSON.parse([...primary.stored.values()][0]).scores[0].cp,120,'An older complete MultiPV set cannot overwrite the latest primary score');
 }
 const locked=await review({status:401});assert.equal(locked.workers.length,0);assert.equal(locked.elements['library-unlock'].hidden,false);assert.equal(locked.calls.length,1);
 const wrong=await review({ext:'.png'});assert.match(wrong.elements.loading.textContent,/không phải PGN/);assert.equal(wrong.calls.length,1);
 const invalid=await review({raw:'1. e4 e5 2. Qh8 *'});assert.equal(invalid.workers.length,0);assert.equal(invalid.elements.workspace.hidden,true);
 const setupApp=await review({raw:setup});assert.equal(setupApp.elements['chart-ply'].max,1);setupApp.elements.next.click();assert.match(setupApp.elements['chart-label'].textContent,/42… Kf3/);
 app.elements['pgn-text'].value='broken';await app.elements['import-form'].onsubmit({preventDefault(){}});assert.match(app.elements['import-status'].textContent,/không hợp lệ/);assert.equal(app.elements.position.textContent,'4 / 4','Invalid import keeps the current game');
 app.elements['pgn-text'].value='1. d4 d5 *';await app.elements['import-form'].onsubmit({preventDefault(){}});await app.elements.analyze.pending;assert.equal(app.elements.position.textContent,'0 / 2');
 app.elements.analyze.click();app.elements.stop.click();await app.elements.analyze.pending;assert.equal(app.elements.analyze.disabled,false);assert.equal(app.workers.at(-1).terminated,true);
 app.setStatus(401);await app.poll();assert.equal(app.elements.workspace.hidden,true);assert.equal(app.elements['review-board'].innerHTML,'');assert.equal(app.elements['library-unlock'].hidden,false);
 let redirect='',downloads=0;
 const readerContext={URLSearchParams,location:{search:'?id=3',replace:url=>redirect=url},document:{querySelector:()=>new Element()},fetch:async()=>{downloads++;return {ok:true,status:200,json:async()=>({ext:'.PGN'})}}};
 vm.runInNewContext(read('reader.html').match(/<script>\s*([\s\S]*?)<\/script>/)[1],readerContext);
 await new Promise(r=>setImmediate(r));assert.equal(redirect,'/review.html?item=3');assert.equal(downloads,1,'Legacy reader redirects before fetching plaintext');
 console.log('PASS: PGN validation, legacy reader redirect, vault guards, automatic first analysis, durable results without rerunning Stockfish, saved list/search/pagination, vault isolation, cache migration, chart navigation, black-to-move FEN, invalid import preservation and engine cancellation');
})().catch(e=>{console.error(e);process.exitCode=1});
