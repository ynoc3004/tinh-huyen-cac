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
 const {moveReview,meanAccuracy}=await import(moduleUrl(read('review-math.js')));
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
 async function review({search='?item=3',status=200,ext='.PGN',raw=pgn,stored=new Map()}={}){
  const elements={};for(const [,id] of read('review.html').matchAll(/id="([^"]+)"/g))elements[id]=new Element();
  elements.quality.value='250';elements['workspace'].hidden=true;elements['library-unlock'].hidden=true;
  const calls=[],workers=[];let poll,vaultStatus=status;
  class Worker{
   constructor(){workers.push(this);this.terminated=false;}
   terminate(){this.terminated=true;}
   emit(data){queueMicrotask(()=>{if(!this.terminated)this.onmessage?.({data});});}
   postMessage(command){
    if(command==='uci')this.emit('uciok');else if(command==='isready')this.emit('readyok');
    else if(command.startsWith('position fen '))this.fen=command.slice(13);
    else if(command.startsWith('go ')){
     const c=new Chess(this.fen),legal=c.moves({verbose:true}).slice(0,3);
     legal.forEach((m,i)=>this.emit('info depth 10 multipv '+(i+1)+' score cp '+(35-i*10)+' pv '+m.from+m.to+(m.promotion||'')));
     this.emit('bestmove '+(legal[0]?legal[0].from+legal[0].to:'(none)'));
    }
   }
  }
  const ctx={Chess,parseReviewPgn,evaluationPoints,MAX_PGN_BYTES,moveReview,meanAccuracy,PIECE_DEFS:'',savePgnToLibrary:()=>{},
   document:{hidden:false,body:{insertAdjacentHTML(){}},getElementById:id=>{assert.ok(elements[id],id);return elements[id]},createElement:()=>new Element()},
   location:{search},history:{replaceState(){}},URLSearchParams,TextEncoder,crypto:webcrypto,URL,Blob,Worker,
   localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},setTimeout,clearTimeout,
   setInterval:fn=>{poll=fn;return 1},clearInterval(){},addEventListener(){},
   fetch:async url=>{calls.push(url);if(url.startsWith('/api/library/item/'))return {ok:vaultStatus===200,status:vaultStatus,json:async()=>({ext,size:raw.length})};
    if(url.startsWith('/api/library/file/'))return {ok:true,status:200,text:async()=>raw};
    if(url.startsWith('/openings-eco'))return {ok:true,json:async()=>({positions:{}})};
    throw Error('Unexpected fetch: '+url);}
  };
  vm.createContext(ctx);vm.runInContext(read('review.js').replace(/^import .*;\n/gm,'').replace(/load\(\);\s*$/,'globalThis.boot=load();'),ctx);
  await ctx.boot;await elements.analyze.pending;
  return {elements,calls,workers,stored,ctx,poll:()=>poll?.(),setStatus:value=>vaultStatus=value};
 }
 const app=await review();assert.equal(app.elements.workspace.hidden,false);assert.equal(app.workers.length,1);
 assert.match(app.elements['analysis-status'].textContent,/toàn bộ/);assert.equal(app.elements['review-back'].href,'/library.html');
 assert.match(app.elements['evaluation-chart'].innerHTML,/polyline/);assert.equal(app.elements['review-board'].innerHTML.match(/class="review-square/g).length,64);
 app.elements['chart-ply'].value='2';app.elements['chart-ply'].oninput();assert.equal(app.elements.position.textContent,'2 / 4');
 assert.match(app.elements['best-line'].textContent,/Gợi ý/);assert.match(app.elements['chart-ply'].attributes['aria-valuetext'],/e5/);
 app.elements['evaluation-chart'].onclick({clientX:990});assert.equal(app.elements.position.textContent,'4 / 4');
 const cached=await review({stored:app.stored});assert.equal(cached.workers.length,0,'Complete cached review does not rerun the engine');
 const mateApp=await review({raw:'1. f3 e5 2. g4 Qh4# 0-1'});mateApp.elements.last.click();
 assert.match(mateApp.elements.evaluation.textContent,/Chiếu hết 0 · Đen/);
 assert.match(mateApp.elements['evaluation-chart'].innerHTML,/polyline/);
 assert.match(mateApp.elements['engine-lines'].innerHTML,/không còn phương án/);
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
 console.log('PASS: PGN validation, legacy reader redirect, vault guards, automatic Stockfish review, cache restore, chart navigation, black-to-move FEN, invalid import preservation and engine cancellation');
})().catch(e=>{console.error(e);process.exitCode=1});
