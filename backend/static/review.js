
import {Chess} from "/vendor/chess.js";
import {PIECE_DEFS} from "/vendor/pieces.js?v=paint-2";
import {savePgnToLibrary} from "/save-pgn.js?v=1";
import {parseReviewPgn,evaluationPoints,MAX_PGN_BYTES} from "/review-pgn.js?v=2";
import {moveReview,meanAccuracy,averageCentipawnLoss,needsConfirmation} from "/review-math.js?v=2";
const $=id=>document.getElementById(id),esc=s=>String(s??"").replace(/[&<>"']/g,c=>"&#"+c.charCodeAt(0)+";");
let pgn="",moves=[],fens=[],index=0,flip=false,scores=[],playedScores=[],reviews=[],worker=null,run=0,busy=false,players={w:"Trắng",b:"Đen"};
let openingByPly=[],openingHeader=null;
let cacheKey="",cachedQuality=0,cacheFailed=false,engineCancel=null,vaultTimer=null;

const PRESETS={250:{depth:12,ms:750},750:{depth:16,ms:2000},2000:{depth:20,ms:5000}};
function formatScore(s){return s.mate!==null?(s.mateWinner==="b"?"−":"")+"M"+Math.abs(s.mate):(s.cp>=0?"+":"")+(s.cp/100).toFixed(2);}
function completeReview(){return scores.length===fens.length&&playedScores.length===moves.length;}
function lossText(r){return "Giảm "+r.winLoss.toFixed(1)+" điểm phần trăm cơ hội thắng"+(r.loss===null?" · Có thế chiếu hết":" · Mất "+(r.loss/100).toFixed(2)+" điểm")+(r.uncertain?" · Ước tính, cần tính sâu hơn":"");}
function sanLine(fen,pv){
 const board=new Chess(fen),parts=[];
 for(const u of pv){try{const number=board.fen().split(" ")[5],color=board.turn(),m=board.move({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]});
 parts.push((color==="w"?number+". ":parts.length===0?number+"… ":"")+m.san);}catch{break;}}
 return parts.join(" ");
}
function drawVariations(score){
 const lines=score?.lines??(score?.pv?.length?[score]:[]);
 $("engine-lines").innerHTML=lines.length?lines.slice(0,3).map((s,i)=>{
 const text=sanLine(fens[index],s.pv);
 return '<details class="pv-line"><summary><span class="pv-eval">'+esc(formatScore(s))+'</span><span class="pv-rank">'+(i+1)+'</span><span class="pv-preview">'+esc(text||"Ván đã kết thúc")+'</span></summary><div class="pv-expanded">'+esc(text||"Không còn nước đi hợp lệ")+'<small>Độ sâu '+(s.depth||"—")+' · Điểm theo phía Trắng</small></div></details>';
 }).join(""):'<p class="pv-empty">'+(score?"Thế cờ đã kết thúc, không còn phương án.":"Phân tích ván để xem 3 phương án tốt nhất.")+'</p>';
 if(score&&!score.lines)$("pv-status").textContent="Kết quả cũ có 1 phương án · Bấm bổ sung để tính thêm.";
 else $("pv-status").textContent=lines.length?lines.length+" phương án · Điểm theo phía Trắng":"MultiPV 3 · Stockfish";
 const opening=openingByPly[index]||openingHeader;
 $("opening-code").textContent=opening?.eco||"—";
 $("opening-name").textContent=opening?.name||"Chưa nhận diện khai cuộc";
 $("opening-source").textContent=opening?.source==="pgn"?"Theo thông tin PGN":opening?"Nhận diện theo thế cờ · ECO":"Đi thêm các nước khai cuộc để nhận diện.";
}
async function recognizeOpenings(headers){
 openingHeader=/^[A-E][0-9]{2}$/.test(headers.ECO||"")?{eco:headers.ECO,name:[headers.Opening,headers.Variation].filter(Boolean).join(": ")||"Khai cuộc "+headers.ECO,source:"pgn"}:null;
 try{
  const r=await fetch("/openings-eco.json?v=1");if(!r.ok)throw Error();
  const data=await r.json();let latest=null;
  openingByPly=fens.map(fen=>{const row=data.positions[fen.split(" ").slice(0,3).join(" ")];if(row)latest={eco:row[0],name:row[1],source:"eco"};return latest;});
 }catch{$("opening-source").textContent="Không tải được dữ liệu ECO.";}
}
function analyzeLabel(){return completeReview()?"↻ Phân tích lại":"▶ Tiếp tục phân tích";}

function rebuildReviews(){
 reviews=playedScores.map((s,i)=>{
  const review=moveReview(scores[i],s,moves[i].color);
  const unstable=(moves[i].color==="w"?1:-1)*(review.afterWin-review.beforeWin)>=2;
  return {...review,color:moves[i].color,uncertain:s.limited||scores[i].limited||s.depth!==scores[i].depth||unstable};
 });
}
function persistReview(ms){
 if(!cacheKey)return;
 try{localStorage.setItem(cacheKey,JSON.stringify({version:2,engine:"stockfish-19-lite",quality:ms,scores,playedScores,updated:Date.now()}));cachedQuality=ms;cacheFailed=false;}
 catch{cacheFailed=true;}
}
function savedStatus(){return cacheFailed?"Không lưu được kết quả trên trình duyệt này.":"Đã tự lưu trên trình duyệt này.";}
async function restoreReview(){
 try{
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(fens.join("\\n")));
  cacheKey="thc:review:v2:"+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("");
  const raw=localStorage.getItem(cacheKey);if(!raw)return;
  const data=JSON.parse(raw);
  if(data.version!==2||data.engine!=="stockfish-19-lite"||!PRESETS[data.quality]||!Array.isArray(data.scores)||!data.scores.length||data.scores.length>fens.length||!Array.isArray(data.playedScores)||data.playedScores.length>moves.length||data.playedScores.length>data.scores.length)return;
  const valid=s=>s&&((s.mate===null&&Number.isFinite(s.cp)&&s.mateWinner===null)||(s.cp===null&&Number.isInteger(s.mate)&&s.mate>=0&&["w","b"].includes(s.mateWinner)))&&Number.isInteger(s.depth)&&s.depth>=0&&Array.isArray(s.pv)&&s.pv.every(u=>typeof u==="string"&&/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u));
  if(!data.scores.every(s=>valid(s)&&typeof s.limited==="boolean"&&Array.isArray(s.lines)&&s.lines.length<=3&&s.lines.every(valid))||!data.playedScores.every(s=>valid(s)&&typeof s.limited==="boolean"))return;
  scores=data.scores;playedScores=data.playedScores;cachedQuality=data.quality;$("quality").value=String(cachedQuality);rebuildReviews();summary();
  $("analysis-progress").max=Math.max(1,moves.length);$("analysis-progress").value=playedScores.length;
  const complete=completeReview();
  $("analyze").textContent=analyzeLabel();
  $("analysis-status").textContent=(complete?"Đã khôi phục phân tích toàn ván. ":"Đã khôi phục "+playedScores.length+" / "+moves.length+" nước. ")+savedStatus();
 }catch{cacheFailed=true;$("analysis-status").textContent="Không đọc được bộ nhớ lưu kết quả; bạn vẫn có thể phân tích ván.";}
}
document.body.insertAdjacentHTML("afterbegin",'<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>'+PIECE_DEFS+'</defs></svg>');
function moveAnnotation(review){
 if(!review)return null;
 return {kind:review.kind,symbol:review.symbol};
}
function draw(){
 const c=new Chess(fens[index]);let out="";
 const top=flip?"w":"b",bottom=flip?"b":"w";
 for(const [pos,color] of [["top",top],["bottom",bottom]]){$(pos+"-player").textContent=players[color];$(pos+"-color").textContent=color==="w"?"Quân trắng":"Quân đen";$(pos+"-dot").className="player-dot "+(color==="w"?"white":"black");}
 $("eval-white").style.top=flip?"0":"auto";$("eval-white").style.bottom=flip?"auto":"0";
 for(let row=0;row<8;row++)for(let col=0;col<8;col++){
  const f=flip?7-col:col,r=flip?row:7-row,sq="abcdefgh"[f]+(r+1),p=c.get(sq),last=moves[index-1],annotation=sq===last?.to?moveAnnotation(reviews[index-1]):null;
  out+='<div class="review-square '+((f+r)%2?"light":"dark")+((last&&(sq===last.from||sq===last.to))?" last":"")+(annotation?" annotated-square annotation-"+annotation.kind:"")+'">'+(p?'<svg viewBox="0 0 45 45"><use href="#'+p.color+p.type.toUpperCase()+'"/></svg>':"")+(annotation?'<span class="board-move-badge badge-'+annotation.kind+'" role="img" aria-label="'+esc(reviews[index-1].label)+'" title="'+esc(reviews[index-1].label)+'">'+annotation.symbol+'</span>':"")+(col===0?'<small class="rank">'+(r+1)+'</small>':"")+(row===7?'<small class="file">'+"abcdefgh"[f]+'</small>':"")+'</div>';
 }
 $("review-board").innerHTML=out;$("position").textContent=index+" / "+moves.length;
 $("first").disabled=!index;$("last").disabled=index===moves.length;$("prev").disabled=!index;$("next").disabled=index===moves.length;
 const score=scores[index],evalText=!score?"Chưa phân tích":score.mate!==null?"Chiếu hết "+Math.abs(score.mate)+" · "+(score.mateWinner==="w"?"Trắng":"Đen"):(score.cp>=0?"+":"")+(score.cp/100).toFixed(2);
 $("evaluation").textContent=evalText;
 $("evaluation-depth").textContent=score?(score.depth?"Độ sâu "+score.depth+(score.limited?" · Chưa đạt mục tiêu":""):"Thế cờ đã kết thúc"):"";
 $("eval-white").style.height=(score?score.mate!==null?(score.mateWinner==="w"?100:0):50+45*Math.tanh(score.cp/400):50)+"%";
 let text=index?moves[index-1].san:"Khai cuộc";
 if(index&&reviews[index-1])text+=" · "+reviews[index-1].label+" · "+lossText(reviews[index-1]);
 $("move-comment").textContent=text;
 const previous=scores[index-1];
 $("best-line").textContent=index&&previous?.pv?.length?"Gợi ý trước nước vừa đi: "+sanLine(fens[index-1],previous.pv.slice(0,6)):"";drawVariations(score);drawChart();
 let rows="",group=null;
 for(let i=0;i<moves.length;i++){
  const m=moves[i],number=new Chess(fens[i]).fen().split(" ")[5],r=reviews[i],quality=r?.kind||"";
  if(number!==group){if(group!==null)rows+="</div>";rows+='<div class="move-row"><span class="move-number">'+number+'.</span>';group=number;}
  rows+='<button type="button" style="grid-column:'+(m.color==="w"?2:3)+'" data-index="'+(i+1)+'" aria-current="'+(index===i+1?"step":"false")+'" title="'+esc(r?r.label+" · "+lossText(r):"Chưa phân tích")+'"><span class="move-san">'+esc(m.san)+'</span>'+(r?'<span aria-label="'+esc(r.label)+'" class="move-quality '+quality+'">'+r.symbol+'</span>':"")+'</button>';
 }
 if(group!==null)rows+="</div>";
 $("move-list").innerHTML=rows;

}
function drawChart(){
 const points=evaluationPoints(scores,moves.length),line=points.map(p=>p.x+","+p.y).join(" ");
 const x=10+980*index/Math.max(1,moves.length),point=points[index];
 $("evaluation-chart").innerHTML='<path class="chart-white" d="M10 15H990V90H10Z"/><path class="chart-black" d="M10 90H990V165H10Z"/><path class="chart-zero" d="M10 90H990"/>'+
  (line?'<polyline class="chart-line" points="'+line+'"/>':"")+'<path class="chart-cursor" d="M'+x+' 15V165"/>'+(point?'<circle class="chart-dot" cx="'+point.x+'" cy="'+point.y+'" r="5"/>':"");
 const label=index?new Chess(fens[index-1]).fen().split(" ")[5]+(moves[index-1].color==="w"?". ":"… ")+moves[index-1].san:"Bắt đầu ván";
 $("chart-ply").max=moves.length;$("chart-ply").value=index;$("chart-ply").setAttribute("aria-valuetext",label);
 $("chart-label").textContent=label;
 $("evaluation-chart").setAttribute("aria-label","Ưu thế Stockfish: "+playedScores.length+" / "+moves.length+" nước đã phân tích. Đang xem "+label+(scores[index]?", "+formatScore(scores[index]):", chưa phân tích"));
 $("chart-status").textContent=scores.length?"Đã phân tích "+playedScores.length+" / "+moves.length+" nước · Bấm biểu đồ để xem lại · Giới hạn hiển thị ±6 điểm.":"Biểu đồ cập nhật trong lúc phân tích. Bấm vào biểu đồ hoặc kéo thanh để xem nước đi.";
}
function summary(){
 for(const color of ["w","b"]){
  const v=meanAccuracy(reviews,color,moves.length),acpl=averageCentipawnLoss(reviews,color),name=color==="w"?"white":"black";
  $("accuracy-"+name).textContent=v===null?"—":v.toFixed(1)+"%";
  $("acpl-"+name).textContent=acpl===null?"ACPL: —":"ACPL: "+acpl.toFixed(1);
 }
 const uncertain=reviews.filter(r=>r.uncertain).length;
 $("accuracy-status").textContent=reviews.length?(reviews.length===moves.length?"Đã tính ":"Tạm tính ")+reviews.length+" / "+moves.length+" nước"+(uncertain?" · "+uncertain+" nước cần phân tích sâu hơn":" · Đã đạt độ sâu so sánh"):"Chưa có nước đi được phân tích.";
 const buckets=[{label:"Chuẩn xác / tốt",kinds:["accurate","good"],kind:"good"},{label:"Chưa chính xác",kinds:["inaccurate"],kind:"inaccurate"},{label:"Sai lầm",kinds:["mistake"],kind:"mistake"},{label:"Sai lầm lớn",kinds:["blunder"],kind:"blunder"}];
 $("review-counts").innerHTML='<table><caption>Chất lượng nước đi đã phân tích</caption><thead><tr><th scope="col">Nước đi</th><th scope="col">Trắng</th><th scope="col">Đen</th></tr></thead><tbody>'+buckets.map(b=>'<tr><th scope="row" class="'+b.kind+'">'+b.label+'</th>'+["w","b"].map(color=>'<td>'+reviews.filter(r=>r.color===color&&b.kinds.includes(r.kind)).length+'</td>').join("")+'</tr>').join("")+'</tbody></table>';
}
function watchVault(item){
 clearInterval(vaultTimer);
 vaultTimer=setInterval(async()=>{
  if(document.hidden)return;
  try{
   const r=await fetch("/api/library/item/"+encodeURIComponent(item),{cache:"no-store"});
   if(r.status===401||r.status===404){
    clearInterval(vaultTimer);vaultTimer=null;$("stop").onclick();
    $("workspace").hidden=true;$("library-unlock").hidden=r.status!==401;
    $("loading").textContent=r.status===401?"Tàng Kinh Các đang khóa. Mở khóa rồi mở lại tệp PGN.":"Tài liệu đã bị xóa. Hãy chọn một kỳ phổ khác.";
    pgn="";moves=[];fens=[];scores=[];playedScores=[];reviews=[];$("review-board").innerHTML="";$("move-list").innerHTML="";
   }
  }catch{/* A temporary network outage does not discard the current game. */}
 },30000);
}
async function load(){
 try{
  const q=new URLSearchParams(location.search);let r;
  if(q.has("item")){
   const item=q.get("item");
   if(!/^[1-9]\d*$/.test(item))throw Error("Mã tài liệu không hợp lệ.");
   $("review-back").href="/library.html";$("review-back").textContent="← Về Tàng Kinh Các";
   const metadata=await fetch("/api/library/item/"+item,{cache:"no-store"});
   if(metadata.status===401){$("library-unlock").hidden=false;throw Error("Tàng Kinh Các đang khóa. Mở khóa rồi mở lại tệp PGN.");}
   if(!metadata.ok)throw Error("Không tìm thấy tài liệu.");
   const info=await metadata.json();
   if((info.ext||"").toLowerCase()!==".pgn")throw Error("Tài liệu này không phải PGN. Hãy mở từ Tàng Kinh Các.");
   if(info.size>MAX_PGN_BYTES)throw Error("PGN lớn hơn 2 MB. Hãy xuất riêng một ván.");
   r=await fetch("/api/library/file/"+item,{cache:"no-store"});
  }
  else if(q.has("source")&&q.has("game"))r=await fetch("/api/game-archive/"+encodeURIComponent(q.get("source"))+"/"+encodeURIComponent(q.get("game")));
  else {$("loading").textContent="Nhập file PGN hoặc dán kỳ phổ để bắt đầu phân tích.";$("import-dialog").showModal();return;}
  if(r.status===401)$("library-unlock").hidden=false;
  if(!r.ok)throw Error(r.status===401?"Tàng Kinh Các đang khóa. Mở khóa rồi tải lại trang.":"Không đọc được kỳ phổ.");
  if(q.has("item"))pgn=await r.text();else {const g=await r.json();pgn=g.pgn;flip=g.user_color==="b";}
  if(!pgn?.trim())throw Error("Ván này chưa có PGN.");
  await showGame();
  if(q.has("item")){watchVault(q.get("item"));autoAnalyze();}
 }catch(e){$("loading").textContent=e.message;}
}

