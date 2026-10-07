
const $=id=>document.getElementById(id),id=Number(new URLSearchParams(location.search).get("id"));
let current=1,total=1,state={page:1,bookmark:null,note:""},engineOnline=false,busy=false,loading=false,seq=0,queue=Promise.resolve(),job={phase:"idle"},running=false,stop=false;
async function api(path,body,method="POST"){
 const r=await fetch("/api/library/translation/"+path,body===undefined?{}:{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 let data;try{data=await r.json();}catch{throw Error("Máy chủ không trả dữ liệu.");}
 if(!r.ok)throw Error(r.status===401?"Tàng Kinh Các đang khóa. Mở khóa rồi tải lại trang.":typeof data.detail==="string"?data.detail:"Không thực hiện được thao tác.");
 return data;
}
function controls(){
 $("batch").disabled=!id||busy||running||loading||!engineOnline||!$("model").value;$("pause").hidden=!running;
 for(const name of ["start","end","chunk-size","ocr","glossary","books","upload"])$(name).disabled=running||busy;

 $("prev").disabled=busy||loading||current<=1;$("next").disabled=busy||loading||current>=total;$("page").disabled=busy||loading;
 $("model").disabled=busy||running;$("translate").disabled=!id||busy||running||loading||!engineOnline||!$("model").value||!$("source").value.trim();$("translate-selection").disabled=$("translate").disabled;
 $("source").disabled=busy;$("reconnect").disabled=busy||running;
}
function body(text=$("source").value){return {page:current,model:$("model").value,glossary:$("glossary").value,text};}
function persist(){
 const snapshot={...state,page:current,note:$("note").value,model:$("model").value};
 state=snapshot;queue=queue.catch(()=>{}).then(()=>api(id+"/state",snapshot,"PUT"));return queue;
}
async function models(){
 try{const data=await api("models");engineOnline=true;$("model").replaceChildren(...data.models.map(name=>{const opt=document.createElement("option");opt.value=name;opt.textContent=name==="opus-mt-en-vi"?"OPUS-MT · Anh → Việt (CPU)":name;return opt;}));
 const preferred=data.models.find(n=>n===state.model)||data.models.find(n=>n==="opus-mt-en-vi");if(preferred)$("model").value=preferred;
 if(!data.models.length)$("status").textContent="Ollama chưa có model. Cài model rồi bấm Kết nối lại.";
 }catch(e){engineOnline=false;$("model").replaceChildren();if(state.model){const opt=document.createElement("option");opt.value=state.model;opt.textContent=state.model+" · ngoại tuyến";$("model").append(opt);}$("status").textContent=e.message;}controls();
}
async function cached(){
 if(!$("model").value)return;
 const token=seq;try{const saved=await api(id+"/batch/page?page="+current);if(token!==seq)return;if(saved.translation&&saved.model===$("model").value&&job.glossary===$("glossary").value){$("result").textContent=saved.translation;$("status").textContent=saved.complete?"Bản dịch trang đã lưu.":"Trang đang dịch · đã lưu phần hoàn thành.";return;}if(!$("source").value.trim()||$("source").value.length>12000)return;const data=await api(id+"/cached",body());if(token!==seq)return;if(data.translation){$("result").textContent=data.translation;$("status").textContent="Đã mở bản dịch lưu trong két · "+data.model;}}catch(e){$("status").textContent=e.message;}
}
async function openPage(n){
 if(!id||busy||loading)return;loading=true;controls();const token=++seq;
 try{
 const data=await api(id+"/page?page="+n+"&ocr="+$("ocr").checked);if(token!==seq)return;
 current=data.page;total=data.pages;$("page").value=current;$("total").textContent="/ "+total;$("title").textContent=data.title;
 $("pdf").src="/api/library/file/"+id+"#page="+current;
 $("source").value=data.text;$("result").textContent="Chọn trang và bấm “Dịch trang này”.";
 $("source-note").textContent=data.text?"Bôi đen đoạn trong ô này để dịch riêng.":"Trang không có chữ trích xuất; có thể là PDF scan.";
 $("status").textContent="Trang "+current+" · "+(data.text?"Sẵn sàng dịch.":"Chưa có chữ để dịch. Dán văn bản vào ô tiếng Anh.");
 if(data.text.length>12000)$("source-note").textContent="Trang dài: chọn từng đoạn tối đa 12.000 ký tự để dịch.";
 if(!engineOnline)$("status").textContent="Chưa kết nối bộ máy dịch. Bản dịch đã lưu vẫn đọc được.";
 await persist();await cached();
 }catch(e){$("status").textContent=e.message;}
 finally{loading=false;controls();}
}
async function translate(selected){
 if(!id||busy||running||loading)return;
 const text=selected?$("source").value.slice($("source").selectionStart,$("source").selectionEnd):$("source").value;
 if(!text.trim()){$("status").textContent=selected?"Bôi đen đoạn cần dịch trong ô tiếng Anh trước.":"Không có chữ để dịch.";return;}
 if(text.length>12000){$("status").textContent="Nội dung quá dài. Chọn một đoạn tối đa 12.000 ký tự.";return;}
 busy=true;controls();$("status").textContent="Đang dịch bằng model local… Lần đầu cần nạp model vào bộ nhớ.";
 try{const data=await api(id+"/translate",body(text));$("result").textContent=data.translation;$("status").textContent=(selected?"Bản dịch đoạn chọn":"Bản dịch trang "+current)+" · "+(data.cached?"Đã mở từ két":"Đã dịch và tự lưu vào két")+" · "+data.model;}
 catch(e){$("status").textContent=e.message;}finally{busy=false;controls();}
}
$("translate").onclick=()=>translate(false);$("translate-selection").onclick=()=>translate(true);
$("prev").onclick=()=>openPage(current-1);$("next").onclick=()=>openPage(current+1);
$("page").onchange=()=>openPage(Math.min(total,Math.max(1,Number($("page").value)||1)));
$("model").onchange=()=>{seq++;controls();$("result").textContent="Chọn trang và bấm dịch bằng model mới.";cached();};
$("reconnect").onclick=async()=>{await models();await cached();};
$("source").oninput=()=>{seq++;controls();$("result").textContent="Văn bản đã thay đổi. Bấm dịch để tạo bản tương ứng.";};
$("bookmark").onclick=async()=>{if(!id)return;state.bookmark=current;$("go-bookmark").hidden=false;try{await persist();$("status").textContent="Đã đánh dấu trang "+current;}catch(e){$("status").textContent=e.message;}};
$("go-bookmark").onclick=()=>openPage(Math.min(total,state.bookmark||1));
$("save-note").onclick=async()=>{if(!id)return;try{await persist();$("status").textContent="Đã lưu ghi chú và vị trí đọc.";}catch(e){$("status").textContent=e.message;}};

function settings(){return {model:$("model").value,start:Number($("start").value),end:Number($("end").value),ocr:$("ocr").checked,chunk_size:Number($("chunk-size").value),glossary:$("glossary").value};}
function progress(){
 if(job.phase==="idle")return;
 const count=job.end-job.start+1;
 $("progress").value=100*(job.done+(job.chunks?job.chunk/job.chunks:0))/count;
 $("progress-label").textContent=job.done+" / "+count+" trang"+(job.chunks?" · đoạn "+job.chunk+"/"+job.chunks:"");
 $("export").hidden=!job.done&&!job.chunk;$("export").href="/api/library/translation/"+id+"/export";
 $("job-note").textContent=job.error||(job.phase==="completed"?"Đã hoàn thành và lưu vào két.":running?"Đang dịch. Giữ tab mở; bạn vẫn có thể đọc sách.":"Tiến độ đã lưu. Bấm tiếp tục khi sẵn sàng.");
}
async function runBatch(){
 if(running||busy||loading)return;
 try{job=await api(id+"/batch/start",settings());running=true;stop=false;controls();progress();
 while(!stop&&job.phase!=="completed"){job=await api(id+"/batch/step",{});progress();await cached();}
 $("status").textContent=job.phase==="completed"?"Đã hoàn thành bản dịch.":"Đã tạm dừng và lưu tiến độ.";
 }catch(e){$("status").textContent=e.message;try{job=await api(id+"/batch");}catch{}}
 finally{running=false;stop=false;$("pause").textContent="Tạm dừng";$("pause").disabled=false;controls();progress();}
}
$("batch").onclick=runBatch;$("pause").onclick=()=>{stop=true;$("pause").textContent="Chờ đoạn hiện tại…";$("pause").disabled=true;};
$("ocr").onchange=()=>openPage(current);
$("books").onchange=()=>{if($("books").value)location.href="/translate.html?id="+$("books").value;};
async function books(){
 const r=await fetch("/api/library?kind=book");if(!r.ok)throw Error("Mở khóa Tàng Kinh Các rồi quay lại trang này.");
 const list=(await r.json()).filter(x=>x.ext===".pdf");
 $("books").replaceChildren(new Option("Chọn sách PDF…",""),...list.map(x=>new Option(x.title,String(x.id))));
 if(id)$("books").value=String(id);return list;
}
$("upload").onchange=async()=>{
 const file=$("upload").files[0];if(!file)return;
 if(!file.name.toLowerCase().endsWith(".pdf")||file.size>150*1024*1024){$("status").textContent="Chọn PDF tối đa 150 MB.";return;}
 $("upload").disabled=true;$("status").textContent="Đang đưa sách vào két…";
 try{const before=await books();const r=await fetch("/api/library/import?name="+encodeURIComponent(file.name),{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:file});const data=await r.json();if(!r.ok)throw Error(typeof data.detail==="string"?data.detail:"Không tải được sách.");
 const after=await books(),added=after.find(x=>!before.some(y=>y.id===x.id));
 if(added)location.href="/translate.html?id="+added.id;else $("status").textContent="Sách đã có trong két. Chọn sách trong danh sách để mở.";
 }catch(e){$("status").textContent=e.message;}finally{$("upload").disabled=false;$("upload").value="";}
};
(async()=>{
 try{await books();if(!id){await models();controls();$("status").textContent="Tải PDF lên hoặc chọn sách đã có trong két.";return;}
 $("original-link").href="/reader.html?id="+id;
 state=await api(id+"/state");job=await api(id+"/batch");$("note").value=state.note||"";$("go-bookmark").hidden=!state.bookmark;
 if(job.phase!=="idle"){state.model=job.model;for(const name of ["start","end","glossary","ocr"]){if(name==="ocr")$(name).checked=job[name];else $(name).value=job[name];}$("chunk-size").value=job.chunk_size;}
 await models();await openPage(state.page||1);if(job.phase==="idle")$("end").value=total;progress();
 setInterval(()=>fetch("/api/library/item/"+id).then(r=>{if(r.status===401){stop=true;$("status").textContent="Két đã khóa. Mở khóa rồi tải lại trang.";}}).catch(()=>{}),30000);
 }catch(e){$("status").textContent=e.message;}
})();
