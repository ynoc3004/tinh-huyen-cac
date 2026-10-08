import {Chess} from '/vendor/chess.js';
import {PIECE_DEFS} from '/vendor/pieces.js?v=paint-2';
import {savePgnToLibrary} from '/save-pgn.js?v=1';
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
const sources={bot:'Ván với bot',chesscom:'Chess.com',lichess:'Lichess'},speeds={all:'Tất cả',bullet:'Bullet',blitz:'Blitz',rapid:'Rapid',other:'Khác / Không đồng hồ'};
const query=new URLSearchParams(location.search);
let source=['all',...Object.keys(sources)].includes(query.get('source'))?query.get('source'):'all';
let speed=Object.keys(speeds).includes(query.get('time_class'))?query.get('time_class'):'all';
const requestedPage=Number(query.get('page'));
let page=Number.isSafeInteger(requestedPage)&&requestedPage>0?requestedPage:1,revision=0,replayRevision=0,loaded=false,total=0,size=12;
let fens=[],moves=[],ply=0,pgn='',flip=false;
$('history-source').value=source;
document.body.insertAdjacentHTML('afterbegin','<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>'+PIECE_DEFS+'</defs></svg>');
async function api(url,options){const r=await fetch(url,options);if(!r.ok)throw Error('Không đọc được kỳ phổ. Kiểm tra backend rồi thử lại.');return r.json();}
function mark(){document.querySelectorAll('[data-speed]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.speed===speed)));}
function paging(){ $('history-prev').disabled=!loaded||page<=1;$('history-next').disabled=!loaded||page*size>=total; }
function closeReplay(){replayRevision++;$('history-replay').hidden=true;}
// Retry local snapshots left by a failed save; don't erase newer moves from another tab.
async function flushPending(){
 let pending;try{pending=JSON.parse(localStorage.getItem('bicanh.pending-games')||'{}');}catch{return;}
 if(!pending||typeof pending!=='object'||Array.isArray(pending))return;
 for(const [id,game] of Object.entries(pending)){
  try{const r=await fetch('/api/bi-canh/bot-games',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(game)});if(!r.ok)continue;
   const current=JSON.parse(localStorage.getItem('bicanh.pending-games')||'{}');if(JSON.stringify(current[id])===JSON.stringify(game)){delete current[id];localStorage.setItem('bicanh.pending-games',JSON.stringify(current));}
  }catch{}
 }
}
async function load(){
 const token=++revision;closeReplay();loaded=false;paging();mark();$('history-status').textContent='Đang tải kỳ phổ…';$('history-list').setAttribute('aria-busy','true');
 const params=new URLSearchParams({source,time_class:speed,page:String(page)});history.replaceState(null,'','/history.html?'+params);
 try{
  await flushPending();if(token!==revision)return;
  const data=await api('/api/game-archive?'+params);if(token!==revision)return;
  total=data.total;size=data.size||12;
  const pages=Math.max(1,Math.ceil(total/size));if(page>pages){page=pages;return load();}
  document.querySelectorAll('[data-count]').forEach(el=>el.textContent=data.counts?.[el.dataset.count]??'—');
  $('history-status').textContent=total+' kỳ phổ'+(speed==='all'?'':' · '+speeds[speed]);
  $('history-list').innerHTML=data.items.length?data.items.map(g=>{
   const date=new Date(g.started_at),when=Number.isNaN(date.getTime())?'Chưa rõ ngày':date.toLocaleString('vi-VN');
   return '<article class="history-card"><button type="button" class="history-entry" data-game="'+esc(g.id)+'" data-source="'+esc(g.source)+'"><span><b>'+esc(g.opponent)+'</b><small>'+esc(sources[g.source]||g.source)+' · '+esc(when)+' · Quân '+(g.user_color==='b'?'Đen':'Trắng')+(g.plies==null?'':' · '+Math.ceil(g.plies/2)+' nước')+'</small><span class="speed-badge">'+esc(speeds[g.time_class]||speeds.other)+'</span></span><span class="history-result">'+esc(g.result==='*'?'Chưa kết thúc':g.result)+'<small>'+esc(g.reason)+'</small></span></button><div class="history-card-actions"><a href="/review.html?source='+encodeURIComponent(g.source)+'&game='+encodeURIComponent(g.id)+'">Phân tích ván cờ →</a><button type="button" data-save-game="'+esc(g.id)+'" data-source="'+esc(g.source)+'">Lưu vào Tàng Kinh Các</button></div></article>';
  }).join(''):'<div class="archive-empty">Chưa có kỳ phổ trong nhóm này. Chọn nhóm khác hoặc đồng bộ ván online.</div>';
  $('history-page').textContent=page+' / '+pages;loaded=true;paging();
 }catch(e){if(token===revision){$('history-status').textContent=e.message;$('history-list').replaceChildren();$('history-page').textContent='';}}
 finally{if(token===revision)$('history-list').setAttribute('aria-busy','false');}
}
function draw(){
 const board=new Chess(fens[ply]);let squares='',pieces='',coords='';
 for(let r=0;r<8;r++)for(let f=0;f<8;f++){
  const file=flip?7-f:f,rank=flip?r:7-r,sq='abcdefgh'[file]+(rank+1),piece=board.get(sq);
  squares+='<rect x="'+f*100+'" y="'+r*100+'" width="100" height="100" fill="var(--sq-'+((f+r)%2?'dark':'light')+')"/>';
  if(ply&&[moves[ply-1].from,moves[ply-1].to].includes(sq))squares+='<rect x="'+f*100+'" y="'+r*100+'" width="100" height="100" fill="none" stroke="var(--gold)" stroke-width="6"/>';
  if(piece)pieces+='<g transform="translate('+f*100+' '+r*100+')"><use href="#'+piece.color+piece.type.toUpperCase()+'" transform="scale(2.2222)"/></g>';
  const coordClass='co '+((f+r)%2?'d':'l');
  if(r===7)coords+='<text class="'+coordClass+'" x="'+(f*100+92)+'" y="795" text-anchor="end">'+'abcdefgh'[file]+'</text>';
  if(f===0)coords+='<text class="'+coordClass+'" x="5" y="'+(r*100+18)+'">'+(rank+1)+'</text>';
 }
 $('history-board').innerHTML='<svg class="board" viewBox="0 0 800 800" role="img" aria-label="Bàn cờ, nước '+ply+'">'+squares+pieces+'<g class="co">'+coords+'</g></svg>';
 $('history-position').textContent='Nước '+ply+' / '+moves.length;
 for(const id of ['replay-start','replay-prev'])$(id).disabled=ply===0;
 for(const id of ['replay-next','replay-end'])$(id).disabled=ply===moves.length;
 $('history-moves').innerHTML=moves.map((m,i)=>'<button type="button" data-ply="'+(i+1)+'" aria-current="'+(i+1===ply?'step':'false')+'">'+(i%2===0?Math.floor(i/2)+1+'. ':'')+esc(m.san)+'</button>').join('');
}
$('history-list').onclick=async e=>{
 const save=e.target.closest('[data-save-game]');if(save){save.disabled=true;try{const game=await api('/api/game-archive/'+save.dataset.source+'/'+encodeURIComponent(save.dataset.saveGame));if(!game.pgn)throw Error('Ván này chưa có PGN.');await savePgnToLibrary(game.pgn,'Ta - '+game.opponent);}catch(err){$('history-status').textContent=err.message;}finally{save.disabled=false;}return;}
 const button=e.target.closest('[data-game]');if(!button)return;const token=++replayRevision,listing=revision;
 try{
  const game=await api('/api/game-archive/'+button.dataset.source+'/'+encodeURIComponent(button.dataset.game));if(token!==replayRevision||listing!==revision)return;
  if(!game.pgn)throw Error('Ván này chưa có PGN.');const chess=new Chess();chess.loadPgn(game.pgn);const nextMoves=chess.history({verbose:true});while(chess.undo()){}const nextFens=[chess.fen()];for(const move of nextMoves){chess.move(move);nextFens.push(chess.fen());}
  moves=nextMoves;fens=nextFens;pgn=game.pgn;ply=0;flip=game.user_color==='b';$('history-title').textContent='Ta · '+game.opponent;$('history-result').textContent=(chess.getHeaders().Result||game.result)+' · '+(game.reason||'');$('history-replay').hidden=false;draw();$('history-replay').scrollIntoView({block:'start',behavior:'instant'});
 }catch(err){if(token===replayRevision)$('history-status').textContent=err.message;}
};
$('replay-start').onclick=()=>{ply=0;draw();};$('replay-end').onclick=()=>{ply=moves.length;draw();};$('replay-prev').onclick=()=>{ply=Math.max(0,ply-1);draw();};$('replay-next').onclick=()=>{ply=Math.min(moves.length,ply+1);draw();};$('replay-flip').onclick=()=>{flip=!flip;draw();};$('replay-close').onclick=closeReplay;
$('history-moves').onclick=e=>{const b=e.target.closest('[data-ply]');if(b){ply=Number(b.dataset.ply);draw();}};
$('history-download').onclick=()=>{const url=URL.createObjectURL(new Blob([pgn],{type:'application/x-chess-pgn'})),a=document.createElement('a');a.href=url;a.download='ky-pho.pgn';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('history-source').onchange=()=>{source=$('history-source').value;page=1;load();};document.querySelectorAll('[data-speed]').forEach(b=>b.onclick=()=>{speed=b.dataset.speed;page=1;load();});
$('history-refresh').onclick=load;$('history-prev').onclick=()=>{if(loaded&&page>1){page--;load();}};$('history-next').onclick=()=>{if(loaded&&page*size<total){page++;load();}};
$('history-sync').onclick=async()=>{const b=$('history-sync');b.disabled=true;$('history-sync-status').textContent='Đang đồng bộ Chess.com và Lichess…';try{const data=await api('/api/sync',{method:'POST'}),v=data.new_games||{},notes=[...Object.entries(v.errors||{}),...Object.entries(v.skipped||{})].map(([k,msg])=>k+': '+msg);$('history-sync-status').textContent='Ván mới: Chess.com '+(v.chesscom||0)+', Lichess '+(v.lichess||0)+(notes.length?'. '+notes.join('. '):'');page=1;await load();}catch(err){$('history-sync-status').textContent=err.message;}finally{b.disabled=false;}};
async function accounts(){try{const a=await api('/api/sync/accounts');$('history-accounts').textContent='Chess.com: '+(a.chesscom||'chưa cấu hình')+' · Lichess: '+(a.lichess||'chưa cấu hình');}catch{}}
mark();accounts();load();
