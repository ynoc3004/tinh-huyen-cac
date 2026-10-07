
const $=id=>document.getElementById(id),id=Number(new URLSearchParams(location.search).get("id"));
let current=1,total=1,state={page:1,bookmark:null,note:""},engineOnline=false,busy=false,loading=false,seq=0,queue=Promise.resolve();
async function api(path,body,method="POST"){
 const r=await fetch("/api/library/translation/"+path,body===undefined?{}:{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 let data;try{data=await r.json();}catch{throw Error("Máy chủ không trả dữ liệu.");}
 if(!r.ok)throw Error(r.status===401?"Tàng Kinh Các đang khóa. Mở khóa rồi tải lại trang.":typeof data.detail==="string"?data.detail:"Không thực hiện được thao tác.");
 return data;
}
function controls(){
 $("prev").disabled=busy||loading||current<=1;$("next").disabled=busy||loading||current>=total;$("page").disabled=busy||loading;
 $("model").disabled=busy;$("translate").disabled=busy||loading||!engineOnline||!$("model").value||!$("source").value.trim();$("translate-selection").disabled=$("translate").disabled;
 $("source").disabled=busy;$("reconnect").disabled=busy;
}
function body(text=$("source").value){return {page:current,model:$("model").value,text};}
function persist(){
 const snapshot={...state,page:current,note:$("note").value,model:$("model").value};
 state=snapshot;queue=queue.catch(()=>{}).then(()=>api(id+"/state",snapshot,"PUT"));return queue;
}
async function models(){
 try{const data=await api("models");engineOnline=true;$("model").replaceChildren(...data.models.map(name=>{const opt=document.createElement("option");opt.value=name;opt.textContent=name;return opt;}));
 const preferred=data.models.find(n=>n===state.model)||data.models.find(n=>n==="qwen3:4b");if(preferred)$("model").value=preferred;
 if(!data.models.length)$("status").textContent="Ollama chưa có model. Cài model rồi bấm Kết nối lại.";
 }catch(e){engineOnline=false;$("model").replaceChildren();if(state.model){const opt=document.createElement("option");opt.value=state.model;opt.textContent=state.model+" · ngoại tuyến";$("model").append(opt);}$("status").textContent=e.message;}controls();
}
async function cached(){
 if(!$("model").value||!$("source").value.trim()||$("source").value.length>12000)return;
 const token=seq;try{const data=await api(id+"/cached",body());if(token!==seq)return;if(data.translation){$("result").textContent=data.translation;$("status").textContent="Đã mở bản dịch lưu trong két · "+data.model;}}catch(e){$("status").textContent=e.message;}
}
async function openPage(n){
 if(busy||loading)return;loading=true;controls();const token=++seq;
 try{
 const data=await api(id+"/page?page="+n);if(token!==seq)return;
 current=data.page;total=data.pages;$("page").value=current;$("total").textContent="/ "+total;$("title").textContent=data.title;
 $("pdf").src="/api/library/file/"+id+"#page="+current;
 $("source").value=data.text;$("result").textContent="Chọn trang và bấm “Dịch trang này”.";
 $("source-note").textContent=data.text?"Bôi đen đoạn trong ô này để dịch riêng.":"Trang không có chữ trích xuất; có thể là PDF scan.";
 $("status").textContent="Trang "+current+" · "+(data.text?"Sẵn sàng dịch.":"Chưa có chữ để dịch. Dán văn bản vào ô tiếng Anh.");
 if(data.text.length>12000)$("source-note").textContent="Trang dài: chọn từng đoạn tối đa 12.000 ký tự để dịch.";
 if(!engineOnline)$("status").textContent="Ollama chưa kết nối. Bản dịch đã lưu vẫn đọc được; bấm Kết nối lại để dịch mới.";
 await persist();await cached();
 }catch(e){$("status").textContent=e.message;}
 finally{loading=false;controls();}
}
async function translate(selected){
 if(busy||loading)return;
 const text=selected?$("source").value.slice($("source").selectionStart,$("source").selectionEnd):$("source").value;
 if(!text.trim()){$("status").textContent=selected?"Bôi đen đoạn cần dịch trong ô tiếng Anh trước.":"Không có chữ để dịch.";return;}
 if(text.length>12000){$("status").textContent="Nội dung quá dài. Chọn một đoạn tối đa 12.000 ký tự.";return;}
 busy=true;controls();$("status").textContent="Đang dịch bằng Ollama local… Có thể mất vài phút.";
 try{const data=await api(id+"/translate",body(text));$("result").textContent=data.translation;$("status").textContent=(selected?"Bản dịch đoạn chọn":"Bản dịch trang "+current)+" · "+(data.cached?"Đã mở từ két":"Đã dịch và tự lưu vào két")+" · "+data.model;}
 catch(e){$("status").textContent=e.message;}finally{busy=false;controls();}
}
$("translate").onclick=()=>translate(false);$("translate-selection").onclick=()=>translate(true);
$("prev").onclick=()=>openPage(current-1);$("next").onclick=()=>openPage(current+1);
$("page").onchange=()=>openPage(Math.min(total,Math.max(1,Number($("page").value)||1)));
$("model").onchange=()=>{seq++;controls();$("result").textContent="Chọn trang và bấm dịch bằng model mới.";cached();};
$("reconnect").onclick=async()=>{await models();await cached();};
$("source").oninput=()=>{seq++;controls();$("result").textContent="Văn bản đã thay đổi. Bấm dịch để tạo bản tương ứng.";};
$("bookmark").onclick=async()=>{state.bookmark=current;$("go-bookmark").hidden=false;try{await persist();$("status").textContent="Đã đánh dấu trang "+current;}catch(e){$("status").textContent=e.message;}};
$("go-bookmark").onclick=()=>openPage(Math.min(total,state.bookmark||1));
$("save-note").onclick=async()=>{try{await persist();$("status").textContent="Đã lưu ghi chú và vị trí đọc.";}catch(e){$("status").textContent=e.message;}};
(async()=>{
 if(!id){$("status").textContent="Chọn một sách PDF trong Tàng Kinh Các để đọc và dịch.";return;}
 $("original-link").href="/reader.html?id="+id;
 try{state=await api(id+"/state");$("note").value=state.note||"";$("go-bookmark").hidden=!state.bookmark;await models();await openPage(state.page||1);
 setInterval(()=>fetch("/api/library/item/"+id).then(r=>{if(r.status===401)location.reload();}).catch(()=>{}),30000);
 }catch(e){$("status").textContent=e.message;}
})();