async function showGame(parsed=null){
  const validated=parsed?{board:parsed,pgn}:parseReviewPgn(pgn);pgn=validated.pgn;const c=validated.board;moves=c.history({verbose:true});const headers=c.getHeaders();
  scores=[];playedScores=[];reviews=[];openingByPly=[];openingHeader=null;cacheKey="";cachedQuality=0;cacheFailed=false;index=0;
  $("analyze").textContent="▶ Phân tích toàn ván";$("analysis-progress").value=0;$("analysis-status").textContent="Sẵn sàng · Stockfish chạy trên máy của bạn.";summary();
  players={w:headers.White||"Trắng",b:headers.Black||"Đen"};
  $("game-title").textContent=players.w+" · "+players.b;
  while(c.undo()){}fens=[c.fen()];for(const m of moves){c.move(m);fens.push(c.fen());}
  $("loading").textContent=Math.ceil(moves.length/2)+" lượt · "+moves.length+" nước đi · Kết quả "+(headers.Result||"*");
  await recognizeOpenings(headers);await restoreReview();$("workspace").hidden=false;draw();
}
$("open-import").onclick=()=>$("import-dialog").showModal();
$("close-import").onclick=$("cancel-import").onclick=()=>$("import-dialog").close();
$("pgn-file").onchange=()=>{$("import-status").textContent=$("pgn-file").files[0]?"Đã chọn "+$("pgn-file").files[0].name:"Mỗi lần nhập một ván cờ · Tối đa 2 MB.";$("pgn-text").value="";};
$("pgn-text").oninput=()=>{if($("pgn-text").value.trim())$("pgn-file").value="";};
function autoAnalyze(){
 if(completeReview())return;
 $("analyze").click();
}
$("import-form").onsubmit=async e=>{
 e.preventDefault();$("confirm-import").disabled=true;
 try{
  const file=$("pgn-file").files[0];
  if(file&&file.size>2*1024*1024)throw Error("File lớn hơn 2 MB. Hãy xuất riêng một ván.");
  const validated=parseReviewPgn(file?await file.text():$("pgn-text").value);
  const raw=validated.pgn,parsed=validated.board;
  if(busy)$("stop").onclick();
  clearInterval(vaultTimer);vaultTimer=null;$("library-unlock").hidden=true;
  pgn=raw;flip=false;
  await showGame(parsed);
  history.replaceState(null,"","/review.html");
  $("import-dialog").close();$("import-status").textContent="Đã nhập kỳ phổ.";autoAnalyze();
 }catch(err){$("import-status").textContent=err.message;}
 finally{$("confirm-import").disabled=false;}
};

