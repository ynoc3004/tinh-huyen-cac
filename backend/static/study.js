import {Chess} from "/vendor/chess.js";
import {PIECE_DEFS} from "/vendor/pieces.js?v=paint-2";
const $=id=>document.getElementById(id),id=Number(new URLSearchParams(location.search).get("id"));
let page=1,total=1,state={page:1,note:"",bookmark:null,model:""},busy=false,translating=false,scanning=false,probing=false,loadingScanModels=false,batchRunning=false,batchStop=false,loaded=false,job={},savedSource="",view="bilingual";
function status(t){$("status").textContent=t;}
async function api(path,body,method="POST"){
 const r=await fetch("/api/library/translation/"+path,body===undefined?{}:{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const data=await r.json();if(!r.ok)throw Error(r.status===401?"Tàng Kinh Các đang khóa. Mở khóa ở trang thư viện rồi tải lại.":typeof data.detail==="string"?data.detail:"Không thực hiện được thao tác.");
 return data;
}
function controls(){
 const navigating=busy||translating||scanning;
 $("scan-page").disabled=busy||scanning||probing||!loaded;$("scan-again").disabled=busy||scanning||probing||!loaded;
 $("scan-model").disabled=busy||scanning||probing||loadingScanModels;$("scan-refresh").disabled=scanning||probing||loadingScanModels;$("scan-probe").disabled=busy||scanning||probing||!loaded||!$("scan-model").value;
 $("scan-import").disabled=!loaded;$("import-pgn").disabled=!loaded;$("scan-download").hidden=!loaded;
 for(const name of ["prev","next","page","ocr","books"])$(name).disabled=navigating||!loaded;
 for(const name of ["translate","translate-selection","save-source","source"])$(name).disabled=busy||translating||batchRunning||!loaded;
 $("prev").disabled=navigating||!loaded||page<=1;$("next").disabled=navigating||!loaded||page>=total;
 $("model").disabled=busy||translating||batchRunning;
 $("books").disabled=navigating||batchRunning||!loaded;$("ocr").disabled=navigating||batchRunning||!loaded;
 for(const name of ["batch-start","batch-end","batch-size","batch-ocr","glossary","upload"])$(name).disabled=batchRunning||translating;
 $("batch-run").disabled=busy||translating||batchRunning||!loaded||!$("model").value;$("batch-pause").hidden=!batchRunning;
 $("translate").textContent=translating?"Đang dịch…":"Dịch trang";
 $("scan-page").textContent=scanning?"Đang quét…":"✦ Quét trang "+page;
 $("reading-pane").setAttribute("aria-busy",String(translating));
 $("scan-section").setAttribute("aria-busy",String(scanning));
}
function translationStatus(t){$("translation-status").textContent=t;}
async function save(){state={...state,page,note:$("note").value,model:$("model").value};await api(id+"/state",state,"PUT");}
function body(text=$("source").value){return {text,page,model:$("model").value,glossary:$("glossary").value};}
let cacheRevision=0;
async function cached(){
 const revision=++cacheRevision,requestedPage=page,requestedModel=$("model").value,requestedText=$("source").value;
 const current=()=>revision===cacheRevision&&page===requestedPage&&$("model").value===requestedModel&&$("source").value===requestedText&&!translating;
 $("result").textContent="Trang này chưa có bản dịch. Kiểm tra chữ tiếng Anh rồi bấm Dịch trang.";
 if(!$("model").value)return;
 const batch=await api(id+"/batch/page?page="+page);if(!current())return;
 if(batch.translation&&batch.model===$("model").value&&batch.text===$("source").value&&(job.glossary||"")===$("glossary").value){$("result").textContent=batch.translation;return;}
 if($("source").value.trim()&&$("source").value.length<=12000){
 const data=await api(id+"/cached",body());if(current()&&data.translation)$("result").textContent=data.translation;
 }
}
async function openPage(n,initial=false){
 if(busy||translating||scanning||!id)return;busy=true;controls();
 try{
 if(!initial){await save();if(savedSource!==$("source").value){await api(id+"/study/source",{page,text:$("source").value});savedSource=$("source").value;}}
 const data=await api(id+"/page?page="+n+"&ocr="+$("ocr").checked);
 page=data.page;total=data.pages;loaded=true;$("page").value=page;$("total").textContent="/ "+total;
 document.title=data.title+" · Thư Phòng";$("pdf").src="/api/library/translation/"+id+"/study/page-image?page="+page;$("pdf").alt="Trang "+page+" · "+data.title;
 $("scan-download").href=$("pdf").src;$("scan-download").download="sach-"+id+"-trang-"+page+".png";
 $("source").value=data.text;savedSource=data.text;translationStatus("");clearScan();await openScans();await cached();await save();
 status(data.text?"Trang "+page+" · chữ tiếng Anh có thể hiệu đính trước khi dịch.":"Trang không có chữ. Bật OCR nếu đây là trang scan.");
 }catch(e){status(e.message);}finally{busy=false;controls();}
}
$("prev").onclick=()=>openPage(page-1);$("next").onclick=()=>openPage(page+1);
$("page").onchange=()=>openPage(Math.max(1,Math.min(total,Number($("page").value)||1)));
$("ocr").onchange=()=>openPage(page);
$("model").onchange=async()=>{try{await cached();await save();}catch(e){translationStatus(e.message);}};
$("source").oninput=()=>{$("result").textContent="Chữ gốc đã thay đổi. Lưu chữ đã sửa rồi dịch lại.";};
$("save-source").onclick=async()=>{try{await api(id+"/study/source",{page,text:$("source").value});savedSource=$("source").value;status("Đã lưu chữ hiệu đính trong két.");}catch(e){status(e.message);}};
async function translatePage(selection=false){
 if(busy||translating||batchRunning||!loaded)return;
 const text=selection?$("source").value.slice($("source").selectionStart,$("source").selectionEnd):$("source").value;
 if(!text.trim()){translationStatus(selection?"Bôi đen đoạn tiếng Anh cần dịch trước.":"Không có chữ để dịch.");return;}
 if(text.length>12000){translationStatus("Nội dung dài quá 12.000 ký tự. Bôi đen từng đoạn hoặc dùng Dịch nhiều trang.");return;}
 cacheRevision++;translating=true;controls();translationStatus($("model").value==="deepl:en-vi"?"Đang gửi đoạn chữ tới DeepL để dịch…":$("model").value.startsWith("gemini:")?"Đang gửi đoạn chữ tới Gemini để dịch…":"Đang dịch trên máy…");
 try{if(savedSource!==$("source").value){await api(id+"/study/source",{page,text:$("source").value});savedSource=$("source").value;}
 const data=await api(id+"/translate",body(text));$("result").textContent=data.translation;translationStatus("Bản dịch đã lưu · đối chiếu nguyên bản khi học.");
 }catch(e){translationStatus(e.message);}finally{translating=false;controls();}
}
$("translate").onclick=()=>translatePage();$("translate-selection").onclick=()=>translatePage(true);
$("bookmark").onclick=async()=>{if(!loaded)return;state.bookmark=page;try{await save();$("return").hidden=false;status("Đã đánh dấu trang "+page);}catch(e){status(e.message);}};
$("return").onclick=()=>openPage(Math.min(total,state.bookmark||1));
$("save-note").onclick=async()=>{if(!loaded)return;try{await save();$("note-status").textContent="Đã lưu ghi chú trong két.";}catch(e){$("note-status").textContent=e.message;}};
function setView(v){view=v;document.body.dataset.view=v;$("editor").hidden=v!=="text";document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===v));}
document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>setView(b.dataset.view));
$("text-toggle").onclick=()=>{$("editor").hidden=!$("editor").hidden;};
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x===b));$("board-tab").hidden=b.dataset.tab!=="board";$("notes-tab").hidden=b.dataset.tab!=="notes";});
$("focus").onclick=()=>{const on=document.body.classList.toggle("focus");$("focus").textContent=on?"Thoát tập trung":"Chế độ tập trung";};
$("fullscreen").onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{status("Trình duyệt chưa cho phép toàn màn hình.");}};
function download(text,name,type="text/plain"){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$("download").onclick=()=>{if(loaded)download("=== Trang "+page+" ===\n\n"+$("source").value,"sach-"+id+"-trang-"+page+".en.txt");};
$("books").onchange=async()=>{if(!$("books").value)return;try{if(loaded){await save();if(savedSource!==$("source").value)await api(id+"/study/source",{page,text:$("source").value});}location.href="/study.html?id="+$("books").value;}catch(e){status(e.message);}};
const chess=new Chess();let flip=false,selected=null,reviewSquares=new Set();
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
$("reset").onclick=()=>{stopScanEdit();chess.reset();selected=null;reviewSquares.clear();render();};
$("load-position").onclick=()=>{try{let text=$("position").value.trim();const trial=new Chess();if(text.split("/").length===8&&!text.includes("\n")){if(!text.includes(" "))text+=" w - - 0 1";trial.load(text);}else trial.loadPgn(text);if(!text)throw Error();stopScanEdit();chess.loadPgn(trial.pgn());selected=null;reviewSquares.clear();render();$("board-status").textContent="Đã mở thế cờ / ván đấu. Kiểm tra lượt đi và quân với sách."; }catch{$("board-status").textContent="FEN hoặc PGN không hợp lệ. Kiểm tra ký hiệu quân và nước đi.";}};
$("scan-import").onclick=()=>{$("position-panel").open=true;$("position").focus();$("position-panel").scrollIntoView({behavior:"smooth",block:"nearest"});};
$("import-pgn").onclick=()=>$("pgn-file").click();
$("pgn-file").onchange=async()=>{const file=$("pgn-file").files[0];if(!file)return;try{if(file.size>2*1024*1024)throw Error("Chọn file PGN/FEN tối đa 2 MB.");$("position").value=await file.text();$("position-panel").open=true;$("load-position").click();}catch(e){$("board-status").textContent=e.message;}finally{$("pgn-file").value="";}};
$("download-pgn").onclick=()=>download(chess.pgn(),"thu-phong-thuc-hanh.pgn");render();setView("bilingual");controls();
const started=Date.now();setInterval(()=>{const m=Math.floor((Date.now()-started)/60000),s=Math.floor((Date.now()-started)/1000)%60;$("session").textContent="Phiên học · "+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");},1000);
(async()=>{try{
 const r=await fetch("/api/library?kind=book");if(!r.ok)throw Error("Mở khóa Tàng Kinh Các trước. Bấm liên kết ở góc trái rồi quay lại đây.");
 const books=(await r.json()).filter(x=>x.ext===".pdf");$("books").replaceChildren(new Option("Chọn sách PDF…",""),...books.map(x=>new Option(x.title,String(x.id))));
 if(!id){status("Chọn sách trong tủ. Nếu chưa có, tải PDF lên ở Tàng Kinh Các.");$("books").disabled=false;return;}
 $("books").value=String(id);$("batch-export").href="/api/library/translation/"+id+"/export";
 state=await api(id+"/state");job=await api(id+"/batch");$("note").value=state.note||"";$("return").hidden=!state.bookmark;$("ocr").checked=!!job.ocr;
 const models=await api("models");$("model").replaceChildren(...models.models.map(x=>new Option(x==="deepl:en-vi"?"DeepL · Anh → Việt":x.startsWith("gemini:")?"Gemini · "+x.slice(7):x==="opus-mt-en-vi"?"OPUS-MT · Anh → Việt":x,x)));
 initializeBatch();
 const preferred=state.model||job.model;if(models.models.includes(preferred))$("model").value=preferred;
 await openPage(state.page||1,true);
 if(!job.end)$("batch-end").value=total;renderBatch();
 if(location.hash==="#batch-panel")$("batch-panel").open=true;
 loadScanModels();
 setInterval(()=>fetch("/api/library/item/"+id).then(r=>{if(r.status===401){loaded=false;batchStop=true;clearScan();controls();$("pdf").removeAttribute("src");$("pdf").alt="Két đã khóa";$("source").value="";$("result").textContent="";$("note").value="";status("Két đã khóa. Mở khóa rồi tải lại trang.");}}).catch(()=>{}),30000);
 }catch(e){status(e.message);}
})();

let readingSize=18,theme="day";
try{readingSize=Math.min(26,Math.max(15,Number(localStorage.getItem("thc-study-size"))||18));theme=localStorage.getItem("thc-study-theme")==="night"?"night":"day";}catch{}
function appearance(){document.documentElement.dataset.theme=theme;document.documentElement.style.setProperty("--reading-size",readingSize+"px");$("theme").textContent=theme==="night"?"☀ Ngày":"☾ Đêm";$("theme").setAttribute("aria-pressed",String(theme==="night"));$("text-smaller").disabled=readingSize<=15;$("text-larger").disabled=readingSize>=26;try{localStorage.setItem("thc-study-size",String(readingSize));localStorage.setItem("thc-study-theme",theme);}catch{}}
$("theme").onclick=()=>{theme=theme==="night"?"day":"night";appearance();};
$("text-smaller").onclick=()=>{readingSize=Math.max(15,readingSize-1);appearance();};
$("text-larger").onclick=()=>{readingSize=Math.min(26,readingSize+1);appearance();};
appearance();

let scannedBoards=[],editingScan=false;
function stopScanEdit(){editingScan=false;$("scan-edit").textContent="Sửa quân";$("scan-edit").setAttribute("aria-pressed","false");}
function clearScan(){scannedBoards=[];$("scan-results").replaceChildren();$("scan-status").textContent="Bấm quét để tìm các hình bàn cờ trên trang.";$("scan-again").hidden=true;$("scan-editor").hidden=true;$("scan-editor").open=false;$("scan-selected").textContent="Bàn cờ thực hành";stopScanEdit();}
const LOCAL_SCAN="local:chessvision";
function scanEngine(){return $("scan-model").value&&$("scan-model").value!==LOCAL_SCAN?"gemini":"local";}
let scanRevision=0;
async function openScans(){const revision=++scanRevision,requestedPage=page,engine=scanEngine();try{const data=await api(id+"/study/boards?page="+page+"&engine="+engine);if(revision!==scanRevision||requestedPage!==page||engine!==scanEngine()||scanning)return;if(data.boards!==null)showScans(data);else if(!data.available)$("scan-status").textContent=data.message||"Bộ quét chưa sẵn sàng. Mở mục Bộ quét để kiểm tra.";}catch(e){if(revision===scanRevision)$("scan-status").textContent=e.message;}}
function showScans(data){
 scannedBoards=data.boards||[];$("scan-results").replaceChildren();$("scan-again").hidden=false;
 $("scan-status").textContent=scannedBoards.length?"Tìm thấy "+scannedBoards.length+" hình · "+(data.engine==="local"?"Local · ":"Gemini · ")+(data.cached?"đã lưu":"vừa quét")+". Chọn hình để mở và kiểm tra quân.":"Không nhận diện được hình bàn cờ trên trang này. Thử Chessvision.ai hoặc nhập FEN/PGN nếu sách có hình.";
 scannedBoards.forEach((b,i)=>{const card=document.createElement("button");card.type="button";card.className="scan-card";card.setAttribute("aria-pressed","false");const img=document.createElement("img");img.src=b.image;img.alt="Hình bàn cờ "+(i+1)+" từ trang "+page;const label=document.createElement("span");label.textContent="Thế "+(i+1)+(b.label?" · "+b.label:"");const note=document.createElement("small");note.textContent=b.warning||"";card.title=b.warning||"Mở thế cờ trên bàn thực hành";card.append(img,label,note);card.onclick=()=>openScan(i,card);$("scan-results").append(card);});
}
function openScan(i,card){
 if(!loaded||busy||scanning)return;const b=scannedBoards[i];stopScanEdit();
 document.querySelectorAll(".scan-card").forEach(c=>{c.classList.toggle("active",c===card);c.setAttribute("aria-pressed",String(c===card));});
 $("scan-editor").hidden=false;$("scan-editor").open=false;$("scan-selected").textContent="Thế "+(i+1)+" · trang "+page;$("scan-turn").value=b.turn==="b"?"b":"w";
 if(!b.placement){$("scan-status").textContent="Hình này chưa đọc được quân. Nhập FEN đúng từ sách trong mục Nhập thế cờ.";$("scan-editor").hidden=true;return;}
 const fen=b.placement+" "+$("scan-turn").value+" - - 0 1";
 try{const trial=new Chess(fen);chess.load(trial.fen());selected=null;flip=b.orientation==="black";reviewSquares=new Set(b.review_squares||[]);render();$("position").value=fen;$("scan-status").textContent="Đã mở thế "+(i+1)+(b.turn==="unknown"?" · chưa rõ lượt đi, tạm chọn Trắng.":".")+" Kiểm tra quân trước khi đánh."+(reviewSquares.size?" Các ô viền vàng cần đối chiếu; mở Hiệu đính để sửa.":"");}
 catch{$("position").value=fen;$("scan-editor").hidden=true;$("scan-status").textContent="FEN nhận diện chưa hợp lệ. Sửa FEN trong mục Nhập thế cờ rồi mở lại.";}
}
async function scanPage(force=false){
 if(busy||scanning||probing||!loaded)return;scanRevision++;scanning=true;controls();$("scan-status").textContent=scanEngine()==="local"?"Đang nhận diện hình bàn cờ trên CPU · trang "+page+"…":"Đang gửi ảnh trang "+page+" tới Gemini… Nếu tạm quá tải, tự thử lại tối đa 2 lần.";
 try{showScans(await api(id+"/study/boards",{page,force,model:$("scan-model").value}));}catch(e){$("scan-status").textContent=e.message;document.querySelector(".scan-settings").open=true;}finally{scanning=false;controls();}
}
$("scan-page").onclick=()=>scanPage();$("scan-again").onclick=()=>scanPage(true);
$("scan-edit").onclick=()=>{editingScan=!editingScan;selected=null;$("scan-edit").textContent=editingScan?"Đang sửa · bấm để dừng":"Sửa quân";$("scan-edit").setAttribute("aria-pressed",String(editingScan));$("scan-status").textContent=editingScan?"Chọn quân trong danh sách rồi bấm ô để đặt; chọn Xóa quân để xóa.":"Đã dừng sửa quân. Bấm Thực hành thế đã sửa để kiểm tra.";render();};
$("scan-play").onclick=()=>{const parts=chess.fen().split(" ");parts[1]=$("scan-turn").value;parts[2]="-";parts[3]="-";const fen=parts.join(" ");try{const trial=new Chess(fen);chess.load(trial.fen());stopScanEdit();selected=null;reviewSquares.clear();render();$("position").value=fen;$("scan-status").textContent="Đã mở thế đã hiệu đính. Có thể thử biến hoặc tải PGN.";}catch{$("scan-status").textContent="Thế đã sửa chưa hợp lệ. Kiểm tra đủ một vua mỗi bên và vị trí tốt.";}};

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

$("translation").onclick=()=>{$("batch-panel").open=!$("batch-panel").open;};
function initializeBatch(){
 if(job.phase&&job.phase!=="idle"){
 for(const [control,field] of [["batch-start","start"],["batch-end","end"],["batch-size","chunk_size"],["glossary","glossary"]])$(control).value=job[field]??$(control).value;
 $("batch-ocr").checked=!!job.ocr;
 }
}
function renderBatch(){
 if(!job.phase||job.phase==="idle")return;
 const count=job.end-job.start+1;
 $("batch-progress").value=100*((job.done||0)+(job.chunks?job.chunk/job.chunks:0))/count;
 $("batch-progress-label").textContent=(job.done||0)+" / "+count+" trang"+(job.chunks?" · đoạn "+job.chunk+"/"+job.chunks:"");
 $("batch-export").hidden=!job.done&&!job.chunk;
 $("batch-status").textContent=job.error||(job.phase==="completed"?"Đã hoàn thành và lưu bản dịch.":batchRunning?"Đang dịch; bạn vẫn có thể đọc và thử thế cờ.":"Tiến độ đã lưu. Bấm tiếp tục khi sẵn sàng.");
}
$("batch-run").onclick=async()=>{
 if(!loaded||batchRunning||translating||busy)return;
 batchRunning=true;batchStop=false;controls();let batchError="";
 try{
 if(savedSource!==$("source").value){await api(id+"/study/source",{page,text:$("source").value});savedSource=$("source").value;}
 job=await api(id+"/batch/start",{model:$("model").value,start:Number($("batch-start").value),end:Number($("batch-end").value),ocr:$("batch-ocr").checked,chunk_size:Number($("batch-size").value),glossary:$("glossary").value});renderBatch();
 while(!batchStop&&loaded&&job.phase!=="completed"){job=await api(id+"/batch/step",{});renderBatch();await cached();}
 }catch(e){batchError=e.message;$("batch-status").textContent=e.message;try{job=await api(id+"/batch");}catch{}}
 finally{batchRunning=false;batchStop=false;$("batch-pause").textContent="Tạm dừng";$("batch-pause").disabled=false;controls();renderBatch();if(batchError)$("batch-status").textContent=batchError;}
};
$("batch-pause").onclick=()=>{batchStop=true;$("batch-pause").disabled=true;$("batch-pause").textContent="Chờ đoạn hiện tại…";};
$("glossary").onchange=()=>cached().catch(e=>translationStatus(e.message));
$("upload").onchange=async()=>{
 const file=$("upload").files[0];if(!file||batchRunning)return;
 if(!file.name.toLowerCase().endsWith(".pdf")||file.size>150*1024*1024){status("Chọn PDF tối đa 150 MB.");return;}
 $("upload").disabled=true;
 try{
 if(loaded)await save();
 const before=await (await fetch("/api/library?kind=book")).json();
 const r=await fetch("/api/library/import?name="+encodeURIComponent(file.name),{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:file});const data=await r.json();if(!r.ok)throw Error(typeof data.detail==="string"?data.detail:"Không tải được sách.");
 const after=await (await fetch("/api/library?kind=book")).json(),added=after.find(x=>!before.some(y=>y.id===x.id));
 if(added)location.href="/study.html?id="+added.id;else status("Sách đã có trong két. Chọn sách trong danh sách để mở.");
 }catch(e){status(e.message);}finally{$("upload").disabled=false;$("upload").value="";}
};
$("scan-probe").onclick=async()=>{
 if(probing||scanning||!loaded||!$("scan-model").value)return;
 probing=true;controls();$("scan-probe-status").textContent="Đang kiểm tra model với một ảnh nhỏ…";
 try{const data=await api("study/scan-probe",{model:$("scan-model").value});$("scan-probe-status").textContent=data.message;}
 catch(e){$("scan-probe-status").textContent=e.message;}
 finally{probing=false;controls();}
};
