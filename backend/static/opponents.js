import {Chess} from '/vendor/chess.js';
import {PIECE_DEFS} from '/vendor/pieces.js?v=paint-2';
import {esc,colorName,speedName,percent,moveLine,ratingDifference,sourceLink} from '/opponent-utils.js?v=1';

const $=id=>document.getElementById(id);
let current=null,saved=[],game=null,ply=0,flip=false,busy=false,viewToken=0,gameToken=0,dirty=false;
const date=value=>value?new Date(value*1000).toLocaleString('vi-VN'):'Thiếu ngày';
const outcome=value=>({win:'Thắng',draw:'Hòa',loss:'Thua'})[value]||value;
const status=(message,error=false)=>{$('op-status').textContent=message;$('op-status').dataset.error=String(error);};
async function api(path,options={}){
 const r=await fetch('/api/opponents'+path,{cache:'no-store',...options});
 const data=await r.json().catch(()=>null);
 if(!r.ok)throw Error(typeof data?.detail==='string'?data.detail:'Chưa thực hiện được yêu cầu. Thử lại sau.');
 return data;
}
const post=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function setBusy(value){
 busy=value;
 for(const id of ['op-collect','op-import','op-refresh','op-delete','op-save','op-recalculate'])$(id).disabled=value;
 $('op-form').setAttribute('aria-busy',String(value));
}
function options(){return {platform:$('op-platform').value,username:$('op-user').value.trim(),days:Number($('op-days').value),max_games:Number($('op-limit').value),speed:$('op-speed').value,rated_only:$('op-rated').checked};}
function mayLeave(){return !dirty||confirm('Ghi chú đang sửa chưa được lưu. Bạn muốn chuyển hồ sơ?');}
function evidence(ids,at=0){return ids.map((id,i)=>'<button type="button" data-game="'+esc(id)+'" data-ply="'+at+'">Ván '+(i+1)+'</button>').join('');}
function drawSaved(){
 const term=$('op-search').value.trim().toLocaleLowerCase('vi');
 const rows=saved.filter(r=>(r.title+' '+r.username).toLocaleLowerCase('vi').includes(term));
 $('op-saved').innerHTML=rows.length?rows.map(r=>'<button type="button" data-report="'+esc(r.id)+'" aria-current="'+String(current?.id===r.id)+'"><strong>'+esc(r.title)+'</strong><small>'+esc(speedName(r.filters.speed))+' · '+r.summary.games+' ván · '+esc(r.filters.source==='pgn'?'Nhập PGN':r.platform==='chesscom'?'Chess.com':'Lichess')+'</small><small>'+esc(date(r.updated_at))+'</small></button>').join(''):'<p class="op-help">'+(term?'Không tìm thấy hồ sơ.':'Chưa có hồ sơ. Nhập nick để bắt đầu.')+'</p>';
}
async function loadSaved(){
 try{saved=await api('');drawSaved();}catch(e){$('op-saved').textContent=e.message;}
}
function statsTable(rows,label){
 return '<table><thead><tr><th>'+label+'</th><th>Ván</th><th>T–H–B</th><th>Điểm số</th><th>Chênh rating<br>người được xem − bên còn lại</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.label||r.key)+(r.latest_rating_in_sample?'<small>Rating gần nhất trong mẫu: '+r.latest_rating_in_sample+'</small>':'')+'</td><td>'+r.games+'</td><td>'+r.wins+'–'+r.draws+'–'+r.losses+'</td><td>'+esc(percent(r.score_percent))+'</td><td>'+esc(ratingDifference(r))+'</td></tr>').join('')+'</tbody></table>';
}
function drawBranches(){
 if(!current)return;
 const rows=current.branches.filter(b=>b.color===$('op-branch-color').value&&b.ply===Number($('op-branch-ply').value));
 $('op-branches').innerHTML=rows.length?rows.slice(0,16).map(b=>'<button type="button" class="op-branch" data-game="'+esc(b.evidence[0])+'" data-ply="'+b.ply+'"><strong>'+esc(moveLine(b.moves.split(' ')))+'</strong><small>'+b.games+' ván · '+esc(percent(b.frequency_percent))+' trong các ván cùng màu · điểm số '+esc(percent(b.score_percent))+'</small><small>'+esc(ratingDifference(b))+'</small></button>').join(''):'<p class="op-help">Chưa có ván đến đủ số nước ở màu quân này.</p>';
}
function render(report){
 current=report;dirty=false;game=null;gameToken++;$('op-viewer').hidden=true;
 $('op-empty').hidden=true;$('op-report').hidden=false;
 $('op-title').textContent=report.title;
 $('op-source').textContent=(report.platform==='chesscom'?'Chess.com':'Lichess')+' · '+report.username+(report.profile.title?' · '+report.profile.title:'');
 $('op-meta').textContent=speedName(report.filters.speed)+' · '+report.filters.days+' ngày · '+(report.filters.rated_only?'Chỉ rated':'Gồm rated/casual hoặc chưa rõ')+' · '+(report.filters.source==='pgn'?'Nhập PGN':'Ván công khai')+' · Mẫu đến '+date(report.sample_until||report.generated_at)+' · Lập lúc '+date(report.generated_at);
 const s=report.summary;
 $('op-stats').innerHTML=[['Ván trong mẫu',s.games,'Trắng '+report.by_color[0].games+' · Đen '+report.by_color[1].games],['Thắng / hòa / thua',s.wins+' / '+s.draws+' / '+s.losses,'Kết quả của đối thủ'],['Tỷ lệ thắng',percent(s.win_percent),'Chỉ tính các ván thắng'],['Điểm số',percent(s.score_percent),'Thắng 1 · Hòa ½ · Thua 0']].map(([title,value,note])=>'<div class="op-stat"><span>'+esc(title)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></div>').join('');
 $('op-warnings').innerHTML=report.warnings.map(w=>'<li>'+esc(w)+'</li>').join('');
 const skip=Object.entries(report.skipped).map(([key,n])=>({invalid_unfinished_or_variant:'PGN không hợp lệ / chưa xong / biến thể',different_player_or_illegal:'Khác nick / nước sai',outside_dates:'Ngoài thời gian',different_speed:'Khác tốc độ',casual:'Không xác nhận rated',duplicate:'Trùng ván'})[key]+': '+n);
 $('op-skipped').textContent=(skip.length?'Đã bỏ qua: '+skip.join(' · ')+'. ':'')+(report.acquisition.notes||[]).join(' ');
 $('op-breakdown').innerHTML=statsTable(report.by_color.map(r=>({...r,label:'Cầm '+colorName(r.key)})),'Màu quân')+statsTable(report.by_speed.map(r=>({...r,label:speedName(r.key)})),'Tốc độ');
 $('op-openings').innerHTML='<table><thead><tr><th>Đối thủ cầm</th><th>Khai cuộc</th><th>Ván / cùng màu</th><th>Tần suất</th><th>Điểm số</th><th>Chênh rating</th><th>Dẫn chứng</th></tr></thead><tbody>'+report.openings.slice(0,40).map(r=>'<tr><td>'+colorName(r.color)+'</td><td>'+esc(r.key)+'</td><td>'+r.games+' / '+r.color_games+'</td><td>'+percent(r.frequency_percent)+'</td><td>'+percent(r.score_percent)+'</td><td>'+esc(ratingDifference(r))+'</td><td><div class="op-evidence">'+evidence(r.evidence,12)+'</div></td></tr>').join('')+'</tbody></table>';
 $('op-observations').innerHTML=report.observations.map(o=>'<div class="op-observation"><strong>'+esc(percent(o.percent))+'</strong><h3>'+esc(o.title)+'</h3><small>'+o.count+' / '+o.sample+' ván đủ dữ liệu</small><p>'+esc(o.interpretation)+'</p><div class="op-evidence noprint">'+evidence(o.evidence,20)+'</div></div>').join('');
 $('op-eval-coverage').textContent=report.engine.evaluated_moves+' / '+report.engine.total_player_moves+' nước của đối thủ có đủ đánh giá trước/sau, trong '+report.engine.games_with_evals+' ván ('+(report.engine.games_with_local_evals||0)+' ván có phân tích local). Không dùng tỷ lệ thua để suy ra lỗi engine.';
 $('op-eval-method').textContent=report.engine.method;
 $('op-errors').innerHTML=report.engine.errors.length?report.engine.errors.slice(0,15).map(e=>'<div class="op-plan-item"><strong>'+esc(speedName(e.speed))+' · '+Math.ceil(e.ply/2)+(e.color==='black'?'… ':'. ')+esc(e.san)+'</strong><p>Giảm '+e.win_percent_loss+' điểm phần trăm theo mô hình · '+esc(e.source)+' · '+(e.depth?'độ sâu '+e.depth:'chưa ghi độ sâu')+(e.limited?' · Ước tính, cần tính sâu hơn':'')+'</p><div class="op-evidence noprint">'+evidence([e.game_id],e.ply-1)+'</div></div>').join(''):'<p class="op-help op-eval-warning">Chưa có vị trí đủ căn cứ để gắn nhãn sai lầm. Chọn ván mẫu và dùng bàn phân tích Stockfish để kiểm tra.</p>';
 $('op-plan').innerHTML=report.plan.map(p=>'<div class="op-plan-item"><h3>'+esc(p.title)+'</h3><p>'+esc(p.text)+'</p><div class="op-evidence noprint">'+evidence(p.evidence)+'</div></div>').join('');
 $('op-games-count').textContent=report.games.length;
 $('op-games').innerHTML='<table><thead><tr><th>Ngày</th><th>Trắng / Đen</th><th>Màu / tốc độ</th><th>Kết quả</th><th>Khai cuộc</th><th></th></tr></thead><tbody>'+report.games.map(g=>'<tr><td>'+esc(date(g.played_at))+'</td><td>'+esc(g.white)+'<br>'+esc(g.black)+'</td><td>'+colorName(g.color)+' · '+esc(speedName(g.speed))+'</td><td>'+esc(outcome(g.outcome))+'<small>'+esc(g.result)+'</small></td><td>'+esc(g.opening.eco+' · '+g.opening.name)+'</td><td><button type="button" data-game="'+esc(g.id)+'" data-ply="0">Xem ván</button></td></tr>').join('')+'</tbody></table>';
 $('op-edit-title').value=report.title;$('op-notes').value=report.notes;$('op-save-status').textContent='';
 $('op-pgn').href='/api/opponents/'+report.id+'/pgn';
 $('op-refresh').hidden=report.filters.source==='pgn';
 drawBranches();drawSaved();
 const url=new URL(location.href);url.searchParams.set('report',report.id);history.replaceState(null,'',url);
}
async function openReport(id){
 if(busy||!mayLeave())return;
 const token=++viewToken;status('Đang mở hồ sơ đã lưu…');
 try{const report=await api('/'+encodeURIComponent(id));if(token!==viewToken)return;render(report);status('Đã mở hồ sơ đã lưu. Không tải lại ván.');}
 catch(e){if(token===viewToken)status(e.message,true);}
}
async function collect(refresh=false){
 if(busy||!mayLeave()||(!refresh&&!$('op-form').reportValidity()))return;
 const token=++viewToken;
 const data=refresh?{...current.filters,platform:current.platform,username:current.username,refresh:true}:options();delete data.source;
 setBusy(true);status('Đang tải tuần tự các ván công khai và lập hồ sơ. Với tài khoản nhiều ván, có thể mất một lúc…');
 try{const report=await post('/collect',data);if(token!==viewToken)return;render(report);await loadSaved();status(report.cached?'Đã mở kết quả đã lưu. Bấm Cập nhật ván mới nếu cần lấy thêm dữ liệu.':'Đã lưu hồ sơ · '+report.summary.games+' ván hợp lệ.');}
 catch(e){if(token===viewToken)status(e.message,true);}
 finally{setBusy(false);}
}
async function importFile(){
 if(busy||!mayLeave()||!$('op-form').reportValidity())return;
 const file=$('op-file').files?.[0];
 if(!file){status('Chọn bộ PGN trước khi nhập.',true);return;}
 if(file.size>8*1024*1024){status('Tệp PGN lớn hơn 8 MB. Hãy tách tệp nhỏ hơn.',true);return;}
 const token=++viewToken;setBusy(true);status('Đang đọc PGN và đối chiếu nick…');
 try{const report=await post('/import',{...options(),pgn:await file.text()});if(token!==viewToken)return;render(report);await loadSaved();status('Đã lưu hồ sơ từ PGN. Không tải dữ liệu bên ngoài.');}
 catch(e){if(token===viewToken)status(e.message,true);}
 finally{setBusy(false);}
}
function boardSvg(fen){
 const board=new Chess(fen);let svg='<svg viewBox="0 0 360 360" role="img" aria-label="Thế cờ tại nước '+ply+'"><defs>'+PIECE_DEFS+'</defs>';
 for(let r=0;r<8;r++)for(let c=0;c<8;c++){
  const file=flip?7-c:c,rank=flip?r:7-r,piece=board.get('abcdefgh'[file]+(rank+1));
  svg+='<rect x="'+c*45+'" y="'+r*45+'" width="45" height="45" fill="'+((r+c)%2?'#8b9c83':'#eee9d5')+'"/>';
  if(piece)svg+='<use href="#'+piece.color+piece.type.toUpperCase()+'" x="'+c*45+'" y="'+r*45+'"/>';
  if(r===7)svg+='<text x="'+(c*45+3)+'" y="358" font-size="7" fill="#26392f">'+'abcdefgh'[file]+'</text>';
 }
 return svg+'</svg>';
}
function drawGame(){
 if(!game)return;
 ply=Math.max(0,Math.min(ply,game.moves.length));
 $('op-board').innerHTML=boardSvg(game.fens[ply]);$('op-ply').textContent=ply+' / '+game.moves.length;
 $('op-first').disabled=$('op-prev').disabled=ply===0;$('op-next').disabled=$('op-last').disabled=ply===game.moves.length;
 $('op-game-moves').innerHTML=game.moves.map((san,i)=>'<button type="button" data-move="'+(i+1)+'" aria-current="'+String(ply===i+1)+'">'+(i%2===0?(i/2+1)+'. ':'')+esc(san)+'</button>').join('');
}
async function openGame(id,at=0){
 if(!current)return;
 const report=current.id,token=++gameToken;
 $('op-viewer').hidden=false;$('op-game-status').textContent='Đang mở ván…';
 try{
  const data=await api('/'+report+'/games/'+encodeURIComponent(id));if(token!==gameToken||current?.id!==report)return;
  game=data;ply=at;flip=game.color==='black';
  $('op-game-title').textContent=game.white+' · '+game.black;$('op-game-meta').textContent=date(game.played_at)+' · '+game.time_control+' · '+game.result+' · Đối thủ cầm '+colorName(game.color);
  $('op-game-review').href='/review.html?opponent='+report+'&game='+encodeURIComponent(game.id);
  const url=sourceLink(game.url);$('op-game-source').hidden=!url;$('op-game-source').href=url||'#';
  $('op-game-status').textContent='Bàn cờ theo PGN đã kiểm tra nước hợp lệ.';drawGame();
  $('op-viewer').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
 }catch(e){if(token===gameToken){game=null;$('op-game-status').textContent=e.message;$('op-board').textContent='';$('op-game-moves').textContent='';}}
}
$('op-form').addEventListener('submit',e=>{e.preventDefault();collect();});
$('op-import').addEventListener('click',importFile);
$('op-refresh').addEventListener('click',()=>collect(true));
$('op-reload').addEventListener('click',loadSaved);$('op-search').addEventListener('input',drawSaved);
$('op-saved').addEventListener('click',e=>{const target=e.target.closest('[data-report]');if(target)openReport(target.dataset.report);});
$('op-report').addEventListener('click',e=>{const target=e.target.closest('[data-game]');if(target)openGame(target.dataset.game,Number(target.dataset.ply)||0);});
$('op-branch-color').addEventListener('change',drawBranches);$('op-branch-ply').addEventListener('change',drawBranches);
$('op-game-moves').addEventListener('click',e=>{const target=e.target.closest('[data-move]');if(target){ply=Number(target.dataset.move);drawGame();}});
$('op-first').onclick=()=>{ply=0;drawGame();};$('op-prev').onclick=()=>{ply--;drawGame();};$('op-next').onclick=()=>{ply++;drawGame();};$('op-last').onclick=()=>{ply=game?.moves.length||0;drawGame();};$('op-flip').onclick=()=>{flip=!flip;drawGame();};
$('op-recalculate').onclick=async()=>{
 if(!current||busy||!mayLeave())return;const id=current.id,token=++viewToken;setBusy(true);status('Đang ghép kết quả Stockfish đã lưu vào cùng mẫu ván…');
 try{const report=await post('/'+id+'/recalculate',{});if(token!==viewToken)return;render(report);await loadSaved();status('Đã cập nhật từ phân tích đã lưu, không tải lại ván.');}catch(e){status(e.message,true);}finally{setBusy(false);}
};
$('op-print').onclick=()=>window.print();
for(const id of ['op-notes','op-edit-title'])$(id).addEventListener('input',()=>{dirty=true;$('op-save-status').textContent='Chưa lưu thay đổi';});
$('op-save').onclick=async()=>{
 if(!current||busy)return;const id=current.id,token=viewToken;
 const title=$('op-edit-title').value.trim(),notes=$('op-notes').value;
 if(!title){$('op-save-status').textContent='Tên hồ sơ không được trống.';return;}
 $('op-save').disabled=true;
 try{await api('/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,notes})});if(token!==viewToken)return;current.title=title;current.notes=notes;$('op-title').textContent=title;dirty=$('op-notes').value!==notes||$('op-edit-title').value.trim()!==title;$('op-save-status').textContent=dirty?'Đã lưu bản trước; còn thay đổi mới chưa lưu.':'Đã lưu tên và ghi chú.';await loadSaved();}
 catch(e){$('op-save-status').textContent=e.message;}finally{$('op-save').disabled=false;}
};
$('op-delete').onclick=async()=>{
 if(!current||busy||!confirm('Xóa hồ sơ “'+current.title+'” cùng các ván trong hồ sơ? Các ván cá nhân và hồ sơ khác được giữ.'))return;
 const token=++viewToken;setBusy(true);
 try{await api('/'+current.id,{method:'DELETE'});if(token!==viewToken)return;current=null;game=null;dirty=false;gameToken++;$('op-report').hidden=true;$('op-empty').hidden=false;history.replaceState(null,'','/opponents.html');await loadSaved();status('Đã xóa hồ sơ.');}
 catch(e){status(e.message,true);}finally{setBusy(false);}
};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
await loadSaved();
const initial=new URLSearchParams(location.search).get('report');if(initial&&/^[a-f0-9]{24}$/.test(initial))await openReport(initial);