function engineStart(){
 return new Promise((resolve,reject)=>{
  worker=new Worker("/vendor/stockfish/stockfish-19-lite-single.js");
  const timer=setTimeout(()=>reject(Error("Stockfish khởi động quá lâu.")),30000);
  engineCancel=()=>{clearTimeout(timer);reject(Error("Đã dừng phân tích."));};
  worker.onerror=()=>{clearTimeout(timer);reject(Error("Không chạy được Stockfish."));};
  worker.onmessage=e=>{const s=String(e.data);if(s==="uciok"){worker.postMessage("setoption name Threads value 1");worker.postMessage("setoption name Hash value 32");worker.postMessage("setoption name MultiPV value 3");worker.postMessage("isready");}else if(s==="readyok"){clearTimeout(timer);engineCancel=null;resolve();}};
  worker.postMessage("uci");
 });
}
function evaluate(ply,{depth,ms},forcedMove=null){
 const fen=fens[ply],board=new Chess(fen),turn=board.turn(),opponent=turn==="w"?"b":"w";
 const terminal=board.isCheckmate()?{cp:null,mate:0,mateWinner:opponent}:board.isStalemate()||board.isInsufficientMaterial()?{cp:0,mate:null,mateWinner:null}:null;
 if(terminal)return Promise.resolve({...terminal,pv:[],depth:0,targetDepth:depth,limited:false,lines:[],terminal:true});
 return new Promise((resolve,reject)=>{
  let score=null,latestDepth=0,completeLines=[];const lines=new Map(),lineCount=forcedMove?1:Math.min(3,board.moves().length);
  const timer=setTimeout(()=>reject(Error("Stockfish không trả kết quả.")),ms+10000);
  engineCancel=()=>{clearTimeout(timer);reject(Error("Đã dừng phân tích."));};
  worker.onerror=()=>{clearTimeout(timer);reject(Error("Stockfish gặp lỗi."));};
  worker.onmessage=e=>{
   const text=String(e.data),m=text.match(/\bscore (cp|mate) (-?\d+)/),pv=text.match(/\bpv (.+)/);
   if(m&&!text.includes("lowerbound")&&!text.includes("upperbound")){
    const n=Number(m[2]),rank=Number(text.match(/\bmultipv (\d+)/)?.[1]||1),reached=Number(text.match(/\bdepth (\d+)/)?.[1]||0);
    const candidate={cp:m[1]==="cp"?n*(turn==="w"?1:-1):null,mate:m[1]==="mate"?Math.abs(n):null,mateWinner:m[1]==="mate"?(n>0?turn:opponent):null,pv:pv?pv[1].trim().split(/\s+/):[],depth:reached};
    if(rank>=1&&rank<=lineCount){
     if(rank===1&&reached>latestDepth){lines.clear();latestDepth=reached;}
     if(reached===latestDepth)lines.set(rank,candidate);
     if(rank===1)score=candidate;
     if(lines.size===lineCount)completeLines=[...lines.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
    }
   }
   if(text.startsWith("bestmove")){
    clearTimeout(timer);engineCancel=null;
    if(!score||!score.pv.length||(forcedMove&&score.pv[0]!==forcedMove))return reject(Error("Không có đánh giá hợp lệ cho nước đi này."));
    // Keep the latest primary score; completed secondary lines can have a lower depth.
    const variations=completeLines.length?completeLines:[...lines.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
    resolve({...score,targetDepth:depth,limited:score.depth<depth,lines:[score,...variations.filter(s=>s.pv[0]!==score.pv[0])].slice(0,lineCount)});
   }
  };
  const history=moves.slice(0,ply).map(m=>m.from+m.to+(m.promotion||"")).join(" ");
  worker.postMessage("setoption name MultiPV value "+(forcedMove?1:3));
  worker.postMessage("position fen "+fens[0]+(history?" moves "+history:""));
  worker.postMessage("go depth "+depth+" movetime "+ms+(forcedMove?" searchmoves "+forcedMove:""));
 });
}
async function compareMove(ply,best,preset){
 const move=moves[ply],uci=move.from+move.to+(move.promotion||"");
 if(best.terminal||best.pv[0]===uci)return {...best};
 return evaluate(ply,{depth:best.depth,ms:preset.ms},uci);
}
$("analyze").onclick=async()=>{
 if(busy||!fens.length)return;busy=true;const token=++run;
 const quality=Number($("quality").value),preset=PRESETS[quality]||PRESETS[750];
 const resume=scores.length>0&&cachedQuality===quality&&!completeReview();
 if(!resume){scores=[];playedScores=[];reviews=[];}
 $("analyze").disabled=true;$("stop").disabled=false;$("quality").disabled=true;summary();draw();
 try{
  await engineStart();if(token!==run)return;worker.postMessage("ucinewgame");
  for(let i=0;i<fens.length;i++){
   if(resume&&scores[i]&&(i===moves.length||playedScores[i]))continue;
   $("analysis-status").textContent="Đang tính nước "+Math.min(i+1,moves.length)+" / "+moves.length+" · Mục tiêu độ sâu "+preset.depth;
   let best=await evaluate(i,preset);if(token!==run)return;
   if(i<moves.length){
    let played=await compareMove(i,best,preset);if(token!==run)return;
    if(needsConfirmation(best,played,moves[i].color)){
     $("analysis-status").textContent="Đang kiểm tra sâu nước "+(i+1)+" / "+moves.length+" · "+moves[i].san;
     const deeper={depth:Math.max(preset.depth+4,best.depth+2),ms:preset.ms*2};
     best=await evaluate(i,deeper);if(token!==run)return;
     played=await compareMove(i,best,deeper);if(token!==run)return;
     best.rechecked=true;played.rechecked=true;
    }
    playedScores[i]=played;
   }
   scores[i]=best;rebuildReviews();persistReview(quality);
   $("analysis-progress").value=playedScores.length;$("analysis-progress").max=Math.max(1,moves.length);
   summary();draw();
  }
  $("analysis-status").textContent="Đã phân tích toàn bộ ván. "+savedStatus();
 }catch(e){if(token===run)$("analysis-status").textContent=e.message;}
 finally{if(token===run){busy=false;$("analyze").disabled=false;$("stop").disabled=true;worker?.terminate();worker=null;engineCancel=null;$("quality").disabled=false;$("analyze").textContent=analyzeLabel();}}
};
$("stop").onclick=()=>{run++;engineCancel?.();engineCancel=null;worker?.terminate();worker=null;busy=false;$("analyze").disabled=false;$("stop").disabled=true;$("quality").disabled=false;$("analyze").textContent="▶ Tiếp tục phân tích";$("analysis-status").textContent="Đã dừng. "+savedStatus();};
$("prev").onclick=()=>{index=Math.max(0,index-1);draw();};$("next").onclick=()=>{index=Math.min(moves.length,index+1);draw();};
$("first").onclick=()=>{index=0;draw();};$("last").onclick=()=>{index=moves.length;draw();};
$("flip").onclick=()=>{flip=!flip;draw();};
$("move-list").onclick=e=>{const b=e.target.closest("[data-index]");if(b){index=Number(b.dataset.index);draw();$("move-list").querySelector('[aria-current="step"]')?.scrollIntoView({block:"nearest"});}};
$("chart-ply").oninput=()=>{index=Number($("chart-ply").value);draw();};
$("evaluation-chart").onclick=e=>{if(!fens.length)return;const rect=$("evaluation-chart").getBoundingClientRect();index=Math.max(0,Math.min(moves.length,Math.round(((e.clientX-rect.left)/rect.width*1000-10)/980*moves.length)));draw();};
addEventListener("pagehide",()=>{clearInterval(vaultTimer);$("stop").onclick();});
$("save").onclick=()=>savePgnToLibrary(pgn,$("game-title").textContent);
$("download").onclick=()=>{const u=URL.createObjectURL(new Blob([pgn],{type:"application/x-chess-pgn"})),a=document.createElement("a");a.href=u;a.download="ky-pho.pgn";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
addEventListener("keydown",e=>{if($("import-dialog").open||!fens.length||["INPUT","SELECT","TEXTAREA"].includes(e.target.tagName))return;if(e.key==="ArrowLeft"){e.preventDefault();$("prev").click();}if(e.key==="ArrowRight"){e.preventDefault();$("next").click();}});
load();
