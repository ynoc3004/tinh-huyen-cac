
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const say=t=>$('#msg').textContent=t;
async function api(p,m='GET',b){const r=await fetch('/api'+p,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});
 if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.detail||('Lỗi '+r.status))}return r.json()}
const tournamentPage=location.pathname==='/tournament.html';
let cur=null,currentTour=null,selectedGroup='all';
function switchTab(name){if(tournamentPage)return;document.querySelectorAll('.workspace-panel').forEach(p=>p.hidden=p.id!=='panel-'+name);document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===name);if(b.dataset.tab===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});$('#view').hidden=name!=='list';}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
if(!tournamentPage){$('#quickCreate').onclick=()=>switchTab('create');$('#goStudents').onclick=()=>switchTab('students');$('#backCreate').onclick=()=>switchTab('create');}
const statusLabel=s=>({prepare:'Chưa bắt đầu',running:'Đang diễn ra',finished:'Đã kết thúc'}[s]||s||'Chưa bắt đầu');
let tourItems=[],arenaItems=[];
function renderLists(){if(tournamentPage)return;const q=$('#tourSearch').value.trim().toLowerCase(),status=$('#statusFilter').value,arenaIDs=new Set(arenaItems.map(a=>a.id));
const filtered=items=>items.filter(x=>x.name.toLowerCase().includes(q)&&(status==='all'||x.status===status)).sort((a,b)=>({running:0,prepare:1,finished:2}[a.status]??3)-({running:0,prepare:1,finished:2}[b.status]??3)||b.id-a.id);
const cards=(items,kind)=>filtered(items).map(x=>`<li class="event-card"><div class="event-info"><a href="${kind==='arena'?'/arena-live.html?id='+x.id:'/tournament.html?id='+x.id}" ${kind==='arena'?`data-arena="${x.id}"`:`data-open="${x.id}"`}>${esc(x.name)}</a><small><span class="status ${esc(x.status)}">${esc(statusLabel(x.status))}</span>${kind==='arena'?esc(x.duration_min||60)+' phút':esc(x.date||'Giải theo vòng')}</small></div><details><summary>Tùy chọn</summary><button class="alt" data-del-${kind==='arena'?'arena':'tour'}="${x.id}" data-name="${esc(x.name)}">Xóa giải</button></details></li>`).join('')||'<li class="empty-state">Không có giải phù hợp. Bấm “Tạo giải mới” để bắt đầu.</li>';
$('#tours').innerHTML=cards(tourItems.filter(t=>!arenaIDs.has(t.id)),'tour');$('#arenas').innerHTML=cards(arenaItems,'arena');}
async function students(){ST=await api('/students');OFF=new Set([...OFF].filter(id=>ST.some(s=>s.id===id)));if($('#cnt'))$('#cnt').textContent=ST.length;renderPick();renderStudents()}
function renderStudents(){if(tournamentPage)return;const q=$('#studentSearch').value.toLowerCase();$('#studentBody').innerHTML=ST.filter(s=>(s.name+' '+(s.club||'')).toLowerCase().includes(q)).map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.rating??'—')}</td><td>${esc(s.club||'—')}</td></tr>`).join('')||'<tr><td colspan="3">Chưa có học viên phù hợp.</td></tr>';}
async function tours(){tourItems=await api('/tournaments');renderLists()}
if(!tournamentPage){$('#studentSearch').oninput=renderStudents;$('#tourSearch').oninput=renderLists;$('#statusFilter').onchange=renderLists;$('#refreshLists').onclick=()=>Promise.all([tours(),loadArenas()]).catch(e=>say(e.message));}
let eventType='classic';
function updateCreate(){$('#participantCard').hidden=eventType==='classic'&&$('#grouping').value==='manual';$('#manualGuide').hidden=!$('#participantCard').hidden;const ids=ST.filter(s=>!OFF.has(s.id)),rated=ids.filter(s=>s.rating!=null).length;$('#classicFields').hidden=eventType!=='classic';$('#arenaFields').hidden=eventType!=='arena';$('#create').hidden=eventType!=='classic';$('#acreate').hidden=eventType!=='arena';$('#create').disabled=$('#grouping').value!=='manual'&&ids.length<2;$('#acreate').disabled=ids.length<2;
$('#ratingNote').textContent=$('#mode').value==='random'?'Bốc ngẫu nhiên từ danh sách đã chọn.':rated?`${rated}/${ids.length} người có rating. Người chưa có rating được xếp cuối danh sách hạt giống.`:'Chưa có rating trong danh sách đã chọn; bốc thăm sẽ ngẫu nhiên.';
$('#selectionHint').textContent=ids.length<2?'Chọn ít nhất 2 người để tạo giải.':`Đã chọn ${ids.length} người. Có thể bỏ chọn người không tham gia.`;
$('#manualFields').hidden=$('#grouping').value!=='manual';$('#drawFields').hidden=$('#grouping').value==='manual';$('#create').textContent=$('#grouping').value==='manual'?'Tạo giải và quản lý bảng →':'Xem trước bốc thăm →';
$('#createSummary').textContent=eventType==='classic'&&$('#grouping').value==='manual'?'Tự tạo bảng · thêm người vào từng bảng sau khi tạo giải':eventType==='arena'?`${ids.length} người · Arena ${$('#adur').value||60} phút`:`${ids.length} người · ${$('#gcount').value?$('#gcount').value+' bảng':($('#size').value||8)+' người/bảng dự kiến'}`;}
if(!tournamentPage){document.querySelectorAll('[name=eventType]').forEach(r=>r.onchange=()=>{eventType=r.value;updateCreate()});['mode','size','gcount','adur','grouping'].forEach(id=>$('#'+id).addEventListener('input',updateCreate));}
if(!tournamentPage) $('#tours').onclick=e=>{const a=e.target.closest('[data-open]');if(a){e.preventDefault();location.href='/tournament.html?id='+a.dataset.open}};
async function show(id,reveal){if(!tournamentPage){location.href='/tournament.html?id='+id;return}cur=id;const t=await api('/tournaments/'+id);if(t.kind==='arena'){location.href='/arena-live.html?id='+id;return}currentTour=t;document.title=t.name+' · Tĩnh Huyền Các';TV=[];let played=0,total=0;
let html=`<header class="tour-hero"><div><p class="eyebrow">TRANG ĐIỀU HÀNH GIẢI</p><h1>${esc(t.name)}</h1><p class="muted">${esc(t.date||'Chưa đặt ngày thi đấu')} <span class="status ${esc(t.status)}">${esc(statusLabel(t.status))}</span></p></div><div class="row noprint"><button class="alt" onclick="showResults(${t.id})">Xem kết quả</button><button class="alt" onclick="tvOn()">Chiếu màn hình</button>${t.status!=='finished'?`<details class="tour-options"><summary>Tùy chọn giải</summary><button onclick="finishTour(${t.id})">Kết thúc giải</button></details>`:''}</div></header><div class="tour-stats"><div><strong>${t.groups.filter(g=>g.ord===1).length}</strong><span>Bảng thi đấu</span></div><div><strong>${new Set(t.groups.filter(g=>g.ord===1).flatMap(g=>g.players.map(p=>p.id))).size}</strong><span>Kỳ thủ</span></div><div><strong id="gameProgress">—</strong><span>Ván đã hoàn thành</span></div></div>${t.notes?`<details class="note-preview"><summary>Thể lệ / ghi chú</summary><p>${esc(t.notes)}</p></details>`:''}${infoPanel(t)}<div class="tour-toolbar noprint"><label>Theo dõi bảng<select id="groupFilter" onchange="filterGroups(this.value)"><option value="all">Tất cả các bảng</option>${t.groups.map(g=>`<option value="${g.id}" ${String(g.id)===selectedGroup?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label><div class="row"><button class="alt" onclick="doPrint('roster')">In danh sách</button><button class="alt" onclick="doPrint('pairings')">In lịch đấu</button><button class="alt" onclick="doPrint('standings')">In xếp hạng</button>${t.status!=='finished'?`<button onclick="newGroup(${t.id})">+ Thêm bảng</button>`:''}</div></div><nav class="group-jumps noprint" aria-label="Đi đến bảng">${t.groups.map(g=>`<a href="#group-${g.id}" onclick="filterGroups('all')">${esc(g.name)} <small>${g.players.length} người</small></a>`).join('')}</nav><div id="groups">`;
 for(const g of t.groups){const pr=await api(`/groups/${g.id}/pairings`),has=pr.some(p=>p.result&&p.result!=='bye'),st=has&&g.format!=='knockout'?await api(`/groups/${g.id}/standings`):[];
  total+=pr.filter(p=>p.black_id).length;played+=pr.filter(p=>p.black_id&&p.result).length;
  const nm={};g.players.forEach(p=>nm[p.id]=p.name);const rounds={};pr.forEach(p=>(rounds[p.round]??=[]).push(p));
  const open=Object.keys(rounds).find(r=>rounds[r].some(p=>p.black_id&&!p.result));TV.push({title:(g.ord===2?'':'Bảng ')+g.name,st,open,ps:open?rounds[open].map(p=>[nm[p.white_id],p.result||'–',nm[p.black_id]||'nghỉ']):[]});
  html+=`<div id="group-${g.id}" data-group-card="${g.id}" class="g ${reveal?'hid':''}"><div class="pl"><h3>${esc(g.name)} <span class="pill">${g.players.length} người · ${pr.length?pr.filter(p=>p.black_id&&!p.result).length+' ván chưa xong':'Chưa ghép cặp'}</span><small>${g.format==='swiss'?'· Thụy Sĩ':g.format==='knockout'?'· Loại trực tiếp':'· Vòng tròn'}</small></h3>${groupActions(g,pr,has)}</div><details class="group-settings noprint" ${pr.length?'':'open'}><summary>Thiết lập bảng / danh sách</summary><div class="row noprint">${g.ord===1?`<label class="field">Thể thức bảng<select data-group-format="${g.id}" data-tour="${t.id}" ${pr.length||t.status==='finished'?'disabled':''}>${formatOptions(g.format)}</select>${pr.length?'<small>Đã ghép cặp — thể thức được khóa.</small>':''}</label>`:''}<button class="alt" onclick="renameGroup(${g.id},${t.id})">Đổi tên bảng</button>${g.ord===1&&!pr.length?`<button class="alt" onclick="editGroupPlayers(${g.id},${t.id})">Chọn / thêm người (${g.players.length})</button>${!g.players.length?`<button class="alt" onclick="removeGroup(${g.id},${t.id})">Xóa bảng trống</button>`:''}`:''}</div></details>${g.ord===1&&!pr.length&&t.status!=='finished'?`<details class="noprint" ${g.players.length?'':'open'}><summary>Nhập học viên vào bảng</summary><label class="field" for="group-import-${g.id}">Mỗi dòng: tên, rating, đơn vị<textarea id="group-import-${g.id}" data-group-import="${g.id}" placeholder="Nguyễn An, 1200, CLB A&#10;Trần Bình"></textarea><small class="muted">Rating và đơn vị có thể để trống. Người mới sẽ được thêm vào danh sách học viên và bảng này cùng lúc.</small></label><button data-import-group="${g.id}" data-tour="${t.id}">Thêm vào bảng ${esc(g.name)}</button><p data-import-status="${g.id}" class="muted" role="status"></p></details>`:''}<details ${pr.length?'':'open'}><summary>Danh sách kỳ thủ (${g.players.length})</summary><ul>`+
   g.players.map(p=>`<li class="pl"><span>${esc(p.name)} <small>${p.rating??''}</small></span><select class="noprint" data-move="${p.id}" ${pr.length||g.ord!==1?'disabled':''} aria-label="Chuyển ${esc(p.name)} sang bảng khác"><option>Chuyển bảng</option>${t.groups.filter(x=>x.id!==g.id&&x.ord===1).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></li>`).join('')+'</ul></details>'+
   Object.entries(rounds).map(([r,ps])=>`<details class="pr" ${r===open?'open':''}><summary>Vòng ${r}</summary><table><tr><th>Bàn</th><th>Trắng</th><th>Kết quả</th><th>Đen</th><th class="noprint">Theo dõi ván</th></tr>`+ps.map(p=>`<tr data-game="${p.id}" data-orig="${p.black_id?(p.result||'')+'|'+(p.white_technical_errors||0)+'|'+(p.white_tactics_created||0)+'|'+(p.black_technical_errors||0)+'|'+(p.black_tactics_created||0):''}"><td>${p.board}</td><td>⚪ ${esc(nm[p.white_id])}</td><td>`+(p.black_id?`<select data-result aria-label="Kết quả bàn ${p.board}"><option value="">–</option>${['1-0','1/2','0-1'].map(v=>`<option ${p.result===v?'selected':''}>${v}</option>`).join('')}</select><span class="rs">${p.result||'–'}</span>`:'nghỉ')+`</td><td>${p.black_id?'⚫ '+esc(nm[p.black_id]):''}</td><td class="noprint">`+(p.black_id?`<details class="metrics"><summary>Chỉ số kỹ thuật / chiến thuật</summary><label>Trắng · lỗi kỹ thuật <input data-we type="number" min="0" value="${p.white_technical_errors||0}" style="width:3.8rem"></label> <label>Trắng · đòn chiến thuật <input data-wt type="number" min="0" value="${p.white_tactics_created||0}" style="width:3.8rem"></label> <label>Đen · lỗi kỹ thuật <input data-be type="number" min="0" value="${p.black_technical_errors||0}" style="width:3.8rem"></label> <label>Đen · đòn chiến thuật <input data-bt type="number" min="0" value="${p.black_tactics_created||0}" style="width:3.8rem"></label></details> <button class="alt" data-save-pair="${p.id}">${p.result?'Cập nhật':'Xác nhận'}</button>`:'')+`</td></tr>`).join('')+`</table><div class="bulk noprint"><button data-bulk="${g.id}" disabled>Xác nhận tất cả ván đã chọn kết quả (<span data-bulk-n>0</span>)</button><small class="muted">Chỉ gồm các ván vừa chọn hoặc vừa sửa kết quả/chỉ số trong vòng này.</small></div></details>`).join('')+
   (st.length?`<h4 class="st-title">Xếp hạng theo kết quả hiện có</h4>`+stTable(st):'')+'</div>'}
 if(!t.groups.length)html+='<p class="empty-state">Chưa có bảng. Bấm “+ Thêm bảng” để tạo bảng đầu tiên, rồi nhập học viên.</p>';
 $('#view').innerHTML=html+'</div>'+(t.groups.some(g=>g.ord===2)?'':'<details class="noprint"><summary>Thêm vòng chung kết (tùy chọn)</summary><div class="row"><b>Chung kết:</b> lấy <input id="pg" type="number" value="2" min="1" style="width:4rem" aria-label="Số người mỗi bảng vào chung kết"> người đầu mỗi bảng <select id="ff"><option value="knockout">Loại trực tiếp</option><option value="round_robin">Vòng tròn</option><option value="swiss">Hệ Thụy Sĩ</option></select><button id="mkfin">Lập vòng chung kết</button></div></details>');
 $('#view').scrollIntoView({behavior:'smooth',block:'start'});
 if($('#gameProgress'))$('#gameProgress').textContent=played+' / '+total;filterGroups(selectedGroup);
 if(reveal)document.querySelectorAll('.g.hid').forEach((el,i)=>setTimeout(()=>el.classList.remove('hid'),matchMedia('(prefers-reduced-motion:reduce)').matches?0:i*500))}
$('#view').onclick=async e=>{const b=e.target.closest('[data-pair]');if(!b)return;
 if(b.dataset.has==='1'&&!confirm('Ghép lại sẽ xóa các kết quả đã nhập. Tiếp tục?'))return;
 try{await api(`/groups/${b.dataset.pair}/pair${b.dataset.has==='1'?'?force=true':''}`,'POST');show(cur)}catch(err){say(err.message)}};
$('#view').onchange=async e=>{const t=e.target;try{
 if(t.dataset.move&&t.value!=='Chuyển bảng'){if(confirm('Chuyển học viên sang bảng khác? Chỉ chuyển được trước khi ghép cặp.')){await api(`/tournaments/${cur}/move`,'POST',{student_id:+t.dataset.move,group_id:+t.value});show(cur)}else show(cur)}
 }catch(err){say(err.message)}};
$('#view').addEventListener('click',async e=>{try{
 const importButton=e.target.closest('[data-import-group]');if(importButton){const gid=importButton.dataset.importGroup,box=$('[data-group-import="'+gid+'"]'),status=$('[data-import-status="'+gid+'"]');const list=parseList(box.value);if(!list.length){status.textContent='Nhập ít nhất một tên học viên.';return}importButton.disabled=true;status.textContent='Đang thêm…';try{const j=await api('/groups/'+gid+'/import-students','POST',list);await students();await show(importButton.dataset.tour);say(`Đã thêm ${j.added} người vào bảng (${j.created} học viên mới)${j.skipped?', bỏ qua '+j.skipped+' dòng đã có trong bảng':''}.`)}catch(err){status.textContent=err.message;importButton.disabled=false}return}

 const save=e.target.closest('[data-save-pair]');if(save){const box=save.closest('[data-game]'),result=box.querySelector('[data-result]')?.value;if(!result)return say('Chọn kết quả trước khi xác nhận');if(!confirm((save.textContent.includes('Cập nhật')?'Cập nhật':'Xác nhận')+' kết quả ván này?'))return;await api('/pairings/'+save.dataset.savePair,'PUT',{result,white_technical_errors:+box.querySelector('[data-we]').value||0,black_technical_errors:+box.querySelector('[data-be]').value||0,white_tactics_created:+box.querySelector('[data-wt]').value||0,black_tactics_created:+box.querySelector('[data-bt]').value||0});say('Đã lưu kết quả và chỉ số ván đấu');return show(cur)}
 if(e.target.id==='mkfin'){await api('/tournaments/'+cur+'/finals','POST',{per_group:+$('#pg').value||2,format:$('#ff').value});say('');show(cur)}
 const n=e.target.closest('[data-next]');if(n){const j=await api('/groups/'+n.dataset.next+'/next-round','POST');say(j.champion?'Nhà vô địch: '+j.champion:'');show(cur)}
 const sw=e.target.closest('[data-swiss]');if(sw){const j=await api('/groups/'+sw.dataset.swiss+'/swiss-next','POST');say('Đã tạo vòng Swiss '+j.round);show(cur)}
}catch(err){say(err.message)}});
function parseList(t){const rows=t.replace(/^\uFEFF/,'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(l=>l.split(/[,;\t]/).map(x=>x.trim().replace(/^"|"$/g,'')));
 if(rows.length&&/^(tên|ten|họ và tên|ho va ten|name|full name)$/i.test(rows[0][0]))rows.shift();
 return rows.filter(r=>r[0]).map(r=>({name:r[0],rating:parseInt(r[1])||null,club:r[2]||null}))}
async function importList(list){if(!list.length)return say('Không có học viên hợp lệ để thêm.');
 const j=await api('/students'+($('#allowDuplicates').checked?'?allow_duplicates=true':''),'POST',list);say('Đã thêm '+j.added+' học viên'+(j.skipped?', bỏ qua '+j.skipped+' dòng trùng tên và đơn vị: '+(j.duplicates||[]).map(x=>x.name).join(', ')+'. Nếu là người khác, chọn Cho phép người trùng tên rồi nhập riêng những dòng đó.':'.'));students()}
if(!tournamentPage) $('#addst').onclick=async()=>{try{await importList(parseList($('#paste').value));$('#paste').value=''}catch(e){say(e.message)}};
if(!tournamentPage) $('#csv').onchange=async e=>{try{const f=e.target.files[0];if(f)await importList(parseList(await f.text()))}catch(err){say(err.message)}e.target.value=''};
function filterGroups(value){selectedGroup=value;if(!currentTour?.groups.some(g=>String(g.id)===value))selectedGroup='all';document.querySelectorAll('[data-group-card]').forEach(el=>el.hidden=selectedGroup!=='all'&&el.dataset.groupCard!==selectedGroup);if($('#groupFilter'))$('#groupFilter').value=selectedGroup;}
const ST_COLS=[['de','ĐĐ'],['bhc1','BH-C1'],['bh','BH'],['sb','SB'],['wins','Thắng']];
const ST_LEGEND='Hệ số phụ (FIDE): ĐĐ = đối đầu giữa các kỳ thủ bằng điểm (— nếu chưa đấu đủ), BH-C1 = Buchholz bỏ điểm đối thủ thấp nhất, BH = Buchholz, SB = Sonneborn-Berger, Thắng = số ván thắng trên bàn cờ. Thứ tự áp dụng: Thụy Sĩ ĐĐ › BH-C1 › BH › SB › Thắng; Vòng tròn ĐĐ › SB › Thắng › BH-C1 › BH.';
function stCell(s,k){const v=s[k];return v===null||v===undefined?'—':v}
function stTable(st,opt={}){return `<table class="st"><thead><tr><th>#</th><th>Tên</th><th>Điểm</th>${ST_COLS.map(c=>`<th>${c[1]}</th>`).join('')}</tr></thead><tbody>`+st.map((s,i)=>`<tr${opt.boldFirst&&i===0?' style="font-weight:bold"':''}><td>${s.rank}</td><td>${esc(s.name)}</td><td>${s.points}</td>${ST_COLS.map(c=>`<td>${stCell(s,c[0])}</td>`).join('')}</tr>`).join('')+`</tbody></table><p class="muted st-legend">${ST_LEGEND}</p>`}

function bulkSig(tr){const v=n=>+tr.querySelector(n)?.value||0;return [tr.querySelector('[data-result]')?.value||'',v('[data-we]'),v('[data-wt]'),v('[data-be]'),v('[data-bt]')].join('|')}
function bulkRows(box){return [...box.querySelectorAll('tr[data-game]')].filter(tr=>tr.querySelector('[data-result]')&&tr.querySelector('[data-result]').value&&bulkSig(tr)!==tr.dataset.orig)}
function bulkRefresh(box){if(!box)return;const dirty=new Set(bulkRows(box));box.querySelectorAll('tr[data-game]').forEach(tr=>tr.classList.toggle('dirty',dirty.has(tr)));const b=box.querySelector('[data-bulk]');if(b){b.disabled=!dirty.size;b.querySelector('[data-bulk-n]').textContent=dirty.size}}
$('#view').addEventListener('change',e=>bulkRefresh(e.target.closest&&e.target.closest('details.pr')));
$('#view').addEventListener('input',e=>bulkRefresh(e.target.closest&&e.target.closest('details.pr')));
$('#view').addEventListener('click',async e=>{const b=e.target.closest&&e.target.closest('[data-bulk]');if(!b)return;try{const box=b.closest('details.pr'),rows=bulkRows(box);if(!rows.length)return say('Chưa có ván nào cần xác nhận');if(!confirm('Xác nhận kết quả '+rows.length+' ván trong vòng này?'))return;const num=(tr,n)=>+tr.querySelector(n).value||0;b.disabled=true;await api('/groups/'+b.dataset.bulk+'/results/bulk','PUT',{items:rows.map(tr=>({id:+tr.dataset.game,result:tr.querySelector('[data-result]').value,white_technical_errors:num(tr,'[data-we]'),black_technical_errors:num(tr,'[data-be]'),white_tactics_created:num(tr,'[data-wt]'),black_tactics_created:num(tr,'[data-bt]')}))});say('Đã xác nhận '+rows.length+' ván');show(cur)}catch(err){say(err.message);b.disabled=false}});
async function doPrint(mode){try{if(!cur)return say('Mở một giải trước khi in.');const t=await api('/tournaments/'+cur);const groups=t.groups.filter(g=>selectedGroup==='all'||String(g.id)===selectedGroup);let sheet=`<header><p>TĨNH HUYỀN CÁC · GIẢI CỜ VUA</p><h1>${esc(t.name)}</h1><h2>${{roster:'Danh sách kỳ thủ',pairings:'Lịch thi đấu',standings:t.status==='finished'?'Bảng xếp hạng cuối':'Bảng xếp hạng tạm thời'}[mode]||'Bảng xếp hạng'}</h2><p>${esc(t.date||'')} · ${esc(statusLabel(t.status))}</p>${t.notes?`<p class="print-notes">${esc(t.notes)}</p>`:''}</header>`;
const results=mode==='standings'?await api('/tournaments/'+cur+'/results'):null;
for(const g of groups){const names=Object.fromEntries(g.players.map(p=>[p.id,p.name]));sheet+=`<section class="print-group"><h3>${esc(g.name)} · ${g.format==='swiss'?'Swiss':g.format==='knockout'?'Loại trực tiếp':'Vòng tròn'} · ${g.players.length} kỳ thủ</h3>`;
if(mode==='roster'){sheet+='<table><thead><tr><th>STT</th><th>Họ tên</th><th>Rating</th></tr></thead><tbody>'+g.players.map((p,i)=>`<tr><td>${i+1}</td><td>${esc(p.name)}</td><td>${esc(p.rating??'—')}</td></tr>`).join('')+'</tbody></table>';if(!g.players.length)sheet+='<p>Chưa có kỳ thủ.</p>'}
else if(mode==='pairings'){const ps=await api('/groups/'+g.id+'/pairings');sheet+='<table><thead><tr><th>Vòng</th><th>Bàn</th><th>Trắng</th><th>Kết quả</th><th>Đen</th></tr></thead><tbody>'+ps.map(p=>`<tr><td>${p.round}</td><td>${p.black_id?p.board:'—'}</td><td>${esc(names[p.white_id]||p.white_id)}</td><td>${p.black_id?esc(p.result||'—'):'Nghỉ'}</td><td>${p.black_id?esc(names[p.black_id]||p.black_id):'—'}</td></tr>`).join('')+'</tbody></table>';if(!ps.length)sheet+='<p>Chưa ghép cặp.</p>'}
else{const r=results.groups.find(x=>x.group_id===g.id);if(r?.champion)sheet+='<p>Nhà vô địch: '+esc(r.champion)+'</p>';sheet+='<table><thead><tr><th>Hạng</th><th>Họ tên</th><th>Điểm</th>'+ST_COLS.map(c=>`<th>${c[1]}</th>`).join('')+'</tr></thead><tbody>'+(r?.standings||[]).map(p=>`<tr><td>${p.rank}</td><td>${esc(p.name)}</td><td>${p.points}</td>${ST_COLS.map(c=>`<td>${stCell(p,c[0])}</td>`).join('')}</tr>`).join('')+'</tbody></table>'+(r?.standings?.length?`<p class="print-notes">${ST_LEGEND}</p>`:'');if(!r?.standings.length)sheet+='<p>Chưa có kết quả.</p>'}
sheet+='</section>'}$('#printSheet').innerHTML=sheet;document.body.dataset.print='sheet';await document.fonts?.ready;print();}catch(e){say(e.message);delete document.body.dataset.print}}
addEventListener('afterprint',()=>{delete document.body.dataset.print});
let TV=[],tvTimer,tvI=0;
function tvShow(){const g=TV[tvI%TV.length];tvI++;$('#tv').innerHTML='<h2>'+esc(g.title)+'</h2><div class="cols"><div>'+(g.open?'<h3>Vòng '+g.open+'</h3><table>'+g.ps.map(p=>'<tr><td>'+esc(p[0])+'</td><td>'+esc(p[1])+'</td><td>'+esc(p[2])+'</td></tr>').join('')+'</table>':'')+'</div><div>'+(g.st.length?'<h3>Xếp hạng</h3><table>'+g.st.map(s=>'<tr><td>'+s.rank+'</td><td>'+esc(s.name)+'</td><td>'+s.points+'</td><td>'+(s.sb??'')+'</td></tr>').join('')+'</table>':'')+'</div></div><small>Bấm hoặc nhấn Esc để thoát</small>'}
function tvOn(){if(!TV.length)return say('Hãy mở một giải trước.');tvI=0;tvShow();$('#tv').hidden=false;tvTimer=setInterval(tvShow,10000);$('#tv').requestFullscreen?.().catch(()=>{})}
function tvOff(){clearInterval(tvTimer);$('#tv').hidden=true;if(document.fullscreenElement)document.exitFullscreen()}
$('#tv').onclick=tvOff;addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#tv').hidden)tvOff()});
let ST=[],PV=null,OFF=new Set(),tm=[];
function renderPick(){if(tournamentPage)return;const q=($('#pq').value||'').toLowerCase();$('#npick').textContent=(ST.length-OFF.size)+' / '+ST.length;
 $('#plist').innerHTML=ST.filter(s=>(s.name+' '+(s.club||'')).toLowerCase().includes(q)).map(s=>`<label><input type="checkbox" data-sel="${s.id}" ${OFF.has(s.id)?'':'checked'}> <span>${esc(s.name)} <small>${s.rating==null?'Chưa có rating':'Rating '+s.rating}${s.club?' · '+esc(s.club):''}</small></span></label>`).join('')||'<p class="muted">Chưa có người phù hợp. Thêm học viên hoặc đổi từ khóa tìm kiếm.</p>';updateCreate()}
if(!tournamentPage) $('#plist').onchange=e=>{const i=+e.target.dataset.sel;e.target.checked?OFF.delete(i):OFF.add(i);renderPick()};
if(!tournamentPage){$('#pq').oninput=renderPick;$('#pall').onclick=()=>{OFF.clear();renderPick()};$('#pnone').onclick=()=>{ST.forEach(s=>OFF.add(s.id));renderPick()};}
async function doDraw(seed){try{const ids=ST.map(s=>s.id).filter(i=>!OFF.has(i));if(ids.length<2)return say('Cần chọn ít nhất 2 học viên.');
 const j=await api('/draw','POST',{student_ids:ids,group_size:+$('#size').value||8,group_count:+$('#gcount').value||null,mode:$('#mode').value,avoid_club:$('#avoid').checked,seed:seed??($('#seed').value!==''?+$('#seed').value:null)});
 PV={name:$('#tname').value||'Giải mới',notes:$('#tourNotes').value,seed:j.seed,mode:$('#mode').value,groups:j.groups.map(g=>({...g}))};say('');switchTab('list');pvRender(true);$('#view').scrollIntoView({behavior:'smooth',block:'start'})}catch(e){say(e.message)}}
if(!tournamentPage) $('#create').onclick=async()=>{if($('#grouping').value!=='manual')return doDraw();try{const names=$('#groupNames').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);const j=await api('/tournaments/from-draw','POST',{name:$('#tname').value||'Giải mới',mode:'manual',groups:names.map(()=>[]),group_names:names,notes:$('#tourNotes').value});say('Đã tạo giải. Thêm người vào từng bảng khi sẵn sàng.');await show(j.tournament_id);await tours()}catch(e){say(e.message)}};
function pvRender(anim){const by={};ST.forEach(s=>by[s.id]=s);let conf=0,total=0;tm.forEach(clearTimeout);tm=[];
 const cols=PV.groups.map((g,gi)=>{const cnt={};g.ids.forEach(i=>{const c=by[i]?.club;if(c)cnt[c]=(cnt[c]||0)+1});Object.values(cnt).forEach(n=>conf+=n*(n-1)/2);total+=g.ids.length;
  return `<div class="g"><h3><input data-group-name="${gi}" value="${esc(g.name)}" aria-label="Tên bảng" style="width:10rem"> <small>(${g.ids.length})</small></h3><label class="field">Thể thức bảng<select data-preview-format="${gi}">${formatOptions(g.format||'round_robin')}</select></label><ul>`+g.ids.map((i,k)=>{const s=by[i]||{},bad=s.club&&cnt[s.club]>1;
   return `<li class="pl ${anim?'dl':''}" data-k="${k}" data-g="${gi}"><span>${esc(s.name)} <small>${s.rating??''} ${esc(s.club||'')}</small>${bad?' <b title="Cùng đơn vị với người khác trong bảng" aria-label="Trùng đơn vị">⚠</b>':''}</span><select class="noprint" data-mv="${i}" data-from="${gi}" aria-label="Chuyển ${esc(s.name)} sang bảng khác"><option>Chuyển bảng</option>${PV.groups.map((x,xi)=>xi===gi?'':`<option value="${xi}">${esc(x.name)}</option>`).join('')}</select></li>`}).join('')+'</ul></div>'}).join('');
 $('#view').innerHTML=`<h2>Kết quả bốc thăm <small>mã ${PV.seed}</small></h2><p>${conf?conf+' cặp cùng đơn vị đang chung bảng (đánh dấu ⚠). Bạn có thể chuyển bảng thủ công hoặc bốc lại.':'Không có ai cùng đơn vị chung bảng.'}</p>
 <div class="row noprint"><button id="redraw">Bốc lại</button><button class="alt" id="skipanim">Bỏ qua hiệu ứng</button><button id="commit">Chốt và tạo giải</button></div><div id="groups">${cols}</div>`;
 if(anim){const li=[...document.querySelectorAll('li.dl')].sort((a,b)=>a.dataset.k-b.dataset.k||a.dataset.g-b.dataset.g),reduce=matchMedia('(prefers-reduced-motion:reduce)').matches,step=(reduce||total>150)?0:Math.max(40,Math.min(400,7000/total));
  li.forEach((el,i)=>tm.push(setTimeout(()=>el.classList.add('on'),i*step)))}}
$('#view').addEventListener('click',async e=>{const id=e.target.id;try{
 if(id==='redraw')doDraw(Math.floor(Math.random()*2**31));
 if(id==='skipanim'){tm.forEach(clearTimeout);document.querySelectorAll('li.dl').forEach(el=>el.classList.add('on'))}
 if(id==='commit'&&PV){const j=await api('/tournaments/from-draw','POST',{name:PV.name,seed:PV.seed,mode:PV.mode,group_formats:PV.groups.map(g=>g.format||'round_robin'),groups:PV.groups.map(g=>g.ids),group_names:PV.groups.map(g=>g.name),notes:PV.notes||''});PV=null;say('Đã tạo giải.');await show(j.tournament_id);tours()}
}catch(err){say(err.message)}});
$('#view').addEventListener('change',e=>{const t=e.target;if(t.dataset.previewFormat!==undefined&&PV){PV.groups[+t.dataset.previewFormat].format=t.value;return}if(t.dataset.groupName!==undefined&&PV){PV.groups[+t.dataset.groupName].name=t.value.trim()||'Bảng '+(+t.dataset.groupName+1);return}if(!t.dataset.mv||!PV||t.value==='Chuyển bảng')return;
 const id=+t.dataset.mv,from=+t.dataset.from;PV.groups[from].ids=PV.groups[from].ids.filter(x=>x!==id);PV.groups[+t.value].ids.push(id);pvRender(false)});

async function showResults(tid){try{selectedGroup='all';
 const j=await api('/tournaments/'+tid+'/results');
 let html=`<h2>Bảng kết quả · ${esc(j.name)}</h2><p class="noprint"><button class="alt" onclick="show(${tid})">← Quay lại giải</button> <button class="alt" onclick="doPrint('standings')">In</button></p><div id="groups">`;
 for(const g of j.groups){
  const label=g.name;
  const fmt=g.format==='swiss'?'Thụy Sĩ':g.format==='knockout'?'Loại trực tiếp':'Vòng tròn';
  html+=`<div class="g"><h3>${esc(label)} <small>· ${fmt}</small></h3>`;
  if(!g.standings.length){html+=`<p><em>Chưa có kết quả.</em></p></div>`;continue}
  html+=stTable(g.standings)+`</div>`;
 }
 $('#view').innerHTML=html+'</div>';
 say('');
}catch(e){say(e.message)}}
async function finishTour(tid){try{
 if(!confirm('Kết thúc giải và hiện bảng kết quả cuối?'))return;
 const j=await api('/tournaments/'+tid+'/finish','POST');selectedGroup='all';
 let html=`<h2>🏆 Kết quả cuối · ${esc(j.name)}</h2><p class="noprint"><button class="alt" onclick="show(${tid})">← Quay lại giải</button> <button class="alt" onclick="doPrint('standings')">In bảng xếp hạng</button></p><div id="groups">`;
 for(const g of j.groups){
  const label=g.name;
  const fmt=g.format==='swiss'?'Thụy Sĩ':g.format==='knockout'?'Loại trực tiếp':'Vòng tròn';
  html+=`<div class="g"><h3>${esc(label)} <small>· ${fmt}</small></h3>`;
  if(g.champion)html+=`<p><b>Nhà vô địch: ${esc(g.champion)}</b></p>`;
  if(!g.standings.length){html+=`<p><em>Chưa có kết quả.</em></p></div>`;continue}
  html+=stTable(g.standings,{boldFirst:true})+`</div>`;
 }
 $('#view').innerHTML=html+'</div>';
 say('Đã kết thúc giải.');
 tours();
}catch(e){say(e.message)}}


// ---- Arena ----
async function loadArenas(){arenaItems=await api('/arenas');renderLists()}
if(!tournamentPage){
$('#acreate').onclick=async()=>{try{
  const ids=ST.map(s=>s.id).filter(i=>!OFF.has(i));
  if(ids.length<2)return say('Chọn ít nhất 2 người tham gia.');
  const j=await api('/arenas','POST',{name:$('#aname').value||'Đấu trường',duration_min:+$('#adur').value||60,student_ids:ids});
  if($('#tourNotes').value)await api('/tournaments/'+j.tournament_id,'PATCH',{notes:$('#tourNotes').value});
  say('Đã tạo đấu trường.');$('#aname').value='';
  location.href='/arena-live.html?id='+j.tournament_id;
}catch(e){say(e.message)}};
}
if(!tournamentPage) $('#arenas').onclick=e=>{const a=e.target.closest('[data-arena]');if(a){e.preventDefault();location.href='/arena-live.html?id='+a.dataset.arena}};

function infoPanel(t){return `<details class="card tour-edit noprint"><summary>Chỉnh sửa thông tin giải / thể lệ</summary><label class="field">Tên giải<input id="editTourName" value="${esc(t.name)}"></label><label class="field">Ngày / thời gian<input id="editTourDate" value="${esc(t.date||'')}" placeholder="Ví dụ: 10/10/2026, 8:00"></label><label class="field">Thể lệ và ghi chú<textarea id="editTourNotes">${esc(t.notes||'')}</textarea></label><button onclick="saveTourInfo(${t.id})">Lưu thông tin</button></details>`;}
async function saveTourInfo(tid){try{await api('/tournaments/'+tid,'PATCH',{name:$('#editTourName').value,date:$('#editTourDate').value,notes:$('#editTourNotes').value});say('Đã lưu thông tin giải.');tours()}catch(e){say(e.message)}}
function groupActions(g,pr,has){if(g.format==='knockout')return `<button class="noprint" data-next="${g.id}">${pr.length?'Vòng tiếp theo':'Bốc thăm nhánh đấu'}</button>`;const pair=`<button class="noprint ${pr.length?'alt':''}" data-pair="${g.id}" data-has="${has?1:0}">${pr.length?'Ghép lại từ đầu':g.format==='swiss'?'Ghép vòng 1':'Ghép cặp'}</button>`;if(!pr.length)return pair;return `<div class="row noprint">${g.format==='swiss'?`<button data-swiss="${g.id}" ${pr.some(p=>p.black_id&&!p.result)?'disabled title="Nhập đủ kết quả vòng hiện tại trước"':''}>Ghép vòng Swiss tiếp</button>`:''}<details class="tour-options"><summary>Tùy chọn lịch đấu</summary>${pair}</details></div>`;}
function formatOptions(fmt){return `<option value="round_robin" ${fmt==='round_robin'?'selected':''}>Vòng tròn</option><option value="swiss" ${fmt==='swiss'?'selected':''}>Hệ Thụy Sĩ (Swiss)</option>`;}
$('#view').addEventListener('change',async e=>{const el=e.target;if(!el.dataset.groupFormat)return;el.disabled=true;try{await api('/groups/'+el.dataset.groupFormat,'PATCH',{format:el.value});await show(el.dataset.tour);say('Đã lưu thể thức riêng cho bảng.')}catch(err){say(err.message);await show(el.dataset.tour)}});
async function newGroup(tid){const name=prompt('Tên bảng (ví dụ U6, U7). Để trống để tự đánh số:');if(name===null)return;try{await api('/tournaments/'+tid+'/groups','POST',{name});await show(tid);say('Đã thêm bảng. Chọn người vào bảng khi sẵn sàng.')}catch(e){say(e.message)}}
async function removeGroup(gid,tid){if(!confirm('Xóa bảng trống này?'))return;try{await api('/groups/'+gid,'DELETE');await show(tid)}catch(e){say(e.message)}}
async function renameGroup(gid,tid){const name=prompt('Nhập tên mới cho bảng, ví dụ U6:');if(name===null)return;try{await api('/groups/'+gid,'PATCH',{name});await show(tid)}catch(e){say(e.message)}}
async function editGroupPlayers(gid,tid){try{const t=await api('/tournaments/'+tid);const g=t.groups.find(g=>g.id===gid);const selected=new Set(g.players.map(p=>p.id)),busy=new Set(t.groups.filter(g=>g.id!==gid&&g.ord===1).flatMap(g=>g.players.map(p=>p.id)));const all=await api('/students');$('#rosterTitle').textContent='Người tham gia · '+g.name;$('#rosterBody').innerHTML=all.map(p=>`<label class="check"><input type="checkbox" data-roster="${p.id}" ${selected.has(p.id)?'checked':''} ${busy.has(p.id)?'disabled':''}>${esc(p.name)} ${busy.has(p.id)?'<small>· Đã ở bảng khác</small>':''}</label>`).join('')||'<p>Chưa có học viên. Thêm học viên ở mục Học viên trước.</p>';$('#rosterSave').onclick=async()=>{try{const ids=[...document.querySelectorAll('[data-roster]:checked')].map(p=>+p.dataset.roster);await api('/groups/'+gid+'/players','PUT',{student_ids:ids});$('#rosterDialog').close();await show(tid);say('Đã lưu danh sách bảng.')}catch(e){say(e.message)}};$('#rosterDialog').showModal()}catch(e){say(e.message)}}
$('#rosterClose').onclick=()=>$('#rosterDialog').close();
async function deleteWithPassword(kind, id, name){
  const pw=prompt('Nhập mật khẩu để xóa «'+(name||'')+'»:');
  if(pw==null)return;
  if(!pw)return say('Cần nhập mật khẩu');
  try{
    const path=kind==='arena'?('/arenas/'+id+'/delete'):('/tournaments/'+id+'/delete');
    await api(path,'POST',{password:pw});
    say('Đã xóa «'+(name||'')+'»');
    if(kind==='arena')loadArenas(); else tours();
    if(String(cur)===String(id))$('#view').innerHTML='';
  }catch(e){say(e.message)}
}
$('#tours')?.addEventListener('click',e=>{
  const b=e.target.closest('[data-del-tour]');
  if(b){e.preventDefault();e.stopPropagation();deleteWithPassword('tour',b.dataset.delTour,b.dataset.name)}
});
$('#arenas')?.addEventListener('click',e=>{
  const b=e.target.closest('[data-del-arena]');
  if(b){e.preventDefault();e.stopPropagation();deleteWithPassword('arena',b.dataset.delArena,b.dataset.name)}
});

async function _boot(){try{if(tournamentPage){const id=new URLSearchParams(location.search).get('id');if(!id||!/^\d+$/.test(id)){say('Thiếu mã giải. Quay về danh sách để chọn giải.');return}await show(id)}else await Promise.all([students(),tours(),loadArenas()])}catch(e){say('Không mở được dữ liệu: '+e.message)}}
_boot();
