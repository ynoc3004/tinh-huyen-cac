const REALMS = [[0, "Phàm Nhân"], [800, "Luyện Khí"], [1200, "Trúc Cơ"], [1500, "Kim Đan"], [1800, "Nguyên Anh"], [2000, "Hóa Thần"]];
const PLATFORM = { chesscom: "Chess.com", lichess: "Lichess" };
const SPEED = {
  bullet: "cờ đạn", ultrabullet: "cờ siêu đạn", blitz: "cờ chớp", rapid: "cờ nhanh",
  classical: "cờ cổ điển", daily: "cờ hằng nhật", correspondence: "cờ thư chiến",
  puzzle: "thế cờ", standard: "cờ tiêu chuẩn", chess960: "Chess960",
};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => "&#" + c.charCodeAt(0) + ";");
const platformOf = x => PLATFORM[x.platform] || x.platform;
const speedOf = x => SPEED[String(x.time_class || "").toLowerCase()] || x.time_class;

function nextStep(t) {
  const i = REALMS.findIndex(r => r[1] === t.realm);
  const nxt = REALMS[i + 1];
  if (i < 0 || !nxt) return "Đã đứng ở cảnh giới cao nhất.";
  const gap = Math.max(0, nxt[0] - Number(t.rating));
  return `Còn ${gap} điểm nữa là đột phá lên ${esc(nxt[1])}.`;
}
function realmText(t) {
  return `<p class="can-co-line">Căn cơ là ${esc(speedOf(t))} trên ${esc(platformOf(t))}, ${esc(t.rating)} điểm.</p>
    <p class="next">${nextStep(t)}</p>`;
}
const MODE_ORDER = ["bullet", "blitz", "rapid", "daily", "classical", "correspondence"];
const MAIN_MODES = 3; // đạn, chớp, nhanh luôn hiện; các mode còn lại nằm trong "xem thêm"
function gridTable(modes, byKey, cols) {
  const cell = (plat, mode) => {
    const x = byKey[plat + "/" + mode];
    if (!x) return `<td class="none">–</td>`;
    const root = x.is_can_co ? `<span class="root">căn cơ</span>` : "";
    return `<td class="${x.is_can_co ? "can-co" : ""}"><b>${esc(x.rating)}</b><small>${root}${esc(x.realm)} tầng ${esc(x.tier)}</small></td>`;
  };
  const head = `<tr><th scope="col"><span class="sr">Chế độ</span></th>${cols.map(c => `<th scope="col">${esc(PLATFORM[c])}</th>`).join("")}</tr>`;
  const body = modes.map(m => `<tr><th scope="row">${esc(SPEED[m] || m)}</th>${cols.map(c => cell(c, m)).join("")}</tr>`).join("");
  return `<table class="grid"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}
function meridians(rows) {
  // Thế cờ (puzzle) không phải mạch đấu cờ nên không đưa vào bảng này.
  const games = rows.filter(x => String(x.time_class).toLowerCase() !== "puzzle");
  if (!games.length) return "";
  const byKey = {}, plats = new Set(), modes = new Set();
  for (const x of games) {
    const m = String(x.time_class).toLowerCase();
    byKey[x.platform + "/" + m] = x;
    plats.add(x.platform);
    modes.add(m);
  }
  const rank = m => (MODE_ORDER.includes(m) ? MODE_ORDER.indexOf(m) : 99);
  const all = [...modes].sort((a, b) => rank(a) - rank(b));
  // Chế độ chính: đạn, chớp, nhanh nếu có dữ liệu; luôn giữ mạch căn cơ trong bảng chính
  const rootMode = (games.find(x => x.is_can_co) || {}).time_class;
  const main = all.filter((m, i) => i < MAIN_MODES || m === String(rootMode).toLowerCase());
  const rest = all.filter(m => !main.includes(m));
  const cols = ["lichess", "chesscom"].filter(c => plats.has(c)).concat([...plats].filter(c => !PLATFORM[c]));
  const t = gridTable(main, byKey, cols);
  const extra = rest.length
    ? `<details class="more"><summary>Xem thêm ${rest.length} chế độ</summary>${gridTable(rest, byKey, cols)}</details>`
    : "";
  return `<h2>Pháp mạch</h2>${t}${extra}`;
}
function ladder(tu) {
  const cur = REALMS.findIndex(r => r[1] === tu.realm);
  const items = REALMS.map(([min, name], i) => {
    const cls = i < cur ? "done" : (i === cur ? "now" : "");
    return `<li class="${cls}"${i === cur ? ` aria-current="step"` : ""}><span>${esc(name)}</span><span class="from">${min ? "từ " + min + " điểm" : "khởi điểm"}</span></li>`;
  }).join("");
  return `<h2>Đăng thiên lộ</h2><ol class="path">${items}</ol>`;
}

const $=id=>document.getElementById(id);
const fields=['full_name','dao_name','birth_date','birth_time','hometown','goal','notes'];
const form=$('profile-form');let ready=false,saving=false,dirty=false,realmRevision=0;
async function request(url,options){
 const r=await fetch(url,options);if(!r.ok){let message='Không kết nối được máy chủ. Thử lại sau.';try{const data=await r.json();if(typeof data.detail==='string')message=data.detail;else if(r.status===422)message='Thông tin chưa hợp lệ. Kiểm tra ngày sinh, giờ sinh và độ dài các mục.';}catch{}throw Error(message);}return r.json();
}
function identity(data){
 $('profile-name').textContent=data.dao_name||data.full_name||'Chưa ghi danh';
 $('profile-full-name').textContent=data.dao_name&&data.full_name?data.full_name:'';
 let birth='Chưa ghi';if(data.birth_date){const [y,m,d]=data.birth_date.split('-');birth=d+'/'+m+'/'+y;}if(data.birth_time)birth=(data.birth_date?birth+' · ':'')+data.birth_time;
 $('profile-birth').textContent=birth;$('profile-hometown').textContent=data.hometown||'Chưa ghi';
 $('profile-saved-at').textContent=data.updated_at?'Đã có hồ sơ':'';
}
async function loadProfile(){
 $('profile-retry').hidden=true;$('profile-fields').disabled=true;form.setAttribute('aria-busy','true');$('profile-status').textContent='Đang tải hồ sơ…';
 try{const data=await request('/api/profile');for(const key of fields)form.elements[key].value=data[key]||'';identity(data);ready=true;$('profile-fields').disabled=false;$('profile-status').textContent=data.updated_at?'Hồ sơ đã tải. Bạn có thể cập nhật và lưu lại.':'Chưa có hồ sơ. Ghi danh để bắt đầu Đạo Lộ.';}
 catch(e){$('profile-name').textContent='Chưa tải được hồ sơ';$('profile-status').textContent=e.message;$('profile-retry').hidden=false;}
 finally{form.setAttribute('aria-busy','false');}
}
form.addEventListener('input',()=>{if(ready&&!saving){dirty=true;$('profile-dirty').textContent='Có thay đổi chưa lưu';}});
form.onsubmit=async e=>{
 e.preventDefault();if(!ready||saving)return;const payload=Object.fromEntries(fields.map(key=>[key,form.elements[key].value.trim()]));for(const key of ['birth_date','birth_time'])payload[key]=payload[key]||null;
 saving=true;$('profile-fields').disabled=true;form.setAttribute('aria-busy','true');$('profile-status').textContent='Đang lưu hồ sơ…';
 try{const data=await request('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});for(const key of fields)form.elements[key].value=data[key]||'';identity(data);dirty=false;$('profile-dirty').textContent='';$('profile-saved-at').textContent='Đã lưu';$('profile-status').textContent='Đã lưu hồ sơ tu hành.';}
 catch(e){$('profile-status').textContent=e.message+' Nội dung đang nhập vẫn được giữ lại.';}
 finally{saving=false;$('profile-fields').disabled=false;form.setAttribute('aria-busy','false');}
};
$('profile-retry').onclick=loadProfile;
addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
async function loadRealms(){
 const token=++realmRevision;$('realm-retry').hidden=true;$('realm-status').textContent='Đang tải tu vi…';$('realms').setAttribute('aria-busy','true');
 try{const data=await request('/api/realm');if(token!==realmRevision)return;
  const rows=Array.isArray(data)?data:(data.mach||[]),tu=Array.isArray(data)?(data.slice().sort((a,b)=>a.rating-b.rating)[0]||null):data.tu_vi;
  $('realm-summary').innerHTML=tu?'<h3>'+esc(tu.realm)+' · tầng '+esc(tu.tier)+'</h3>'+realmText(tu):'<p>Chưa có dữ liệu tu vi. Đồng bộ ván cờ để cập nhật căn cơ.</p>';
  $('realms').innerHTML='<div>'+ (meridians(rows)||'<h2>Pháp mạch</h2><p class="empty">Chưa có rating Chess.com hoặc Lichess.</p>') +'</div><div>'+ladder(tu||{realm:null})+'</div>';
  $('realm-status').textContent='';
 }catch(e){if(token===realmRevision){$('realm-status').textContent=e.message;$('realm-retry').hidden=false;}}
 finally{if(token===realmRevision)$('realms').setAttribute('aria-busy','false');}
}
$('realm-retry').onclick=loadRealms;
$('sync').onclick=async()=>{
 const b=$('sync');b.disabled=true;$('sync-status').textContent='Đang đồng bộ Chess.com và Lichess…';
 try{const j=await request('/api/sync',{method:'POST'}),r=j.new_games||{},notes=[...Object.entries(r.errors||{}),...Object.entries(r.skipped||{})].map(([k,v])=>(PLATFORM[k]||k)+': '+v);
  $('sync-status').textContent='Ván mới: Chess.com '+(r.chesscom||0)+', Lichess '+(r.lichess||0)+(notes.length?'. '+notes.join('. '):'');await loadRealms();
 }catch(e){$('sync-status').textContent=e.message;}finally{b.disabled=false;}
};
loadProfile();loadRealms();
