
import {Chess} from "/vendor/chess.js";
import {PIECE_DEFS} from "/vendor/pieces.js?v=paint-2";
import {savePgnToLibrary} from "/save-pgn.js?v=1";
import {moveReview,meanAccuracy} from "/review-math.js";
const $=id=>document.getElementById(id),esc=s=>String(s??"").replace(/[&<>"']/g,c=>"&#"+c.charCodeAt(0)+";");
let pgn="",moves=[],fens=[],index=0,flip=false,scores=[],reviews=[],worker=null,run=0,busy=false,players={w:"Trắng",b:"Đen"};
let cacheKey="",cachedQuality=0,cacheFailed=false;
function rebuildReviews(){
 reviews=scores.slice(1).map((s,i)=>({...moveReview(scores[i].cp,s.cp,moves[i].color),color:moves[i].color}));
}
function persistReview(ms){
 if(!cacheKey)return;
 try{localStorage.setItem(cacheKey,JSON.stringify({version:1,quality:ms,scores,updated:Date.now()}));cachedQuality=ms;cacheFailed=false;}
 catch{cacheFailed=true;}
}
function savedStatus(){return cacheFailed?"Không lưu được kết quả trên trình duyệt này.":"Đã tự lưu trên trình duyệt này.";}
async function restoreReview(){
 try{
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(fens.join("\\n")));
  cacheKey="thc:review:v1:"+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("");
  const raw=localStorage.getItem(cacheKey);if(!raw)return;
  const data=JSON.parse(raw);
  if(data.version!==1||![250,750,2000].includes(data.quality)||!Array.isArray(data.scores)||!data.scores.length||data.scores.length>fens.length)return;
  if(!data.scores.every(s=>s&&Number.isFinite(s.cp)&&(s.mate===null||Number.isFinite(s.mate))&&Array.isArray(s.pv)&&s.pv.every(u=>typeof u==="string"&&/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u))))return;
  scores=data.scores;cachedQuality=data.quality;$("quality").value=String(cachedQuality);rebuildReviews();summary();
  $("analysis-progress").max=Math.max(1,moves.length);$("analysis-progress").value=Math.max(0,scores.length-1);
  const complete=scores.length===fens.length;
  $("analyze").textContent=complete?"↻ Phân tích lại":"▶ Tiếp tục phân tích";
  $("analysis-status").textContent=(complete?"Đã khôi phục phân tích toàn ván. ":"Đã khôi phục "+Math.max(0,scores.length-1)+" / "+moves.length+" nước. ")+savedStatus();
 }catch{cacheFailed=true;$("analysis-status").textContent="Không đọc được bộ nhớ lưu kết quả; bạn vẫn có thể phân tích ván.";}
}
document.body.insertAdjacentHTML("afterbegin",'<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>'+PIECE_DEFS+'</defs></svg>');
function draw(){
 const c=new Chess(fens[index]);let out="";
 const top=flip?"w":"b",bottom=flip?"b":"w";
 for(const [pos,color] of [["top",top],["bottom",bottom]]){$(pos+"-player").textContent=players[color];$(pos+"-color").textContent=color==="w"?"Quân trắng":"Quân đen";$(pos+"-dot").className="player-dot "+(color==="w"?"white":"black");}
 $("eval-white").style.top=flip?"0":"auto";$("eval-white").style.bottom=flip?"auto":"0";
 for(let row=0;row<8;row++)for(let col=0;col<8;col++){
  const f=flip?7-col:col,r=flip?row:7-row,sq="abcdefgh"[f]+(r+1),p=c.get(sq),last=moves[index-1];
  out+='<div class="review-square '+((f+r)%2?"light":"dark")+((last&&(sq===last.from||sq===last.to))?" last":"")+'">'+(p?'<svg viewBox="0 0 45 45"><use href="#'+p.color+p.type.toUpperCase()+'"/></svg>':"")+(col===0?'<small class="rank">'+(r+1)+'</small>':"")+(row===7?'<small class="file">'+"abcdefgh"[f]+'</small>':"")+'</div>';
 }
 $("review-board").innerHTML=out;$("position").textContent=index+" / "+moves.length;
 $("first").disabled=!index;$("last").disabled=index===moves.length;$("prev").disabled=!index;$("next").disabled=index===moves.length;
 const score=scores[index],evalText=!score?"Chưa phân tích":score.mate!==null?"Chiếu hết "+Math.abs(score.mate)+" · "+(score.cp>0?"Trắng":"Đen"):(score.cp>=0?"+":"")+(score.cp/100).toFixed(2);
 $("evaluation").textContent=evalText;
 $("eval-white").style.height=(score?50+45*Math.tanh(score.cp/400):50)+"%";
 let text=index?moves[index-1].san:"Khai cuộc";
 if(index&&reviews[index-1])text+=" · "+reviews[index-1].label+" · Mất "+(reviews[index-1].loss/100).toFixed(2)+" điểm";
 $("move-comment").textContent=text;
 let pv="";
 if(score?.pv){const probe=new Chess(fens[index]);for(const u of score.pv.slice(0,6)){try{pv+=(pv?" ":"")+probe.move({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]}).san;}catch{break;}}}
 $("best-line").textContent=pv?"Phương án Stockfish: "+pv:"";
 let rows="",group=null;
 for(let i=0;i<moves.length;i++){
  const m=moves[i],number=new Chess(fens[i]).fen().split(" ")[5],r=reviews[i],quality=r?(r.loss>200?"blunder":r.loss>100?"mistake":r.loss>50?"inaccurate":"good"):"";
  if(number!==group){if(group!==null)rows+="</div>";rows+='<div class="move-row"><span class="move-number">'+number+'.</span>';group=number;}
  rows+='<button type="button" style="grid-column:'+(m.color==="w"?2:3)+'" data-index="'+(i+1)+'" aria-current="'+(index===i+1?"step":"false")+'" title="'+esc(r?r.label+" · Mất "+(r.loss/100).toFixed(2)+" điểm":"Chưa phân tích")+'"><span class="move-san">'+esc(m.san)+'</span>'+(r?'<span aria-label="'+esc(r.label)+'" class="move-quality '+quality+'">'+(r.loss>200?"??":r.loss>100?"?":r.loss>50?"?!":"✓")+'</span>':"")+'</button>';
 }
 if(group!==null)rows+="</div>";
 $("move-list").innerHTML=rows;

}
function summary(){for(const color of ["w","b"]){const v=meanAccuracy(reviews,color);$(color==="w"?"accuracy-white":"accuracy-black").textContent=v===null?"—":v.toFixed(1)+"%";}}
async function load(){
 try{
  const q=new URLSearchParams(location.search);let r;
  if(q.has("item"))r=await fetch("/api/library/file/"+encodeURIComponent(q.get("item")));
  else if(q.has("source")&&q.has("game"))r=await fetch("/api/game-archive/"+encodeURIComponent(q.get("source"))+"/"+encodeURIComponent(q.get("game")));
  else throw Error("Chọn một kỳ phổ để phân tích.");
  if(!r.ok)throw Error(r.status===401?"Tàng Kinh Các đang khóa. Mở khóa rồi tải lại trang.":"Không đọc được kỳ phổ.");
  if(q.has("item"))pgn=await r.text();else {const g=await r.json();pgn=g.pgn;flip=g.user_color==="b";}
  if(!pgn?.trim())throw Error("Ván này chưa có PGN.");
  const c=new Chess();c.loadPgn(pgn);moves=c.history({verbose:true});const headers=c.getHeaders();
  players={w:headers.White||"Trắng",b:headers.Black||"Đen"};
  $("game-title").textContent=players.w+" · "+players.b;
  while(c.undo()){}fens=[c.fen()];for(const m of moves){c.move(m);fens.push(c.fen());}
  $("loading").textContent=Math.ceil(moves.length/2)+" lượt · "+moves.length+" nước đi · Kết quả "+(headers.Result||"*");
  await restoreReview();$("workspace").hidden=false;draw();
 }catch(e){$("loading").textContent=e.message;}
}
function engineStart(){
 return new Promise((resolve,reject)=>{
  worker=new Worker("/vendor/stockfish/stockfish-19-lite-single.js");
  const timer=setTimeout(()=>reject(Error("Stockfish khởi động quá lâu.")),30000);
  worker.onerror=()=>{clearTimeout(timer);reject(Error("Không chạy được Stockfish."));};
  worker.onmessage=e=>{const s=String(e.data);if(s==="uciok"){worker.postMessage("setoption name Threads value 1");worker.postMessage("setoption name Hash value 32");worker.postMessage("isready");}else if(s==="readyok"){clearTimeout(timer);resolve();}};
  worker.postMessage("uci");
 });
}
function evaluate(fen,ms){
 return new Promise((resolve,reject)=>{
  let score=null;const timer=setTimeout(()=>reject(Error("Stockfish không trả kết quả.")),15000);
  worker.onerror=()=>{clearTimeout(timer);reject(Error("Stockfish gặp lỗi."));};
  worker.onmessage=e=>{
   const s=String(e.data);
   const m=s.match(/\bscore (cp|mate) (-?\d+)/),pv=s.match(/\bpv (.+)/);
   if(m&&!s.includes("lowerbound")&&!s.includes("upperbound")){
    const n=Number(m[2]),sign=new Chess(fen).turn()==="w"?1:-1;
    score={cp:(m[1]==="cp"?n:(n>=0?10000:-10000))*sign,mate:m[1]==="mate"?n:null,pv:pv?pv[1].split(" "):[]};
   }
   if(s.startsWith("bestmove")){clearTimeout(timer);
    const c=new Chess(fen);
    if(c.isCheckmate())score={cp:c.turn()==="w"?-10000:10000,mate:0,pv:[]};
    else if(c.isDraw())score={cp:0,mate:null,pv:[]};
    if(!score)return reject(Error("Không có đánh giá cho thế cờ này."));resolve(score);
   }
  };
  worker.postMessage("position fen "+fen);worker.postMessage("go movetime "+ms);
 });
}
$("analyze").onclick=async()=>{
 if(busy||!fens.length)return;busy=true;const token=++run;
 const ms=Number($("quality").value);
 const resume=scores.length>0&&scores.length<fens.length&&cachedQuality===ms;
 if(!resume){scores=[];reviews=[];}
 $("analyze").disabled=true;$("stop").disabled=false;$("quality").disabled=true;summary();draw();
 try{
  await engineStart();if(token!==run)return;
  for(let i=scores.length;i<fens.length;i++){
   const s=await evaluate(fens[i],ms);if(token!==run)return;scores.push(s);
   if(i){reviews.push({...moveReview(scores[i-1].cp,s.cp,moves[i-1].color),color:moves[i-1].color});}
   $("analysis-status").textContent="Đang tham ngộ "+i+" / "+moves.length;
   $("analysis-progress").value=i;$("analysis-progress").max=Math.max(1,moves.length);
   persistReview(ms);summary();draw();
  }
  $("analysis-status").textContent="Đã phân tích toàn bộ ván. "+savedStatus();
 }catch(e){if(token===run)$("analysis-status").textContent=e.message;}
 finally{if(token===run){busy=false;$("analyze").disabled=false;$("stop").disabled=true;worker?.terminate();worker=null;$("quality").disabled=false;$("analyze").textContent=scores.length===fens.length?"↻ Phân tích lại":"▶ Tiếp tục phân tích";}}
};
$("stop").onclick=()=>{run++;worker?.terminate();worker=null;busy=false;$("analyze").disabled=false;$("stop").disabled=true;$("quality").disabled=false;$("analyze").textContent="▶ Tiếp tục phân tích";$("analysis-status").textContent="Đã dừng. "+savedStatus();};
$("prev").onclick=()=>{index=Math.max(0,index-1);draw();};$("next").onclick=()=>{index=Math.min(moves.length,index+1);draw();};
$("first").onclick=()=>{index=0;draw();};$("last").onclick=()=>{index=moves.length;draw();};
$("flip").onclick=()=>{flip=!flip;draw();};
$("move-list").onclick=e=>{const b=e.target.closest("[data-index]");if(b){index=Number(b.dataset.index);draw();$("move-list").querySelector('[aria-current="step"]')?.scrollIntoView({block:"nearest"});}};
$("save").onclick=()=>savePgnToLibrary(pgn,$("game-title").textContent);
$("download").onclick=()=>{const u=URL.createObjectURL(new Blob([pgn],{type:"application/x-chess-pgn"})),a=document.createElement("a");a.href=u;a.download="ky-pho.pgn";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
addEventListener("keydown",e=>{if(!fens.length||["INPUT","SELECT","TEXTAREA"].includes(e.target.tagName))return;if(e.key==="ArrowLeft"){e.preventDefault();$("prev").click();}if(e.key==="ArrowRight"){e.preventDefault();$("next").click();}});
load();
