import {Chess} from "/vendor/chess.js";
import {PIECE_DEFS} from "/vendor/pieces.js?v=paint-2";
const $=id=>document.getElementById(id),id=Number(new URLSearchParams(location.search).get("id"));
let page=1,total=1,state={page:1,note:"",bookmark:null,model:""},busy=false,translating=false,scanning=false,loaded=false,job={},savedSource="",view="bilingual";
function status(t){$("status").textContent=t;}
async function api(path,body,method="POST"){
 const r=await fetch("/api/library/translation/"+path,body===undefined?{}:{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const data=await r.json();if(!r.ok)throw Error(r.status===401?"Tàng Kinh Các đang khóa. Mở khóa ở trang thư viện rồi tải lại.":typeof data.detail==="string"?data.detail:"Không thực hiện được thao tác.");
 return data;
}
function controls(){
 const navigating=busy||translating||scanning;
 $("scan-page").disabled=busy||scanning||!loaded;$("scan-again").disabled=busy||scanning||!loaded;
 $("scan-model").disabled=busy||scanning;$("scan-refresh").disabled=scanning;
 for(const name of ["prev","next","page","ocr","books"])$(name).disabled=navigating||!loaded;
 for(const name of ["translate","save-source","source"])$(name).disabled=busy||translating||!loaded;
 $("prev").disabled=navigating||!loaded||page<=1;$("next").disabled=navigating||!loaded||page>=total;
 $("model").disabled=busy||translating;
 $("translate").textContent=translating?"Đang dịch…":"Dịch trang";
 $("scan-page").textContent=scanning?"Đang quét…":"✦ Quét trang "+page;
 $("reading-pane").setAttribute("aria-busy",String(translating));
 $("scan-section").setAttribute("aria-busy",String(scanning));
}
function translationStatus(t){$("translation-status").textContent=t;}
async function save(){state={...state,page,note:$("note").value,model:$("model").value};await api(id+"/state",state,"PUT");}
function body(){return {text:$("source").value,page,model:$("model").value};}
let cacheRevision=0;
async function cached(){
 const revision=++cacheRevision,requestedPage=page,requestedModel=$("model").value,requestedText=$("source").value;
 const current=()=>revision===cacheRevision&&page===requestedPage&&$("model").value===requestedModel&&$("source").value===requestedText&&!translating;
 $("result").textContent="Trang này chưa có bản dịch. Kiểm tra chữ tiếng Anh rồi bấm Dịch trang.";
 if(!$("model").value)return;
 const batch=await api(id+"/batch/page?page="+page);if(!current())return;
 if(batch.translation&&batch.model===$("model").value&&batch.text===$("source").value){$("result").textContent=batch.translation;return;}
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
 document.title=data.title+" · Thư Phòng";$("pdf").src="/api/library/file/"+id+"#page="+page;
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
$("translate").onclick=async()=>{
 if(busy||translating||!loaded)return;
 if(!$("source").value.trim()){translationStatus("Không có chữ để dịch.");return;}
 if($("source").value.length>12000){translationStatus("Trang dài quá 12.000 ký tự. Dùng Dịch Kinh Các để dịch theo đoạn.");return;}
 cacheRevision++;translating=true;controls();translationStatus($("model").value==="deepl:en-vi"?"Đang gửi đoạn chữ tới DeepL để dịch…":$("model").value.startsWith("gemini:")?"Đang gửi đoạn chữ tới Gemini để dịch…":"Đang dịch trên máy…");
 try{if(savedSource!==$("source").value){await api(id+"/study/source",{page,text:$("source").value});savedSource=$("source").value;}
 const data=await api(id+"/translate",body());$("result").textContent=data.translation;translationStatus("Bản dịch đã lưu · đối chiếu nguyên bản khi học.");
 }catch(e){translationStatus(e.message);}finally{translating=false;controls();}
};
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
const chess=new Chess();let flip=false,selected=null;
const defs=document.createElementNS("http://www.w3.org/2000/svg","svg");defs.setAttribute("width","0");defs.setAttribute("height","0");defs.style.position="absolute";defs.innerHTML="<defs>"+PIECE_DEFS+"</defs>";document.body.append(defs);
function render(){
 $("board").replaceChildren();const ranks=flip?[1,2,3,4,5,6,7,8]:[8,7,6,5,4,3,2,1],files=flip?"hgfedcba":"abcdefgh";
 const legal=selected?chess.moves({square:selected,verbose:true}).map(m=>m.to):[];
 for(const r of ranks)for(const f of files){
  const sq=f+r,p=chess.get(sq),b=document.createElement("button");b.className="square"+(("abcdefgh".indexOf(f)+r)%2===1?" dark":"")+(selected===sq?" selected":"")+(legal.includes(sq)?" target":"");
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
 const m=chess.move({from:selected,to:sq,promotion});if(m){selected=null;render();return;}
 }catch{}}
 const p=chess.get(sq);selected=p&&p.color===chess.turn()?sq:null;render();
}
$("undo").onclick=()=>{if(editingScan)return;chess.undo();selected=null;render();};$("flip").onclick=()=>{flip=!flip;render();};
$("reset").onclick=()=>{stopScanEdit();chess.reset();selected=null;render();};
$("load-position").onclick=()=>{try{const text=$("position").value.trim(),trial=new Chess();if(text.split("/").length===8&&!text.includes("\n"))trial.load(text);else trial.loadPgn(text);if(!text)throw Error();stopScanEdit();chess.loadPgn(trial.pgn());selected=null;render();$("board-status").textContent="Đã mở thế cờ."; }catch{$("board-status").textContent="FEN hoặc PGN không hợp lệ. Kiểm tra ký hiệu quân và nước đi.";}};
$("download-pgn").onclick=()=>download(chess.pgn(),"thu-phong-thuc-hanh.pgn");render();setView("bilingual");controls();
const started=Date.now();setInterval(()=>{const m=Math.floor((Date.now()-started)/60000),s=Math.floor((Date.now()-started)/1000)%60;$("session").textContent="Phiên học · "+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");},1000);
(async()=>{try{
 const r=await fetch("/api/library?kind=book");if(!r.ok)throw Error("Mở khóa Tàng Kinh Các trước. Bấm liên kết ở góc trái rồi quay lại đây.");
 const books=(await r.json()).filter(x=>x.ext===".pdf");$("books").replaceChildren(new Option("Chọn sách PDF…",""),...books.map(x=>new Option(x.title,String(x.id))));
 if(!id){status("Chọn sách trong tủ. Nếu chưa có, tải PDF lên ở Tàng Kinh Các.");$("books").disabled=false;return;}
 $("books").value=String(id);$("translation").href="/translate.html?id="+id;
 state=await api(id+"/state");job=await api(id+"/batch");$("note").value=state.note||"";$("return").hidden=!state.bookmark;$("ocr").checked=!!job.ocr;
 const models=await api("models");$("model").replaceChildren(...models.models.map(x=>new Option(x==="deepl:en-vi"?"DeepL · Anh → Việt":x.startsWith("gemini:")?"Gemini · "+x.slice(7):x==="opus-mt-en-vi"?"OPUS-MT · Anh → Việt":x,x)));
 const preferred=state.model||job.model;if(models.models.includes(preferred))$("model").value=preferred;
 await openPage(state.page||1,true);
 loadScanModels();
 setInterval(()=>fetch("/api/library/item/"+id).then(r=>{if(r.status===401){loaded=false;clearScan();controls();$("pdf").src="about:blank";$("source").value="";$("result").textContent="";$("note").value="";status("Két đã khóa. Mở khóa rồi tải lại trang.");}}).catch(()=>{}),30000);
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
async function openScans(){try{const data=await api(id+"/study/boards?page="+page);if(data.boards!==null)showScans(data);else if(!data.available)$("scan-status").textContent="Quét ảnh cần khóa Gemini ở backend; DeepL chỉ dịch chữ.";}catch(e){$("scan-status").textContent=e.message;}}
function showScans(data){
 scannedBoards=data.boards||[];$("scan-results").replaceChildren();$("scan-again").hidden=false;
 $("scan-status").textContent=scannedBoards.length?"Tìm thấy "+scannedBoards.length+" hình · "+(data.cached?"đã lưu":"vừa quét")+". Chọn hình để mở và kiểm tra quân.":"Không nhận diện được hình bàn cờ trên trang này. Có thể quét lại nếu sách có hình.";
 scannedBoards.forEach((b,i)=>{const card=document.createElement("button");card.type="button";card.className="scan-card";card.setAttribute("aria-pressed","false");const img=document.createElement("img");img.src=b.image;img.alt="Hình bàn cờ "+(i+1)+" từ trang "+page;const label=document.createElement("span");label.textContent="Thế "+(i+1)+(b.label?" · "+b.label:"");const note=document.createElement("small");note.textContent=b.warning||"";card.title=b.warning||"Mở thế cờ trên bàn thực hành";card.append(img,label,note);card.onclick=()=>openScan(i,card);$("scan-results").append(card);});
}
function openScan(i,card){
 if(!loaded||busy||scanning)return;const b=scannedBoards[i];stopScanEdit();
 document.querySelectorAll(".scan-card").forEach(c=>{c.classList.toggle("active",c===card);c.setAttribute("aria-pressed",String(c===card));});
 $("scan-editor").hidden=false;$("scan-editor").open=false;$("scan-selected").textContent="Thế "+(i+1)+" · trang "+page;$("scan-turn").value=b.turn==="b"?"b":"w";
 if(!b.placement){$("scan-status").textContent="Hình này chưa đọc được quân. Nhập FEN đúng từ sách trong mục Nhập thế cờ.";$("scan-editor").hidden=true;return;}
 const fen=b.placement+" "+$("scan-turn").value+" - - 0 1";
 try{const trial=new Chess(fen);chess.load(trial.fen());selected=null;flip=b.orientation==="black";render();$("position").value=fen;$("scan-status").textContent="Đã mở thế "+(i+1)+(b.turn==="unknown"?" · chưa rõ lượt đi, tạm chọn Trắng.":".")+" Kiểm tra quân trước khi đánh.";}
 catch{$("position").value=fen;$("scan-editor").hidden=true;$("scan-status").textContent="FEN nhận diện chưa hợp lệ. Sửa FEN trong mục Nhập thế cờ rồi mở lại.";}
}
async function scanPage(force=false){
 if(busy||scanning||!loaded)return;scanning=true;controls();$("scan-status").textContent="Đang quét tất cả hình trên trang "+page+"… Nếu Gemini tạm quá tải, tự thử lại tối đa 2 lần.";
 try{showScans(await api(id+"/study/boards",{page,force,model:$("scan-model").value}));}catch(e){$("scan-status").textContent=e.message;}finally{scanning=false;controls();}
}
$("scan-page").onclick=()=>scanPage();$("scan-again").onclick=()=>scanPage(true);
$("scan-edit").onclick=()=>{editingScan=!editingScan;selected=null;$("scan-edit").textContent=editingScan?"Đang sửa · bấm để dừng":"Sửa quân";$("scan-edit").setAttribute("aria-pressed",String(editingScan));$("scan-status").textContent=editingScan?"Chọn quân trong danh sách rồi bấm ô để đặt; chọn Xóa quân để xóa.":"Đã dừng sửa quân. Bấm Thực hành thế đã sửa để kiểm tra.";render();};
$("scan-play").onclick=()=>{const parts=chess.fen().split(" ");parts[1]=$("scan-turn").value;parts[2]="-";parts[3]="-";const fen=parts.join(" ");try{const trial=new Chess(fen);chess.load(trial.fen());stopScanEdit();selected=null;render();$("position").value=fen;$("scan-status").textContent="Đã mở thế đã hiệu đính. Có thể thử biến hoặc tải PGN.";}catch{$("scan-status").textContent="Thế đã sửa chưa hợp lệ. Kiểm tra đủ một vua mỗi bên và vị trí tốt.";}};

let loadingScanModels=false;
async function loadScanModels(){
 if(loadingScanModels)return;loadingScanModels=true;$("scan-refresh").disabled=true;
 try{
 const data=await api("study/scan-models");
 let preferred=$("scan-model").value;try{preferred=localStorage.getItem("thc-scan-model")||preferred;}catch{}
 $("scan-model").replaceChildren(...data.models.map(x=>new Option(x,x)));
 if(data.models.includes(preferred))$("scan-model").value=preferred;
 else if(data.models.includes(data.default))$("scan-model").value=data.default;
 $("scan-model-label").textContent=$("scan-model").value||"chưa có model";
 $("scan-model-status").textContent=!data.available?"Chưa đặt GEMINI_API_KEY ở backend.":data.warning||"AI quét ảnh được chọn riêng với AI dịch chữ.";
 }catch(e){$("scan-model-status").textContent=e.message;}
 finally{loadingScanModels=false;$("scan-refresh").disabled=scanning;}
}
$("scan-refresh").onclick=()=>loadScanModels();
$("scan-model").onchange=()=>{$("scan-model-label").textContent=$("scan-model").value;try{localStorage.setItem("thc-scan-model",$("scan-model").value);}catch{}};
