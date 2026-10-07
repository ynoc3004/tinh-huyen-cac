
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>"&#"+c.charCodeAt(0)+";");
async function request(url,options){const r=await fetch(url,options);if(!r.ok){let msg="HTTP "+r.status;try{msg=(await r.json()).detail||msg;}catch{}throw Error(msg);}return r;}
export async function savePgnToLibrary(pgn,title="Kỳ phổ"){
 const d=document.createElement("dialog");d.className="save-pgn-dialog";
 d.innerHTML='<form method="dialog"><h2>Lưu kỳ phổ vào Tàng Kinh Các</h2><p class="save-status" role="status"></p><div class="save-unlock" hidden><label>Mật khẩu két<input class="save-password" type="password" autocomplete="current-password"></label><button type="button" class="save-unlock-btn">Mở khóa</button><a href="/library.html" target="_blank" rel="noopener">Mở Tàng Kinh Các</a></div><label>Tên kỳ phổ<input class="save-title" maxlength="160" value="'+esc(title)+'"></label><label>Vị trí lưu<select class="save-folder"><option value="0">Gốc Tàng Kinh Các</option></select></label><div class="save-actions"><button type="button" class="save-confirm" disabled>Lưu kỳ phổ</button><button value="cancel">Đóng</button></div></form>';
 document.body.appendChild(d);d.addEventListener("close",()=>d.remove());d.showModal();
 const $=s=>d.querySelector(s),status=$(".save-status");
 async function folders(){
  try{
   const v=await (await request("/api/library/vault/status")).json();
   if(!v.unlocked){$(".save-unlock").hidden=false;status.textContent=v.initialized?"Mở khóa để chọn thư mục lưu.":"Hãy thiết lập Tàng Kinh Các trước, rồi mở khóa tại đây.";return;}
   $(".save-unlock").hidden=true;
   const f=(await (await request("/api/library/folders")).json()).folders;
   const map=new Map(f.map(x=>[x.id,x]));
   const path=(x)=>{let a=[],seen=new Set();while(x&&!seen.has(x.id)){seen.add(x.id);a.unshift(x.name);x=map.get(x.parent_id);}return a.join(" / ");};
   $(".save-folder").innerHTML='<option value="0">Gốc Tàng Kinh Các</option>'+f.map(x=>'<option value="'+x.id+'">'+esc(path(x))+'</option>').join("");
   $(".save-confirm").disabled=false;status.textContent="Chọn thư mục rồi bấm Lưu. Nội dung được mã hóa trong két.";
  }catch(e){status.textContent=e.message;}
 }
 $(".save-unlock-btn").onclick=async()=>{try{await request("/api/library/vault/unlock",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:$(".save-password").value})});$(".save-password").value="";await folders();}catch(e){status.textContent=e.message;}};
 $(".save-confirm").onclick=async()=>{
  const b=$(".save-confirm");b.disabled=true;
  try{const name=($(".save-title").value.trim()||"Kỳ phổ").replace(/[\\/]/g,"-")+".pgn";
   const q=new URLSearchParams({name,folder:$(".save-folder").value});
   const r=await (await request("/api/library/import?"+q,{method:"POST",headers:{"Content-Type":"application/x-chess-pgn"},body:pgn})).json();
   status.textContent=r.result==="duplicate"?"Kỳ phổ đã có trong Tàng Kinh Các; không tạo bản trùng.":"Đã lưu vào thư mục đã chọn.";
  }catch(e){status.textContent=e.message;b.disabled=false;if(e.message.includes("khóa"))$(".save-unlock").hidden=false;}
 };
 await folders();
}
