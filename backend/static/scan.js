import {Chess} from "/vendor/chess.js";
import {PIECE_DEFS} from "/vendor/pieces.js?v=paint-2";
const $=id=>document.getElementById(id),id=Number(new URLSearchParams(location.search).get("id"));
let page=1,total=1,state={page:1,note:"",bookmark:null,model:""},busy=false,scanning=false,probing=false,loadingScanModels=false,loaded=false,uploading=false;
function status(t){$("status").textContent=t;}
async function api(path,body,method="POST"){
 const r=await fetch("/api/library/translation/"+path,body===undefined?{}:{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const data=await r.json();if(!r.ok){const error=Error(r.status===401?"Tàng Kinh Các đang khóa. Mở khóa ở trang thư viện rồi tải lại.":typeof data.detail==="string"?data.detail:"Không thực hiện được thao tác.");error.status=r.status;throw error;}
 return data;
}
function controls(){
 const blocked=busy||scanning||probing||uploading;
 for(const name of ["scan-page","scan-again"])$(name).disabled=blocked||loadingScanModels||!loaded;
 $("scan-model").disabled=blocked||loadingScanModels;$("scan-refresh").disabled=blocked||loadingScanModels;$("scan-probe").disabled=blocked||loadingScanModels||!loaded||!$("scan-model").value;
 $("books").disabled=blocked;$("upload").disabled=blocked;
 for(const name of ["page","bookmark","return","save-note","note"])$(name).disabled=blocked||!loaded;
 $("prev").disabled=blocked||!loaded||page<=1;$("next").disabled=blocked||!loaded||page>=total;
 $("scan-download").hidden=!loaded;$("page-image-link").hidden=!loaded;
 $("scan-page").textContent=scanning?"Đang quét…":"✦ Quét trang "+page;
 $("scan-section").setAttribute("aria-busy",String(scanning));
}
async function save(){state={...state,page,note:$("note").value};await api(id+"/state",state,"PUT");}
function download(text,name,type="text/plain"){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const chess=new Chess();let flip=false,selected=null,reviewSquares=new Set(),bookPosition="";
function showBoard(){ $("board-stage").hidden=false;$("board-empty").hidden=true; }
$("restore-position").onclick=()=>{if(!bookPosition)return;stopScanEdit();chess.load(bookPosition);selected=null;reviewSquares.clear();render();$("position").value=bookPosition;$("board-status").textContent="Đã trở về thế cờ trong sách.";};
const defs=document.createElementNS("http://www.w3.org/2000/svg","svg");defs.setAttribute("width","0");defs.setAttribute("height","0");defs.style.position="absolute";defs.innerHTML="<defs>"+PIECE_DEFS+"</defs>";document.body.append(defs);
function render(){
 $("board").replaceChildren();const ranks=flip?[1,2,3,4,5,6,7,8]:[8,7,6,5,4,3,2,1],files=flip?"hgfedcba":"abcdefgh";
 const legal=selected?chess.moves({square:selected,verbose:true}).map(m=>m.to):[];
 for(const r of ranks)for(const f of files){
  const sq=f+r,p=chess.get(sq),b=document.createElement("button");b.className="square"+(("abcdefgh".indexOf(f)+r)%2===1?" dark":"")+(selected===sq?" selected":"")+(legal.includes(sq)?" target":"")+(reviewSquares.has(sq)?" needs-review":"");
  b.setAttribute("aria-label",sq+(p?" "+p.color+p.type:""));b.title=sq;
  if(p)b.innerHTML='<svg viewBox="0 0 45 45" aria-hidden="true"><use href="#'+p.color+p.type.toUpperCase()+'"/></svg>';
  b.onclick=()=>move(sq);$("board").append(b);
 }
 $("turn").textContent=(chess.turn()==="w"?"Trắng":"Đen")+" đi"+(chess.isCheck()?" · Chiếu":"")+(chess.isGameOver()?" · Kết thúc":"");
 $("moves").textContent=chess.history().join(" · ");
}
function move(sq){
 if(editingScan){const v=$("scan-piece").value;if(v)chess.put({color:v[0],type:v[1].toLowerCase()},sq);else chess.remove(sq);selected=null;render();$("position").value=chess.fen();return;}
 if(selected){try{
 const candidates=chess.moves({square:selected,verbose:true}).filter(m=>m.to===sq);let promotion="q";
 if(candidates.some(m=>m.promotion)){promotion=(prompt("Phong cấp: q (Hậu), r (Xe), b (Tượng), n (Mã)","q")||"").toLowerCase();if(!["q","r","b","n"].includes(promotion))return;}
 const m=chess.move({from:selected,to:sq,promotion});if(m){selected=null;reviewSquares.clear();render();return;}
 }catch{}}
 const p=chess.get(sq);selected=p&&p.color===chess.turn()?sq:null;render();
}
$("undo").onclick=()=>{if(editingScan)return;chess.undo();selected=null;render();};$("flip").onclick=()=>{flip=!flip;render();};
$("reset").onclick=()=>{stopScanEdit();chess.reset();selected=null;reviewSquares.clear();showBoard();render();};
$("load-position").onclick=()=>{try{let text=$("position").value.trim();const trial=new Chess();if(text.split("/").length===8&&!text.includes("\n")){if(!text.includes(" "))text+=" w - - 0 1";trial.load(text);}else trial.loadPgn(text);if(!text)throw Error();stopScanEdit();chess.loadPgn(trial.pgn());selected=null;reviewSquares.clear();showBoard();render();$("board-status").textContent="Đã mở thế cờ / ván đấu. Kiểm tra lượt đi và quân với sách."; }catch{$("board-status").textContent="FEN hoặc PGN không hợp lệ. Kiểm tra ký hiệu quân và nước đi.";}};
$("scan-import").onclick=()=>{$("board-options").open=true;$("position-panel").open=true;$("position").focus();$("position-panel").scrollIntoView({behavior:"smooth",block:"nearest"});};
$("import-pgn").onclick=()=>$("pgn-file").click();
$("pgn-file").onchange=async()=>{const file=$("pgn-file").files[0];if(!file)return;try{if(file.size>2*1024*1024)throw Error("Chọn file PGN/FEN tối đa 2 MB.");$("position").value=await file.text();$("position-panel").open=true;$("load-position").click();}catch(e){$("board-status").textContent=e.message;}finally{$("pgn-file").value="";}};
$("download-pgn").onclick=()=>download(chess.pgn(),"thu-phong-thuc-hanh.pgn");render();
let scannedBoards=[],editingScan=false;
function stopScanEdit(){editingScan=false;$("scan-edit").textContent="Sửa quân";$("scan-edit").setAttribute("aria-pressed","false");}
function clearScan(){scannedBoards=[];bookPosition="";$("restore-position").disabled=true;$("board-stage").hidden=true;$("board-empty").hidden=false;$("board-status").textContent="";$("position").value="";$("scan-results").replaceChildren();$("scan-status").textContent="Bấm quét để tìm các hình bàn cờ trên trang.";$("scan-again").hidden=true;$("scan-editor").hidden=true;$("scan-editor").open=false;$("scan-selected").textContent="Bàn cờ thực hành";stopScanEdit();}
const LOCAL_SCAN="local:chessvision";
function scanEngine(){return $("scan-model").value&&$("scan-model").value!==LOCAL_SCAN?"gemini":"local";}
let scanRevision=0;
async function openScans(){const revision=++scanRevision,requestedPage=page,engine=scanEngine();try{const data=await api(id+"/study/boards?page="+page+"&engine="+engine);if(revision!==scanRevision||requestedPage!==page||engine!==scanEngine()||scanning||!loaded)return;if(data.boards!==null)showScans(data);else if(!data.available)$("scan-status").textContent=data.message||"Bộ quét chưa sẵn sàng. Mở mục Bộ quét để kiểm tra.";}catch(e){if(revision===scanRevision)$("scan-status").textContent=e.message;}}
function showScans(data){
 scannedBoards=data.boards||[];$("scan-results").replaceChildren();$("scan-again").hidden=false;
 $("scan-status").textContent=scannedBoards.length?"Tìm thấy "+scannedBoards.length+" hình · "+(data.engine==="local"?"Local · ":"Gemini · ")+(data.cached?"đã lưu":"vừa quét")+". Chọn hình để mở và kiểm tra quân.":"Không nhận diện được hình bàn cờ trên trang này. Thử Chessvision.ai hoặc nhập FEN/PGN nếu sách có hình.";
 scannedBoards.forEach((b,i)=>{const card=document.createElement("button");card.type="button";card.className="scan-card";card.setAttribute("aria-pressed","false");const img=document.createElement("img");img.src=b.image;img.alt="Hình bàn cờ "+(i+1)+" từ trang "+page;const label=document.createElement("span");label.textContent="Thế "+(i+1)+(b.label?" · "+b.label:"");const note=document.createElement("small");note.textContent=b.warning||"";card.title=b.warning||"Mở thế cờ trên bàn thực hành";card.append(img,label,note);card.onclick=()=>openScan(i,card);$("scan-results").append(card);});
}
function openScan(i,card){
 if(!loaded||busy||scanning)return;const b=scannedBoards[i];stopScanEdit();
 document.querySelectorAll(".scan-card").forEach(c=>{c.classList.toggle("active",c===card);c.setAttribute("aria-pressed",String(c===card));});
 $("scan-editor").hidden=false;$("scan-editor").open=false;$("scan-selected").textContent="Thế "+(i+1)+" · trang "+page;$("scan-turn").value=b.turn==="b"?"b":"w";
 if(!b.placement){bookPosition="";$("restore-position").disabled=true;$("board-stage").hidden=true;$("board-empty").hidden=false;$("scan-status").textContent="Hình này chưa đọc được quân. Nhập FEN đúng từ sách trong mục Nhập thế cờ.";$("scan-editor").hidden=true;return;}
 const fen=b.placement+" "+$("scan-turn").value+" - - 0 1";
 try{const trial=new Chess(fen);chess.load(trial.fen());selected=null;flip=b.orientation==="black";reviewSquares=new Set(b.review_squares||[]);bookPosition=trial.fen();$("restore-position").disabled=false;showBoard();render();$("position").value=fen;$("scan-status").textContent="Đã mở thế "+(i+1)+(b.turn==="unknown"?" · chưa rõ lượt đi, tạm chọn Trắng.":".")+" Kiểm tra quân trước khi đánh."+(reviewSquares.size?" Các ô viền vàng cần đối chiếu; mở Hiệu đính để sửa.":"");}
 catch{bookPosition="";$("restore-position").disabled=true;$("board-stage").hidden=true;$("board-empty").hidden=false;$("position").value=fen;$("scan-editor").hidden=true;$("scan-status").textContent="FEN nhận diện chưa hợp lệ. Sửa FEN trong mục Nhập thế cờ rồi mở lại.";}
}
async function scanPage(force=false){
 if(busy||scanning||probing||!loaded)return;scanRevision++;scanning=true;controls();$("scan-status").textContent=scanEngine()==="local"?"Đang nhận diện hình bàn cờ trên CPU · trang "+page+"…":"Đang gửi ảnh trang "+page+" tới Gemini… Nếu tạm quá tải, tự thử lại tối đa 2 lần.";
 try{const data=await api(id+"/study/boards",{page,force,model:$("scan-model").value});if(loaded)showScans(data);}catch(e){$("scan-status").textContent=e.message;$("board-options").open=true;document.querySelector(".scan-settings").open=true;}finally{scanning=false;controls();}
}
$("scan-page").onclick=()=>scanPage();$("scan-again").onclick=()=>scanPage(true);
$("scan-edit").onclick=()=>{editingScan=!editingScan;selected=null;$("scan-edit").textContent=editingScan?"Đang sửa · bấm để dừng":"Sửa quân";$("scan-edit").setAttribute("aria-pressed",String(editingScan));$("scan-status").textContent=editingScan?"Chọn quân trong danh sách rồi bấm ô để đặt; chọn Xóa quân để xóa.":"Đã dừng sửa quân. Bấm Thực hành thế đã sửa để kiểm tra.";render();};
$("scan-play").onclick=()=>{const parts=chess.fen().split(" ");parts[1]=$("scan-turn").value;parts[2]="-";parts[3]="-";const fen=parts.join(" ");try{const trial=new Chess(fen);chess.load(trial.fen());stopScanEdit();selected=null;reviewSquares.clear();render();$("position").value=fen;bookPosition=fen;$("restore-position").disabled=false;showBoard();$("scan-status").textContent="Đã mở thế đã hiệu đính. Có thể thử biến hoặc tải PGN.";}catch{$("scan-status").textContent="Thế đã sửa chưa hợp lệ. Kiểm tra đủ một vua mỗi bên và vị trí tốt.";}};

let localScanState=null;
function scanSettings(){const local=scanEngine()==="local";$("scan-model-label").textContent=local?"Local miễn phí":$("scan-model").value;$("scan-model-status").textContent=local?(localScanState?.message||"Đang kiểm tra quét local…"):"Gemini dùng API key ở backend, hạn mức/phí tùy tài khoản Google.";$("scan-privacy").textContent=local?"Local chạy trên máy, không gửi ảnh ra ngoài. Kết quả lưu trong két.":"Gemini gửi ảnh trang tới Google. Kết quả lưu trong két.";}
async function loadScanModels(){
 if(loadingScanModels||scanning||probing)return;loadingScanModels=true;controls();
 try{
 const localTask=api("study/scan-local").then(data=>{localScanState=data;scanSettings();}).catch(e=>{$("scan-model-status").textContent=e.message;});
 const data=await api("study/scan-models");
 if(scanning||probing){await localTask;return;}
 let preferred=LOCAL_SCAN;try{preferred=localStorage.getItem("thc-scan-engine-v2")||preferred;}catch{}
 $("scan-model").replaceChildren(...data.models.map(x=>new Option(x===LOCAL_SCAN?"Local · chessvision (miễn phí)":x,x)));
 if(data.models.includes(preferred))$("scan-model").value=preferred;
 else if(data.models.includes(data.default))$("scan-model").value=data.default;
 scanSettings();clearScan();if(loaded)await openScans();await localTask;
 controls();
 }catch(e){$("scan-model-status").textContent=e.message;}
 finally{loadingScanModels=false;controls();}
}
$("scan-refresh").onclick=()=>loadScanModels();
$("scan-model").onchange=async()=>{scanRevision++;$("scan-probe-status").textContent="";scanSettings();clearScan();try{localStorage.setItem("thc-scan-engine-v2",$("scan-model").value);}catch{}if(loaded)await openScans();};

$("scan-probe").onclick=async()=>{
 if(probing||scanning||!loaded||!$("scan-model").value)return;
 probing=true;controls();$("scan-probe-status").textContent="Đang kiểm tra model với một ảnh nhỏ…";
 try{const data=await api("study/scan-probe",{model:$("scan-model").value});$("scan-probe-status").textContent=data.message;}
 catch(e){$("scan-probe-status").textContent=e.message;}
 finally{probing=false;controls();}
};

async function openPage(n,initial=false){
 if(busy||scanning||probing||!Number.isInteger(n)||n<1||n>total)return;
 busy=true;controls();
 try{
 if(!initial&&loaded)await save();
 page=n;$("page").value=page;$("total").textContent="/ "+total;
 const src="/api/library/translation/"+id+"/study/page-image?page="+page;
 $("pdf").src=src;$("page-image-link").href=src;$("scan-download").href=src;$("scan-download").download="sach-"+id+"-trang-"+page+".png";
 clearScan();await openScans();await save();status("Trang "+page+" / "+total+" · Kết quả quét được lưu để mở lại.");
 }catch(e){status(e.message);}finally{busy=false;controls();}
}
$("pdf").onerror=()=>{if(loaded)status("Không tải được ảnh trang. Kiểm tra kết nối tới máy chủ và trạng thái mở khóa kho PDF.");};
$("prev").onclick=()=>openPage(page-1);$("next").onclick=()=>openPage(page+1);$("page").onchange=()=>{const n=Number($("page").value);if(!Number.isInteger(n)||n<1||n>total){$("page").value=page;return;}return openPage(n);};
$("bookmark").onclick=async()=>{try{state.bookmark=page;await save();$("return").hidden=false;status("Đã đánh dấu trang "+page);}catch(e){status(e.message);}};
$("return").onclick=()=>openPage(state.bookmark);
$("save-note").onclick=async()=>{try{await save();$("note-status").textContent="Đã lưu ghi chú.";}catch(e){$("note-status").textContent=e.message;}};
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-tab]").forEach(x=>{x.classList.toggle("active",x===b);x.setAttribute("aria-pressed",String(x===b));});$("board-tab").hidden=b.dataset.tab!=="board";$("notes-tab").hidden=b.dataset.tab!=="notes";});
$("books").onchange=async()=>{if(!$("books").value)return;try{if(loaded)await save();location.href="/scan.html?id="+$("books").value;}catch(e){status(e.message);}};
async function listBooks(){const r=await fetch("/api/library?kind=book");if(!r.ok)throw Error("Kho PDF đang khóa. Bấm Mở khóa kho PDF rồi quay lại đây.");const books=(await r.json()).filter(x=>(x.ext||"").toLowerCase()===".pdf");$("books").replaceChildren(new Option("Chọn sách PDF…",""),...books.map(x=>new Option(x.title,String(x.id))));if(id)$("books").value=String(id);return books;}
$("upload").onchange=async()=>{
 const file=$("upload").files[0];if(!file||busy||scanning||probing||uploading)return;
 if(!file.name.toLowerCase().endsWith(".pdf")||file.size>150*1024*1024){status("Chọn PDF tối đa 150 MB.");$("upload").value="";return;}
 uploading=true;controls();status("Đang tải PDF…");
 try{if(loaded)await save();const before=await listBooks();const r=await fetch("/api/library/import?name="+encodeURIComponent(file.name),{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:file});const data=await r.json();if(!r.ok)throw Error(typeof data.detail==="string"?data.detail:"Không tải được sách.");const after=await listBooks(),added=after.find(x=>!before.some(y=>y.id===x.id));if(added)location.href="/scan.html?id="+added.id;else status("Sách đã có trong kho. Chọn sách trong danh sách để mở.");}catch(e){status(e.message);}finally{uploading=false;$("upload").value="";controls();}
};
function lockWorkspace(){loaded=false;scanRevision++;clearScan();$("pdf").removeAttribute("src");$("page-image-link").removeAttribute("href");$("scan-download").removeAttribute("href");$("note").value="";$("books").replaceChildren(new Option("Kho PDF đang khóa",""));controls();status("Kho PDF đã khóa. Mở khóa rồi tải lại trang.");}
clearScan();controls();
(async()=>{try{
 const books=await listBooks();
 if(!id){status(books.length?"Chọn sách PDF để bắt đầu quét thế cờ.":"Chưa có sách PDF. Tải PDF lên để bắt đầu.");return;}
 if(!books.some(x=>Number(x.id)===id))throw Error("Không tìm thấy sách PDF. Chọn sách khác trong danh sách.");
 const [saved,info]=await Promise.all([api(id+"/state"),api(id+"/study/info")]);state=saved;total=info.pages;$("page").max=total;$("note").value=state.note||"";$("return").hidden=!state.bookmark;loaded=true;
 await openPage(Math.min(total,Math.max(1,state.page||1)),true);await loadScanModels();
 setInterval(()=>fetch("/api/library/item/"+id).then(r=>{if(r.status===401)lockWorkspace();}).catch(()=>{}),30000);
 }catch(e){status(e.message);}finally{controls();}
})();
