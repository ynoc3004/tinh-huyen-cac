const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fold=value=>String(value??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
const status=value=>$('books-status').textContent=value;
const reader=document.body.dataset.booksView==='reader';
let books=[],editing=null,busy=false;
function safeURL(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw Error('Đường dẫn sách không hợp lệ. Hãy sửa sách và nhập đường dẫn HTTPS.');return url.href;}
async function api(path='',body,method='GET'){
 const response=await fetch('/api/books'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'Kiểm tra tên sách, độ dài nội dung và đường dẫn HTTPS rồi thử lại.');return data;
}
function card(book){
 const href='/book.html?id='+encodeURIComponent(book.id);
 return `<article class="book-card"><a class="book-cover" href="${href}" aria-label="Đọc ${esc(book.title)}"><span class="cover-pawn" aria-hidden="true">♞</span><div class="book-cover-text"><small>SÁCH HỌC TRỰC TUYẾN</small><h2>${esc(book.title)}</h2></div></a><div class="book-details"><p class="book-author">${esc(book.author||'Chưa ghi tác giả')}</p>${book.subject?`<span class="book-subject">${esc(book.subject)}</span>`:''}<p class="book-description">${esc(book.description||'Mở sách để xem nội dung và bắt đầu học.')}</p><div class="book-actions"><a class="primary" href="${href}">Đọc sách →</a><button type="button" data-book-edit="${esc(book.id)}" aria-label="Sửa ${esc(book.title)}">Sửa</button><button type="button" class="delete" data-book-delete="${esc(book.id)}" aria-label="Gỡ ${esc(book.title)} khỏi tủ sách">Gỡ</button></div></div></article>`;
}
function render(){
 const needle=fold($('book-search').value.trim()),subject=$('book-subject').value;
 const matches=books.filter(book=>(!subject||book.subject===subject)&&fold([book.title,book.author,book.subject,book.description].join(' ')).includes(needle));
 $('books-grid').innerHTML=matches.map(card).join('')||`<div class="empty-books"><h2>${books.length?'Chưa tìm thấy sách phù hợp':'Tủ sách đang chờ quyển đầu tiên'}</h2><p>${books.length?'Thử tên không dấu, tác giả hoặc một chủ đề khác.':'Bấm “Thêm sách” và dán đường dẫn của quyển bạn muốn học.'}</p></div>`;
 $('books-count').textContent=matches.length+' / '+books.length+' quyển';
}
function renderSubjects(){
 const selected=$('book-subject').value,subjects=[...new Set(books.map(book=>book.subject).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'vi'));
 $('book-subject').innerHTML='<option value="">Mọi chủ đề</option>'+subjects.map(subject=>`<option value="${esc(subject)}">${esc(subject)}</option>`).join('');
 $('book-subject').value=subjects.includes(selected)?selected:'';
}
function controls(){
 if(reader)return;
 $('book-add').disabled=busy;
 $('book-form').querySelectorAll('input,textarea,button').forEach(el=>el.disabled=busy);
 $('books-grid').querySelectorAll('button').forEach(el=>el.disabled=busy);
}
async function load(){
 $('books-retry').hidden=true;status(reader?'Đang mở sách…':'Đang tải tủ sách…');
 try{
  if(reader){
   $('reader-content').hidden=true;$('reader-external').hidden=true;
   const id=new URLSearchParams(location.search).get('id');if(!id)throw Error('Chưa chọn sách. Trở lại Tủ sách học để chọn một quyển.');
   const book=await api('/'+encodeURIComponent(id)),url=safeURL(book.url);
   document.title=book.title+' · Tĩnh Huyền Quán';$('reader-title').textContent=book.title;
   $('reader-meta').textContent=[book.author,book.subject].filter(Boolean).join(' · ');
   $('reader-external').href=url;$('reader-external').hidden=false;
   $('book-frame').title='Đọc '+book.title;$('book-frame').src=url;$('reader-content').hidden=false;
  }else{books=await api();renderSubjects();render();controls();}
  status('');
 }catch(error){status(error.message);$('books-retry').hidden=false;if(reader)$('reader-title').textContent='Chưa mở được sách';}
}
function openForm(book=null){
 if(busy)return;editing=book?.id||null;
 for(const [id,key] of [['book-title','title'],['book-author','author'],['book-topic','subject'],['book-url','url'],['book-description','description']])$(id).value=book?.[key]||'';
 $('book-dialog-title').textContent=editing?'Sửa thông tin sách':'Thêm sách học';$('book-save').textContent=editing?'Lưu thay đổi':'Thêm vào tủ';$('book-form-status').textContent='';$('book-dialog').showModal();$('book-title').focus();
}
$('books-retry').onclick=load;
if(!reader){
 $('book-add').onclick=()=>openForm();$('book-search').oninput=render;$('book-subject').onchange=render;
 const closeForm=()=>{if(!busy)$('book-dialog').close();};$('book-cancel').onclick=closeForm;$('book-dismiss').onclick=closeForm;
 $('book-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 $('book-form').onsubmit=async event=>{
  event.preventDefault();if(busy||!$('book-form').reportValidity())return;
  const body={title:$('book-title').value,author:$('book-author').value,subject:$('book-topic').value,description:$('book-description').value,url:$('book-url').value.trim()};
  try{safeURL(body.url);}catch(error){$('book-form-status').textContent=error.message;return;}
  busy=true;controls();$('book-form-status').textContent='Đang lưu…';
  try{
   const book=await api(editing?'/'+encodeURIComponent(editing):'',body,editing?'PUT':'POST'),index=books.findIndex(item=>item.id===book.id);
   if(index<0)books.unshift(book);else books[index]=book;
   $('book-search').value='';$('book-subject').value='';renderSubjects();render();$('book-dialog').close();status('Đã '+(editing?'cập nhật':'thêm')+' “'+book.title+'”.');
  }catch(error){$('book-form-status').textContent=error.message;}finally{busy=false;controls();}
 };
 $('books-grid').onclick=async event=>{
  if(busy)return;const edit=event.target.closest('[data-book-edit]'),remove=event.target.closest('[data-book-delete]');if(!edit&&!remove)return;
  const book=books.find(book=>book.id===(edit?.dataset.bookEdit||remove.dataset.bookDelete));if(!book)return;
  if(edit){openForm(book);return;}
  if(!confirm('Gỡ “'+book.title+'” khỏi tủ sách? Trang sách gốc vẫn được giữ nguyên.'))return;
  busy=true;controls();
  try{await api('/'+encodeURIComponent(book.id),undefined,'DELETE');books=books.filter(item=>item.id!==book.id);renderSubjects();render();status('Đã gỡ “'+book.title+'” khỏi tủ sách.');}
  catch(error){status(error.message);}finally{busy=false;controls();}
 };
}
load();
