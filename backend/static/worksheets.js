import {Chess} from '/vendor/chess.js';
import {PIECE_DEFS} from '/vendor/pieces.js';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY='thc-worksheet-draft-v1';
const INITIAL='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const blank=()=>({title:'BÀI TẬP CỜ VUA',kind:'exercise',level:'',instructions:'Ghi nước đi hoặc phương án vào dòng bên dưới mỗi thế cờ.',duration:null,rotate:false,show_prompts:true,header_text:null,footer_text:null,show_page_numbers:true,page_number_format:'Trang {page} / {total}',logo:null,filters:{min_rating:400,max_rating:899,theme:''},exercises:[]});
const textFields={title:'title',kind:'kind',level:'level',instructions:'instructions',header_text:'header-text',footer_text:'footer-text',page_number_format:'page-number-format'};
const checkFields={rotate:'rotate',show_prompts:'show-prompts',show_page_numbers:'show-page-numbers'};
const defaultHeader=()=>`TĨNH HUYỀN QUÁN / ${draft.kind==='test'?'BÀI KIỂM TRA':'PHIẾU BÀI TẬP'}`;
const defaultFooter=()=> 'Tĩnh Huyền Quán - 12 bài / trang';
const logoSource=()=> typeof draft.logo==='string'&&draft.logo.length<=1500000&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(draft.logo)?draft.logo:null;
const uuid=()=>{if(typeof crypto.randomUUID==='function')return crypto.randomUUID();const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');};
let historyOffset=0,historyTotal=0,historyRevision=0;
let draft=blank(),documentId=uuid(),selected=-1,busy=false,options=null,editing=-1,paint='Q',squares=Array(64).fill(''),dirty=false;

async function request(path,body,method='POST'){
 const response=await fetch('/api/worksheets'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(typeof data.detail==='string'?data.detail:'Thông tin chưa hợp lệ. Kiểm tra độ khó, số trang và các ô nhập.');}
 return response;
}
const api=async(path,body,method='POST')=>(await request(path,body,method)).json();
const status=text=>$('status').textContent=text;
function sync(){for(const [key,id] of Object.entries(textFields)){const value=$(id).value;if(key==='header_text'&&draft[key]===null&&value===defaultHeader()||key==='footer_text'&&draft[key]===null&&value===defaultFooter())continue;draft[key]=value;}for(const [key,id] of Object.entries(checkFields))draft[key]=$(id).checked;draft.duration=$('duration').value===''?null:Number($('duration').value);draft.filters={min_rating:Number($('min-rating').value),max_rating:Number($('max-rating').value),theme:$('theme').value};}
function hydrate(){draft={...blank(),...draft};for(const [key,id] of Object.entries(textFields))$(id).value=draft[key]??(key==='header_text'?defaultHeader():key==='footer_text'?defaultFooter():'');for(const [key,id] of Object.entries(checkFields))$(id).checked=!!draft[key];$('duration').value=draft.duration??'';const f=draft.filters||blank().filters;$('min-rating').value=f.min_rating;$('max-rating').value=f.max_rating;$('theme').value=f.theme;$('difficulty').value=options?.levels.find(l=>l.min===f.min_rating&&l.max===f.max_rating)?.id||'custom';$('pages').value=Math.max(1,Math.ceil(draft.exercises.length/12));render();}
function remember(){sync();dirty=true;try{localStorage.setItem(KEY,JSON.stringify({id:documentId,document:draft}));$('save-state').textContent='Bản nháp đã giữ trên máy';}catch{$('save-state').textContent='Chưa lưu - hãy bấm Lưu đề';}controls();}
function controls(){
 const count=draft.exercises.length,ready=count>0&&count%12===0,hasSelection=selected>=0&&selected<count;
 for(const id of ['new','save','add-custom','history-open'])$(id).disabled=busy;
 $('saved').disabled=busy;$('generate').disabled=busy||!options;$('append-page').disabled=busy||!options||count>108;
 for(const id of [...Object.values(textFields),...Object.values(checkFields),'duration','pages','difficulty','min-rating','max-rating','theme','logo-input','logo-remove','reset-branding'])$(id).disabled=busy;
 $('sheets').querySelectorAll('[data-sheet-title], [data-sheet-field]').forEach(el=>el.contentEditable=busy?'false':'plaintext-only');
 $('view-answers').disabled=busy||!count;
 $('export').disabled=busy||!ready;$('answers').disabled=busy||!ready||draft.exercises.some(e=>!e.solution);
 $('generate').textContent='Tạo '+(Number($('pages').value)||1)*12+' bài';
 $('selection-tools').hidden=!hasSelection;
 for(const id of ['replace','edit','remove'])$(id).disabled=busy||!hasSelection;
 $('replace').disabled||=!options;$('up').disabled=busy||selected<=0;$('down').disabled=busy||selected>=count-1;
 $('count').textContent=count?`${count} bài · ${Math.ceil(count/12)} trang${count%12?' · thiếu '+(12-count%12)+' bài để xuất trang cuối':''}`:'Chọn độ khó rồi Tạo 12 bài, hoặc thêm bài tự soạn.';
 if(hasSelection)$('selection-label').textContent=`Bài ${selected+1} · ${draft.exercises[selected].rating===null||draft.exercises[selected].rating===undefined?'Tự soạn':'Điểm câu đố '+draft.exercises[selected].rating}`;
}
function diagram(fen,rotate=false){
 let board;try{board=new Chess(fen);}catch{return '<p>Thế cờ chưa hợp lệ - chọn Chỉnh bài để sửa.</p>';}
 const reverse=rotate&&board.turn()==='b';let body='<rect width="400" height="400" fill="#fff"/>';
 for(let row=0;row<8;row++)for(let col=0;col<8;col++){
  const file=reverse?7-col:col,rank=reverse?row+1:8-row,sq='abcdefgh'[file]+rank,piece=board.get(sq),x=20+col*45,y=20+row*45;
  body+=`<rect x="${x}" y="${y}" width="45" height="45" fill="${(file+rank)%2?'#fff':'#d9d9d9'}"/>`;
  if(piece)body+=`<use href="#${piece.color+piece.type.toUpperCase()}" x="${x}" y="${y}"/>`;
 }
 for(let n=0;n<8;n++){
  const file='abcdefgh'[reverse?7-n:n],rank=reverse?n+1:8-n;
  body+=`<text x="${42.5+n*45}" y="393" text-anchor="middle">${file}</text><text x="8" y="${46+n*45}" text-anchor="middle">${rank}</text>`;
 }
 return `<svg viewBox="0 0 400 400" role="img" aria-label="Thế cờ, ${board.turn()==='w'?'Trắng':'Đen'} đi" style="color-scheme:only light;forced-color-adjust:none"><g fill="#222" font-family="Arial,sans-serif" font-size="12">${body}</g></svg>`;
}
function render(){
 const count=draft.exercises.length,total=Math.max(1,Math.ceil(count/12)),logo=logoSource();let html='';
 $('logo-preview').hidden=!logo;$('logo-remove').hidden=!logo;if(logo)$('logo-preview').src=logo;
 for(let page=0;page<total;page++){
  const details=[draft.level?'Dành cho: '+draft.level:'',draft.duration?'Thời gian: '+draft.duration+' phút':'',draft.kind==='test'?'Điểm: ____ / '+count:''].filter(Boolean).join(' | ');
  html+=`<article class="sheet"${page>0?' data-continuation="true"':''}><div class="sheet-heading"><div class="sheet-heading-text"><p class="sheet-brand" contenteditable="plaintext-only" data-sheet-field="header_text" role="textbox" aria-label="Sửa header trực tiếp" aria-multiline="false" spellcheck="false" title="Bấm để sửa header">${esc(draft.header_text??defaultHeader())}</p>${page===0?`<h3 contenteditable="plaintext-only" data-sheet-title="${page}" role="textbox" aria-label="Sửa tiêu đề trực tiếp" aria-multiline="false" spellcheck="false" title="Bấm để sửa tiêu đề">${esc(draft.title)}</h3>`:''}</div>${page===0&&logo?`<img class="sheet-logo" src="${esc(logo)}" alt="Logo đơn vị">`:''}</div>${page===0?`<div class="student-fields"><span>Họ tên: <i></i></span><span>Level: <i></i></span></div>${details?`<p class="sheet-details">${esc(details)}</p>`:''}<p class="sheet-instructions">${esc(draft.instructions)}</p>`:''}${!count?'<p class="empty-tip">12 thế cờ sẽ được bố trí tại đây.</p>':''}<div class="sheet-grid">`;
  for(let n=0;n<12;n++){
   const index=page*12+n,e=draft.exercises[index];
   html+=e?`<section tabindex="0" role="button" aria-label="Chỉnh bài ${index+1}" aria-pressed="${index===selected}" class="sheet-exercise${index===selected?' selected':''}" data-exercise="${index}"><div class="caption"><span>${index+1}. ${e.fen.split(' ')[1]==='w'?'Trắng':'Đen'} đi</span></div>${diagram(e.fen,draft.rotate)}${draft.show_prompts?`<p class="prompt">${esc(e.instruction)}</p>`:'<div class="prompt-space" aria-hidden="true"></div>'}<div class="write-line"></div></section>`:`<div class="placeholder">Bài ${index+1}<br>Chưa có thế cờ</div>`;
  }
  const numbering=draft.show_page_numbers?draft.page_number_format.replaceAll('{page}',String(page+1)).replaceAll('{total}',String(total)):'';
  html+=`</div><footer class="sheet-footer"><span contenteditable="plaintext-only" data-sheet-field="footer_text" role="textbox" aria-label="Sửa footer trực tiếp" aria-multiline="false" spellcheck="false" title="Bấm để sửa footer">${esc(draft.footer_text??defaultFooter())}</span><span class="sheet-pagination">${esc(numbering)}</span></footer></article>`;
 }
 $('sheets').innerHTML=html;controls();
}
function selection(count){
 const min=Number($('min-rating').value),max=Number($('max-rating').value);
 if(!Number.isInteger(min)||!Number.isInteger(max)||min<0||max>4000||min>max)throw Error('Kiểm tra lại khoảng điểm câu đố (0-4000).');
 return {count,min_rating:min,max_rating:max,theme:$('theme').value,exclude:draft.exercises.map(e=>e.id)};
}
async function generate(append=false,replace=false){
 if(busy)return;
 try{
  const pages=Number($('pages').value);
  if(!append&&!replace&&(!Number.isInteger(pages)||pages<1||pages>10))throw Error('Số trang từ 1 đến 10.');
  if(!append&&!replace&&draft.exercises.length&&!confirm('Tạo bộ bài mới và thay các bài hiện tại?'))return;
  const count=replace?1:append?12:pages*12;
  if(append&&draft.exercises.length+count>120)throw Error('Mỗi đề tối đa 120 bài.');
  const body=selection(count);if(!append&&!replace)body.exclude=[];
  busy=true;controls();status('Đang chọn bài đúng bộ lọc…');
  sync();const result=await api('/generate',{document_id:documentId,request_id:uuid(),document:draft,selection:body,mode:replace?'replace':append?'append':'generate',index:replace?selected:null});
  draft=result.document;if(!append&&!replace)selected=0;hydrate();
  remember();render();dirty=false;$('save-state').textContent='Đã tự lưu vào lịch sử';await loadSaved();status(`Đã ${replace?'đổi bài':append?'thêm 12 bài':'tạo '+count+' bài'} và lưu phiên bản kèm đáp án. Bạn có thể chỉnh từng thế cờ trước khi xuất PDF.`);
 }catch(error){status(error.message);}finally{busy=false;controls();}
}
$('generate').onclick=()=>generate();$('append-page').onclick=()=>generate(true);$('replace').onclick=()=>generate(false,true);
$('pages').oninput=controls;
$('difficulty').onchange=()=>{const level=options.levels.find(l=>l.id===$('difficulty').value);if(level){$('min-rating').value=level.min;$('max-rating').value=level.max;}remember();};
for(const id of ['min-rating','max-rating'])$(id).oninput=()=>{$('difficulty').value='custom';remember();};
$('theme').onchange=remember;
for(const id of ['title','level','instructions','duration','rotate','show-prompts','header-text','footer-text','show-page-numbers','page-number-format'])$(id).addEventListener('input',()=>{remember();render();});
$('kind').onchange=()=>{if(['BÀI TẬP CỜ VUA','BÀI KIỂM TRA CỜ VUA'].includes($('title').value))$('title').value=$('kind').value==='test'?'BÀI KIỂM TRA CỜ VUA':'BÀI TẬP CỜ VUA';if(draft.header_text===null){draft.kind=$('kind').value;$('header-text').value=defaultHeader();}remember();render();};
$('reset-branding').onclick=()=>{if(busy)return;draft.header_text=null;draft.footer_text=null;$('header-text').value=defaultHeader();$('footer-text').value=defaultFooter();$('page-number-format').value=blank().page_number_format;remember();render();};
$('sheets').onclick=event=>{if(event.target.closest('[data-sheet-title], [data-sheet-field]'))return;const card=event.target.closest('[data-exercise]');if(card&&!busy){selected=Number(card.dataset.exercise);render();}};
$('sheets').onkeydown=event=>{if(event.target.dataset.sheetTitle!==undefined||event.target.dataset.sheetField!==undefined){if(event.key==='Enter'){event.preventDefault();event.target.blur();}return;}if(['Enter',' '].includes(event.key)&&event.target.dataset.exercise!==undefined){event.preventDefault();selected=Number(event.target.dataset.exercise);render();}};
$('sheets').addEventListener('input',event=>{
 const key=event.target.dataset.sheetTitle!==undefined?'title':event.target.dataset.sheetField;
 if(!['title','header_text','footer_text'].includes(key)||busy)return;
 const text=(event.target.textContent||'').replace(/[\r\n]+/g,' ').slice(0,120);
 if(event.target.textContent!==text)event.target.textContent=text;
 $(textFields[key]).value=text;remember();
 $('sheets').querySelectorAll(key==='title'?'[data-sheet-title]':`[data-sheet-field="${key}"]`).forEach(el=>{if(el!==event.target)el.textContent=text;});
});

$('logo-input').onchange=async()=>{
 const file=$('logo-input').files?.[0];if(!file||busy)return;
 try{
  if(file.size>5*1024*1024)throw Error('Logo vượt quá 5 MB. Hãy chọn ảnh nhỏ hơn.');
  busy=true;controls();$('logo-state').textContent='Đang căn chỉnh logo…';
  const response=await fetch('/api/worksheets/logo',{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
  const result=await response.json();if(!response.ok)throw Error(typeof result.detail==='string'?result.detail:'Không xử lý được logo. Hãy thử ảnh PNG, JPG hoặc WebP khác.');
  draft.logo=result.logo;remember();render();$('logo-state').textContent='Đã căn chỉnh logo, chỉ đặt ở trang đầu. Logo được giữ cùng đề khi lưu hoặc xuất PDF.';status('Đã thêm logo. Bạn có thể sửa header, footer và xem bố cục trước khi xuất PDF.');
 }catch(error){$('logo-state').textContent=error.message;}finally{$('logo-input').value='';busy=false;controls();}
};
$('logo-remove').onclick=()=>{if(busy)return;draft.logo=null;remember();render();$('logo-state').textContent='Đã gỡ logo khỏi bản nháp. Bạn có thể chọn ảnh khác.';};

const actionLabel=action=>({generate:'Tạo đề',append:'Thêm trang',replace:'Đổi bài',save:'Lưu đề',export:'Xuất PDF',migration:'Đề đã lưu trước đây',before_generate:'Bản trước khi thay bài',edit:'Tự soạn / sửa bài',before_edit:'Bản trước khi sửa'}[action]||'Lưu phiên bản');
function historyTime(value){const date=new Date(value.replace(' ','T')+'Z');return Number.isNaN(date.getTime())?value:date.toLocaleString('vi-VN');}
async function showHistory(){
 const revision=++historyRevision;$('history-status').textContent='Đang tải lịch sử…';
 try{const response=await api('/history?q='+encodeURIComponent($('history-search').value)+'&offset='+historyOffset,undefined,'GET');if(revision!==historyRevision)return;
  historyTotal=response.total;
  $('history-list').innerHTML=response.items.map(item=>`<article class="history-card"><h3>${esc(item.title)}</h3><p>${esc(historyTime(item.created_at))} · ${esc(actionLabel(item.action))} · ${item.count} bài · ${item.answer_count} đáp án${item.level?' · '+esc(item.level):''}</p><div class="history-actions"><button class="secondary" data-history-load="${item.id}">Mở phiên bản này</button><button class="secondary" data-history-answers="${item.id}">Xem đáp án</button>${item.count&&item.count%12===0?`<a href="/api/worksheets/history/${item.id}/pdf" download>PDF học sinh</a>${item.answer_count===item.count?`<a href="/api/worksheets/history/${item.id}/pdf?answers=true" download>PDF đáp án</a>`:''}`:''}</div></article>`).join('')||'<p class="hint">Chưa có phiên bản phù hợp.</p>';
  $('history-page').textContent=`${response.total?'Trang '+(Math.floor(historyOffset/12)+1)+' / '+Math.ceil(response.total/12):'0 phiên bản'} · ${response.total} phiên bản`;
  $('history-prev').disabled=historyOffset===0;$('history-next').disabled=historyOffset+12>=historyTotal;$('history-status').textContent='';
 }catch(error){if(revision===historyRevision)$('history-status').textContent=error.message;}
}
$('history-open').onclick=()=>{historyOffset=0;$('history-dialog').showModal();return showHistory();};
$('history-close').onclick=()=>{historyRevision++;$('history-dialog').close();};
$('history-search').oninput=()=>{historyOffset=0;return showHistory();};
$('history-prev').onclick=()=>{historyOffset=Math.max(0,historyOffset-12);return showHistory();};
$('history-next').onclick=()=>{if(historyOffset+12<historyTotal)historyOffset+=12;return showHistory();};
function showAnswers(document){
 $('answers-title').textContent='Đáp án · '+document.title;
 $('answers-list').innerHTML=document.exercises.map((e,index)=>`<article class="answer-item"><div>${diagram(e.fen,document.rotate)}</div><div><h3>Bài ${index+1} · ${e.fen.split(' ')[1]==='w'?'Trắng':'Đen'} đi</h3><p>${esc(e.instruction)}</p><p><code>${esc(e.solution||'Chưa nhập đáp án')}</code></p><small>Mã bài: ${esc(e.id)}</small></div></article>`).join('')||'<p>Đề chưa có bài.</p>';
 $('answers-dialog').showModal();
}
$('view-answers').onclick=()=>{sync();showAnswers(draft);};$('answers-close').onclick=()=>$('answers-dialog').close();
$('history-list').onclick=async event=>{
 const open=event.target.closest('[data-history-load]'),answers=event.target.closest('[data-history-answers]');if(!open&&!answers)return;
 if(open&&dirty&&!confirm('Mở phiên bản này và thay bản nháp hiện tại?'))return;
 const button=open||answers;button.disabled=true;
 try{const snapshot=await api('/history/'+(open?open.dataset.historyLoad:answers.dataset.historyAnswers),undefined,'GET');
  if(answers){showAnswers(snapshot.document);return;}
  draft=snapshot.document;documentId=snapshot.id;selected=draft.exercises.length?0:-1;hydrate();remember();dirty=false;
  $('save-state').textContent='Đã mở phiên bản lịch sử';$('history-dialog').close();status('Đã mở đúng đề và đáp án đã lưu. Khi sửa rồi lưu, ứng dụng tạo phiên bản mới.');
 }catch(error){$('history-status').textContent=error.message;}finally{button.disabled=false;}
};
function move(delta){if(busy)return;const next=selected+delta;if(next<0||next>=draft.exercises.length)return;[draft.exercises[selected],draft.exercises[next]]=[draft.exercises[next],draft.exercises[selected]];selected=next;remember();render();}
$('up').onclick=()=>move(-1);$('down').onclick=()=>move(1);
$('remove').onclick=()=>{if(selected<0||busy||!confirm('Bỏ bài '+(selected+1)+' khỏi đề?'))return;draft.exercises.splice(selected,1);selected=Math.min(selected,draft.exercises.length-1);remember();render();};
async function loadSaved(){const list=await api('',undefined,'GET');$('saved').innerHTML='<option value="">Chọn một đề…</option>'+list.map(item=>`<option value="${esc(item.id)}">${esc(item.title)} · ${item.count} bài</option>`).join('');}
$('save').onclick=async()=>{
 if(busy)return;try{sync();const snapshot=JSON.stringify(draft);busy=true;controls();const result=await api('/'+documentId,draft,'PUT');sync();dirty=JSON.stringify(draft)!==snapshot;if(!dirty){draft=result.document;hydrate();try{localStorage.setItem(KEY,JSON.stringify({id:documentId,document:draft}));}catch{}}await loadSaved();$('save-state').textContent=dirty?'Đã lưu đề; còn thay đổi mới trong bản nháp':'Đề đã lưu';status('Đã lưu đề. Bạn có thể mở lại từ danh sách đề đã lưu.');}catch(error){status(error.message);}finally{busy=false;controls();}
};
$('saved').onchange=async()=>{
 const id=$('saved').value;if(!id||busy)return;if(dirty&&!confirm('Mở đề đã lưu và thay bản nháp hiện tại?')){$('saved').value='';return;}
 try{busy=true;controls();const result=await api('/'+id,undefined,'GET');draft=result.document;documentId=result.id;selected=draft.exercises.length?0:-1;hydrate();remember();dirty=false;$('save-state').textContent='Đề đã lưu';status('Đã mở đề.');}catch(error){status(error.message);}finally{busy=false;controls();}
};
$('new').onclick=()=>{if(busy||dirty&&!confirm('Tạo đề mới và thay bản nháp hiện tại?'))return;draft=blank();documentId=uuid();selected=-1;hydrate();remember();status('Đề mới: chọn bài từ kho hoặc tự biên soạn.');};
async function exportPdf(answers=false){
 if(busy)return;try{sync();if(!draft.title.trim())throw Error('Nhập tiêu đề trước khi xuất PDF.');const snapshot=JSON.parse(JSON.stringify(draft));busy=true;controls();status('Đang tạo PDF '+(answers?'đáp án giáo viên':'học sinh')+'…');const response=await request('/pdf?document_id='+encodeURIComponent(documentId)+(answers?'&answers=true':''),snapshot);const blob=await response.blob();const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(snapshot.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,90)||'Bai-tap')+(answers?' - Dap-an':'')+'.pdf';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);await loadSaved();$('save-state').textContent='Đã lưu phiên bản xuất PDF';status('Đã tải PDF '+(answers?'đáp án':'học sinh')+' và giữ đề kèm đáp án trong lịch sử.');}catch(error){status(error.message);}finally{busy=false;controls();}
}
$('export').onclick=()=>exportPdf();$('answers').onclick=()=>exportPdf(true);

function readPlacement(fen){const ranks=fen.trim().split(/\s+/)[0].split('/');if(ranks.length!==8)throw Error('FEN phải có 8 hàng.');const result=[];for(const rank of ranks){let row=[];for(const char of rank){if(/[1-8]/.test(char))row.push(...Array(Number(char)).fill(''));else if(/[prnbqkPRNBQK]/.test(char))row.push(char);else throw Error('Ký hiệu quân trong FEN chưa hợp lệ.');}if(row.length!==8)throw Error('Mỗi hàng FEN phải có 8 ô.');result.push(...row);}return result;}
function placement(){const rows=[];for(let row=0;row<8;row++){let text='',empty=0;for(const p of squares.slice(row*8,row*8+8)){if(!p){empty++;continue;}if(empty){text+=empty;empty=0;}text+=p;}if(empty)text+=empty;rows.push(text);}return rows.join('/');}
function redrawEditor(){let html='';for(let i=0;i<64;i++){const p=squares[i],file=i%8,rank=8-Math.floor(i/8),id=p?(p===p.toUpperCase()?'w':'b')+p.toUpperCase():'';html+=`<button type="button" class="editor-square${(file+rank)%2?'':' dark'}" data-square="${i}" aria-label="${'abcdefgh'[file]+rank}${p?' '+p:''}">${id?`<svg viewBox="0 0 45 45" aria-hidden="true"><use href="#${id}"/></svg>`:''}</button>`;}$('editor-board').innerHTML=html;}
function loadFen(){try{squares=readPlacement($('editor-fen').value);$('editor-turn').value=$('editor-fen').value.trim().split(/\s+/)[1]==='b'?'b':'w';redrawEditor();$('editor-status').textContent='Bấm lưu để kiểm tra đầy đủ thế cờ và đáp án.';}catch(error){$('editor-status').textContent=error.message;}}
function writeFen(){ $('editor-fen').value=placement()+' '+$('editor-turn').value+' - - 0 1';redrawEditor();}
function openEditor(index=-1){if(busy)return;editing=index;const e=index>=0?draft.exercises[index]:null;$('editor-title').textContent=e?'Chỉnh bài '+(index+1):'Thêm bài tự soạn';$('apply-exercise').textContent=e?'Kiểm tra và lưu bài':'Kiểm tra và thêm bài';$('editor-fen').value=e?.fen||INITIAL;$('editor-instruction').value=e?.instruction||'Tìm nước đi tốt nhất.';$('editor-solution').value=e?.solution||'';$('editor-status').textContent='';loadFen();$('editor').showModal();}
$('add-custom').onclick=()=>{if(draft.exercises.length>=120)return status('Mỗi đề tối đa 120 bài.');openEditor();};$('edit').onclick=()=>openEditor(selected);
$('close-editor').onclick=()=>{if(!$('apply-exercise').disabled)$('editor').close();};$('load-fen').onclick=loadFen;
$('palette').innerHTML=['K','Q','R','B','N','P','', 'k','q','r','b','n','p'].map(p=>`<button type="button" class="secondary${p===paint?' chosen':''}" data-paint="${p}" aria-label="${p?'Chọn quân '+p:'Tẩy quân'}">${p?`<svg viewBox="0 0 45 45" aria-hidden="true"><use href="#${(p===p.toUpperCase()?'w':'b')+p.toUpperCase()}"/></svg>`:'Tẩy'}</button>`).join('');
$('palette').onclick=event=>{const button=event.target.closest('[data-paint]');if(!button)return;paint=button.dataset.paint;$('palette').querySelectorAll('button').forEach(b=>b.classList.toggle('chosen',b.dataset.paint===paint));};
$('editor-board').onclick=event=>{const b=event.target.closest('[data-square]');if(b){squares[Number(b.dataset.square)]=paint;writeFen();}};
$('editor-turn').onchange=()=>{const fields=$('editor-fen').value.trim().split(/\s+/);fields[1]=$('editor-turn').value;$('editor-fen').value=fields.join(' ');};
$('initial-board').onclick=()=>{$('editor-fen').value=INITIAL;loadFen();};$('clear-board').onclick=()=>{squares=Array(64).fill('');writeFen();};
$('editor-form').onsubmit=async event=>{event.preventDefault();const button=$('apply-exercise');if(button.disabled)return;button.disabled=true;$('editor-status').textContent='Đang kiểm tra…';try{sync();const result=await api('/edit',{document_id:documentId,document:draft,index:editing>=0?editing:null,exercise:{id:'custom-'+uuid(),fen:$('editor-fen').value,instruction:$('editor-instruction').value,solution:$('editor-solution').value,source:'custom'}});draft=result.document;if(editing<0)selected=draft.exercises.length-1;remember();render();dirty=false;$('save-state').textContent='Đã tự lưu bài và đáp án';await loadSaved();$('editor').close();status('Đã lưu bài và đáp án vào lịch sử. Thế cờ và chuỗi nước hợp lệ; bạn cần kiểm tra đáp án tối ưu của bài tự soạn.');}catch(error){$('editor-status').textContent=error.message;}finally{button.disabled=false;}};

async function boot(){
 $('piece-definitions').innerHTML='<defs>'+PIECE_DEFS+'</defs>';
 let restoredDraft=false;
 try{const stored=JSON.parse(localStorage.getItem(KEY)||'null');if(stored?.document&&Array.isArray(stored.document.exercises)&&stored.document.exercises.length<=120&&stored.document.exercises.every(e=>{try{return typeof e.fen==='string'&&!!new Chess(e.fen)}catch{return false}})){draft={...blank(),...stored.document};documentId=stored.id||uuid();dirty=true;restoredDraft=draft.exercises.length>0;busy=restoredDraft;}}catch{}
 hydrate();
 const results=await Promise.allSettled([api('/options',undefined,'GET'),loadSaved()]);
 if(results[0].status==='fulfilled'){options=results[0].value;$('difficulty').innerHTML=options.levels.map(l=>`<option value="${esc(l.id)}">${esc(l.name)} (${l.min}-${l.max})</option>`).join('')+'<option value="custom">Tùy chỉnh</option>';$('theme').innerHTML=Object.entries(options.themes).map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('');$('bank').textContent=`${options.bank.name}: ${options.bank.count.toLocaleString('vi-VN')} bài. Không lặp bài trong một đề được tạo tự động.`;}else{status(results[0].reason.message);$('bank').textContent='Chưa kết nối kho. Bạn vẫn có thể tự soạn bài.';}
 if(results[1].status==='rejected')status(results[1].reason.message);hydrate();
 if(restoredDraft){
  try{sync();const saved=await api('/'+documentId,draft,'PUT');draft=saved.document;hydrate();dirty=false;await loadSaved();$('save-state').textContent='Bản nháp đã đưa vào lịch sử';status('Đã giữ đề đang mở cùng đáp án vào lịch sử; bạn có thể tiếp tục sửa.');}
  catch(error){status('Bản nháp vẫn giữ trên máy, chưa đưa được vào lịch sử: '+error.message);}
 }
 busy=false;controls();
}
boot();
