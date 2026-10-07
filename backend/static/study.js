import {Chess} from "/vendor/chess.js";
import {PIECE_DEFS} from "/vendor/pieces.js?v=paint-2";
const $=id=>document.getElementById(id),id=Number(new URLSearchParams(location.search).get("id"));
let page=1,total=1,state={page:1,note:"",bookmark:null,model:""},busy=false,loaded=false,job={},savedSource="",view="bilingual";
function status(t){$("status").textContent=t;}
async function api(path,body,method="POST"){
 const r=await fetch("/api/library/translation/"+path,body===undefined?{}:{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const data=await r.json();if(!r.ok)throw Error(r.status===401?"Tàng Kinh Các đang khóa. Mở khóa ở trang thư viện rồi tải lại.":typeof data.detail==="string"?data.detail:"Không thực hiện được thao tác.");
 return data;
}
function controls(){
 for(const name of ["prev","next","page","translate","save-source","ocr","books"])$(name).disabled=busy||!loaded;
 $("prev").disabled=busy||!loaded||page<=1;$("next").disabled=busy||!loaded||page>=total;
 $("model").disabled=busy;
}
async function save(){state={...state,page,note:$("note").value,model:$("model").value};await api(id+"/state",state,"PUT");}
function body(){return {text:$("source").value,page,model:$("model").value};}
async function cached(){
 $("result").textContent="Trang này chưa có bản dịch. Kiểm tra chữ tiếng Anh rồi bấm Dịch trang.";
 if(!$("model").value)return;
 const batch=await api(id+"/batch/page?page="+page);
 if(batch.translation&&batch.model===$("model").value&&batch.text===$("source").value){$("result").textContent=batch.translation;return;}
 if($("source").value.trim()&&$("source").value.length<=12000){
 const data=await api(id+"/cached",body());if(data.translation)$("result").textContent=data.translation;
 }
}
async function openPage(n,initial=false){
 if(busy||!id)return;busy=true;controls();
 try{
 if(!initial){await save();if(savedSource!==$("source").value){await api(id+"/study/source",{page,text:$("source").value});savedSource=$("source").value;}}
 const data=await api(id+"/page?page="+n+"&ocr="+$("ocr").checked);
 page=data.page;total=data.pages;loaded=true;$("page").value=page;$("total").textContent="/ "+total;
 document.title=data.title+" · Thư Phòng";$("pdf").src="/api/library/file/"+id+"#page="+page;
 $("source").value=data.text;savedSource=data.text;await cached();await save();
 status(data.text?"Trang "+page+" · chữ tiếng Anh có thể hiệu đính trước khi dịch.":"Trang không có chữ. Bật OCR nếu đây là trang scan.");
 }catch(e){status(e.message);}finally{busy=false;controls();}
}
$("prev").onclick=()=>openPage(page-1);$("next").onclick=()=>openPage(page+1);
$("page").onchange=()=>openPage(Math.max(1,Math.min(total,Number($("page").value)||1)));
$("ocr").onchange=()=>openPage(page);
$("model").onchange=()=>cached().catch(e=>status(e.message));
$("source").oninput=()=>{$("result").textContent="Chữ gốc đã thay đổi. Lưu chữ đã sửa rồi dịch lại.";};
$("save-source").onclick=async()=>{try{await api(id+"/study/source",{page,text:$("source").value});savedSource=$("source").value;status("Đã lưu chữ hiệu đính trong két.");}catch(e){status(e.message);}};
$("translate").onclick=async()=>{
 if(busy||!loaded)return;
 if(!$("source").value.trim()){status("Không có chữ để dịch.");return;}
 if($("source").value.length>12000){status("Trang dài quá 12.000 ký tự. Dùng Dịch Kinh Các để dịch theo đoạn.");return;}
 busy=true;controls();status("Đang dịch trên máy…");
 try{if(savedSource!==$("source").value){await api(id+"/study/source",{page,text:$("source").value});savedSource=$("source").value;}
 const data=await api(id+"/translate",body());$("result").textContent=data.translation;status("Bản dịch đã lưu · đối chiếu nguyên bản khi học.");
 }catch(e){status(e.message);}finally{busy=false;controls();}
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
 if(selected){try{
 const candidates=chess.moves({square:selected,verbose:true}).filter(m=>m.to===sq);let promotion="q";
 if(candidates.some(m=>m.promotion)){promotion=(prompt("Phong cấp: q (Hậu), r (Xe), b (Tượng), n (Mã)","q")||"").toLowerCase();if(!["q","r","b","n"].includes(promotion))return;}
 const m=chess.move({from:selected,to:sq,promotion});if(m){selected=null;render();return;}
 }catch{}}
 const p=chess.get(sq);selected=p&&p.color===chess.turn()?sq:null;render();
}
$("undo").onclick=()=>{chess.undo();selected=null;render();};$("flip").onclick=()=>{flip=!flip;render();};
$("reset").onclick=()=>{chess.reset();selected=null;render();};
$("load-position").onclick=()=>{try{const text=$("position").value.trim(),trial=new Chess();if(text.split("/").length===8&&!text.includes("\n"))trial.load(text);else trial.loadPgn(text);if(!text)throw Error();chess.loadPgn(trial.pgn());selected=null;render();$("board-status").textContent="Đã mở thế cờ."; }catch{$("board-status").textContent="FEN hoặc PGN không hợp lệ. Kiểm tra ký hiệu quân và nước đi.";}};
$("download-pgn").onclick=()=>download(chess.pgn(),"thu-phong-thuc-hanh.pgn");render();setView("bilingual");controls();
const started=Date.now();setInterval(()=>{const m=Math.floor((Date.now()-started)/60000),s=Math.floor((Date.now()-started)/1000)%60;$("session").textContent="Phiên học · "+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");},1000);
(async()=>{try{
 const r=await fetch("/api/library?kind=book");if(!r.ok)throw Error("Mở khóa Tàng Kinh Các trước. Bấm liên kết ở góc trái rồi quay lại đây.");
 const books=(await r.json()).filter(x=>x.ext===".pdf");$("books").replaceChildren(new Option("Chọn sách PDF…",""),...books.map(x=>new Option(x.title,String(x.id))));
 if(!id){status("Chọn sách trong tủ. Nếu chưa có, tải PDF lên ở Tàng Kinh Các.");$("books").disabled=false;return;}
 $("books").value=String(id);$("translation").href="/translate.html?id="+id;
 state=await api(id+"/state");job=await api(id+"/batch");$("note").value=state.note||"";$("return").hidden=!state.bookmark;$("ocr").checked=!!job.ocr;
 const models=await api("models");$("model").replaceChildren(...models.models.map(x=>new Option(x==="opus-mt-en-vi"?"OPUS-MT · Anh → Việt":x,x)));
 const preferred=job.model||state.model;if(models.models.includes(preferred))$("model").value=preferred;
 await openPage(state.page||1,true);
 setInterval(()=>fetch("/api/library/item/"+id).then(r=>{if(r.status===401){loaded=false;controls();$("pdf").src="about:blank";$("source").value="";$("result").textContent="";$("note").value="";status("Két đã khóa. Mở khóa rồi tải lại trang.");}}).catch(()=>{}),30000);
 }catch(e){status(e.message);}
})();
