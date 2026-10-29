'use strict';
const BOOK_ID = new URLSearchParams(location.search).get('id') || '';
const BASE = '/api/books/' + encodeURIComponent(BOOK_ID);
const KEY = 'thc-offline-book-' + BOOK_ID;
let bookInfo = {};
const assetURL = name => BASE + '/asset/' + name.split('/').map(encodeURIComponent).join('/');
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const defaults = () => ({version:1, completed:[], bookmarks:[], notes:{}, positions:{}, last:null, prefs:{size:19,serif:false,dark:false,typographyVersion:2}});
let state=defaults(), catalog=[], figures={}, labels={}, current=null, currentPage=null, routeRun=0, activeFilter='all', saveTimer, searchRun=0;
const cache=new Map();
try { const saved=JSON.parse(localStorage.getItem(KEY)||'null'); if(saved && saved.version===1) state={...state,...saved,prefs:{...state.prefs,...saved.prefs,typographyVersion:saved.prefs?.typographyVersion||0}}; } catch {}
if(state.prefs.typographyVersion!==2){state.prefs.serif=false;if(state.prefs.size===20)state.prefs.size=19;state.prefs.typographyVersion=2;}
let storageWarning=false;
function persist(immediate=false){
  clearTimeout(saveTimer);
  const write=()=>{try{localStorage.setItem(KEY,JSON.stringify(state));}catch{if(!storageWarning){toast('Trình duyệt không lưu được dữ liệu. Hãy xuất bản sao lưu.');storageWarning=true;}}};
  if(immediate)write();else saveTimer=setTimeout(write,600);
}
function el(tag, className, text){const x=document.createElement(tag);if(className)x.className=className;if(text!==undefined)x.textContent=text;return x;}
function button(text,className,handler){const x=el('button',className,text);x.type='button';if(handler)x.addEventListener('click',handler);return x;}
function toast(message){const x=$('#toast');x.textContent=message;x.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>x.classList.remove('show'),3000);}
function applyPrefs(){const p=state.prefs;document.body.classList.toggle('dark',!!p.dark);document.documentElement.style.setProperty('--reading-size',Math.max(16,Math.min(28,Number(p.size)||19))+'px');document.documentElement.style.setProperty('--reading-font',p.serif?'"Noto Serif VI",Georgia,serif':'"Be Vietnam Pro",Arial,sans-serif');$('#font-size').value=p.size;$('#font-size-label').textContent=p.size+' px';$('#serif-toggle').checked=!!p.serif;$('#theme-button').setAttribute('aria-pressed',String(!!p.dark));}
function meta(id){return catalog.find(c=>c.id===id);}
function chapterNumber(c){return c.number?String(c.number).padStart(2,'0'):c.id==='intro'?'LĐ':c.id==='glossary'?'TN':c.id==='index'?'TC':c.id==='contents'?'ML':'XB';}
function pageLabel(page){return labels[page]?`Trang ${labels[page]} · PDF ${page}`:`PDF ${page}`;}
function go(id,page){location.hash=id==='home'?'home':`${id}${page?'/'+page:''}`;}
function closeSidebar(){$('#sidebar').classList.remove('open');$('#sidebar-shade').classList.remove('open');$('#menu-button').setAttribute('aria-expanded','false');}
function renderNav(){
  const nav=$('#chapter-nav');nav.replaceChildren();
  for(const c of catalog){
    if(c.id==='glossary'){const d=el('div','nav-extra');nav.append(d);}
    const b=button('',`nav-item${current===c.id?' active':''}`,()=>go(c.id,state.positions[c.id]?.page));
    b.append(el('span','nav-number',chapterNumber(c)),el('span','nav-name',c.title));
    if(state.completed.includes(c.id))b.append(el('span','nav-status','✓'));
    if(current===c.id)b.setAttribute('aria-current','page');
    nav.append(b);
  }
  $('#home-button').classList.toggle('active',!current);
  const count=state.completed.filter(id=>meta(id)?.number).length;
  $('#progress-count').textContent=`${count} / ${bookInfo.chapters || 0}`;
  $('#progress-fill').style.width=(count/(bookInfo.chapters || 1)*100)+'%';
}
function source(page){
  if(!bookInfo.pdf){toast('Gói sách này không kèm PDF gốc.');return;}
  $('#source-title').textContent=pageLabel(page)+' · sách gốc';
  const url=assetURL('book.pdf')+`#page=${page}&view=FitH`;
  $('#source-frame').src=url;$('#source-link').href=url;$('#source-dialog').showModal();
}
async function load(id){
  if(!cache.has(id))cache.set(id,fetch(BASE+`/content/${id}.json`).then(r=>{if(!r.ok)throw Error('Nội dung chưa tải được');return r.json();}).catch(e=>{cache.delete(id);throw e;}));
  return cache.get(id);
}
function renderHome(){
  current=null;currentPage=null;document.title=bookInfo.title+' · Tĩnh Huyền Các';$('#breadcrumb-current').textContent=bookInfo.title;
  const home=el('div','home');
  const hero=el('section','hero');const copy=el('div','hero-copy');copy.append(el('div','hero-eyebrow','TỦ SÁCH HỌC / NGOẠI TUYẾN'));
  const h=el('h1');h.append(document.createTextNode('Hiểu thế cờ.'),el('br'),el('em','','Tìm đúng kế hoạch.'));copy.append(h);
  const sub=el('p','hero-subtitle');sub.append(el('b','',bookInfo.title),document.createTextNode(' — '+(bookInfo.author||'')+'. '+(bookInfo.description||'Đọc và học từng chương từ bản đã lưu trên máy.')));copy.append(sub);
  const actions=el('div','hero-actions');const last=state.last&&meta(state.last.id)?state.last:null;
  const start=button('', 'button',()=>go(last?.id||(bookInfo.start!=='home'&&bookInfo.start)||catalog[0]?.id||'home',last?.page));start.append(document.createTextNode(last?'Tiếp tục đọc':'Bắt đầu đọc sách'),el('span','arrow','→'));actions.append(start);if(bookInfo.pdf)actions.append(button('Mở sách PDF gốc ↗','text-button',()=>window.open(assetURL('book.pdf'),'_blank','noopener')));copy.append(actions);
  const facts=el('div','hero-facts');for(const [a,b]of [[String(bookInfo.chapters||0),bookInfo.exercises?'phần sách':'chương'],[String(bookInfo.pages||0),'trang đã lưu'],['✓','Đọc ngoại tuyến']]){const x=el('span');x.append(el('b','',a),document.createTextNode(b));facts.append(x);}copy.append(facts);
  const art=el('div','hero-art');const cover=el('img');if(bookInfo.cover)cover.src=assetURL(bookInfo.cover);else cover.hidden=true;cover.alt='Bìa sách '+bookInfo.title;cover.width=140;cover.height=204;const al=el('div','art-label');al.append(el('span','','THƯ PHÒNG'),el('span','','♞'));art.append(cover,al);hero.append(copy,art);home.append(hero);
  if(bookInfo.exercises){const practice=el('section','intro-card');const content=el('div','intro-name');content.append(el('strong','',bookInfo.exercises+' bài tập trên bàn cờ'),el('span','','Giấu đáp án, thử nước đi và lưu bài cần ôn.'));practice.append(content,button('Vào luyện tập →','button',()=>{location.href='/book-practice.html?id='+encodeURIComponent(BOOK_ID);}));home.append(practice);}
  const head=el('div','section-header');head.append(el('h2','','Mục lục cuốn sách'));const tabs=el('div','view-tabs');tabs.setAttribute('aria-label','Chọn nội dung');for(const [f,t]of [['all','Tất cả chương'],['saved','Trang đã lưu']]){const b=button(t,activeFilter===f?'active':'',()=>{activeFilter=f;renderHome();});b.setAttribute('aria-pressed',String(activeFilter===f));tabs.append(b);}head.append(tabs);home.append(head);
  if(activeFilter==='saved')renderBookmarks(home);else{
    if(meta('intro')){const intro=button('','intro-card',()=>go('intro',state.positions.intro?.page));intro.append(el('span','intro-icon','¶'));const name=el('div','intro-name');name.append(el('strong','','Trước khi bắt đầu'),el('span','','Lời giới thiệu của tác giả'));intro.append(name,el('span','',String(meta('intro').end-meta('intro').start+1)+' trang'),el('span','intro-arrow','→'));home.append(intro);}
    const grid=el('div','chapter-grid');
    for(const c of catalog.filter(c=>c.number)){
      const card=button('','chapter-card',()=>go(c.id,state.positions[c.id]?.page));card.append(el('span','chapter-num',chapterNumber(c)));
      const body=el('div','card-body');body.append(el('h3','',c.title));const foot=el('div','card-footer');foot.append(el('span','',`${c.end-c.start+1} trang · PDF ${c.start}–${c.end}`));
      if(state.completed.includes(c.id))foot.append(el('span','reading-tag','✓ Đã học'));else if(state.positions[c.id])foot.append(el('span','reading-tag','Đang đọc'));
      body.append(foot);card.append(body,el('span','card-arrow','↗'));grid.append(card);
    }home.append(grid);
    const extras=el('div','appendices');for(const c of catalog.filter(c=>!c.number&&c.id!=='intro'))extras.append(button(c.title+' ↗','appendix',()=>go(c.id)));home.append(extras);
  }
  const note=el('p','source-note',bookInfo.notice||'Bản sách đã lưu trên máy, không cần kết nối Internet khi đọc.');
  home.append(note);$('#main').replaceChildren(home);renderNav();
}
function renderBookmarks(parent){
  const valid=state.bookmarks.filter(b=>meta(b.id));
  if(!valid.length){const x=el('div','bookmarks-empty');x.append(el('strong','','Giữ lại một trang hay.'),el('p','','Khi đọc, bấm “Lưu trang” để quay lại thế cờ hoặc đoạn văn bạn muốn ôn.'));parent.append(x);return;}
  const list=el('div','bookmark-list');
  for(const b of [...valid].sort((a,b)=>b.at-a.at)){
    const item=el('div','bookmark-card');const open=button('','open-bookmark',()=>go(b.id,b.page));open.append(el('strong','',meta(b.id).title),el('span','',pageLabel(b.page)));const del=button('×','remove-bookmark',()=>{toggleBookmark(b.id,b.page);renderHome();});del.setAttribute('aria-label','Bỏ lưu '+pageLabel(b.page));item.append(open,del);list.append(item);
  }parent.append(list);
}
function isSaved(id,page){return state.bookmarks.some(b=>b.id===id&&b.page===page);}
function toggleBookmark(id,page){const i=state.bookmarks.findIndex(b=>b.id===id&&b.page===page);if(i<0){state.bookmarks.push({id,page,at:Date.now()});toast('Đã lưu '+pageLabel(page).toLowerCase());}else{state.bookmarks.splice(i,1);toast('Đã bỏ lưu trang');}persist(true);$$(`[data-bookmark="${page}"]`).forEach(b=>{b.textContent=isSaved(id,page)?'◆ Đã lưu':'◇ Lưu trang';b.classList.toggle('saved',isSaved(id,page));});}
function figureBlock(b,page){
  const asset=(figures[page]||[]).find(f=>f.id===b.figureId);if(!asset){return el('p','',b.text||'');}
  const fig=el('figure',asset.group?'group':'');const image=el('img');image.src=asset.src;image.loading='lazy';image.decoding='async';image.alt=b.text||'Hình thế cờ trong sách';
  const zoom=button('','',()=>{$('#large-figure').src=asset.src;$('#large-figure').alt=b.text||'Hình thế cờ gốc';$('#figure-caption').textContent=b.text||pageLabel(page);$('#figure-dialog').showModal();});zoom.setAttribute('aria-label','Phóng lớn: '+(b.text||'hình thế cờ'));zoom.append(image);
  const cap=el('figcaption','',b.text||'');cap.append(el('span','zoom-label','Bấm vào hình để phóng lớn'));fig.append(zoom,cap);if(b.original){const details=el('details','original-page');details.append(el('summary','','Đối chiếu trang gốc (nguyên ngữ)'),fig);return details;}return fig;
}
function block(b,page){
  if(b.type==='figure')return figureBlock(b,page);
  if(b.type==='moves')return el('div','moves',b.text);
  if(b.type==='quote')return el('blockquote','',b.text);
  if(b.type==='h2'||b.type==='h3')return el(b.type,'',b.text);
  if(b.type==='test'){
    const t=el('div','test',b.text);if(b.exerciseId){t.append(button('Giải trên bàn cờ →','text-button',()=>{location.href='/book-practice.html?id='+encodeURIComponent(BOOK_ID)+'&exercise='+encodeURIComponent(b.exerciseId);}));}if(bookInfo.solution_chapter&&current!==bookInfo.solution_chapter){
      const n=b.text.match(/(?:KIỂM TRA|kiểm tra|TEST|BÀI TẬP|Bài tập|Bài)\s*(\d+)/i)?.[1];
      if(n){const a=el('div','inline-solutions');a.append(button('Xem lời giải bài '+n+' →','text-button',()=>openSolution(Number(n))));t.append(a);}
    }return t;
  }
  return el('p','',b.text);
}
async function openSolution(n){
  try{const data=await load(bookInfo.solution_chapter);const pattern=new RegExp('(?:KIỂM TRA|TEST|BÀI TẬP|Bài)\\s*'+n+'(?!\\d)','i');const p=data.pages.find(p=>p.blocks.some(b=>pattern.test(b.text)));go(bookInfo.solution_chapter,p?.page);toast('Lời giải bài '+n);}catch{toast('Chưa tải được lời giải. Hãy thử lại.');}
}
async function renderReader(id,targetPage,token){
  const c=meta(id);if(!c){go('home');return;}
  current=id;$('#breadcrumb-current').textContent=c.title;document.title=c.title+' · '+bookInfo.title;renderNav();
  $('#main').replaceChildren(el('div','loading','Đang mở '+c.title.toLowerCase()+'…'));
  const data=await load(id);if(token!==routeRun)return;
  const legacyExercises=!bookInfo.exercises&&data.pages.some(p=>p.blocks.some(b=>b.exerciseId));
  const reader=el('article','reader');if(legacyExercises){reader.append(el('p','package-warning','Bản đã nhập chưa có dữ liệu bàn cờ tương tác. Hãy cập nhật ứng dụng rồi nhập lại gói .thcbook để bổ sung; quyển sách trong tủ sẽ được cập nhật.'));}const controls=el('div','reading-controls');const left=el('div','left-controls');
  left.append(button('← Mục lục','text-button',()=>go('home')));
  const select=el('select');select.setAttribute('aria-label','Đến trang trong chương');
  for(const p of data.pages){const o=el('option','',pageLabel(p.page));o.value=p.page;select.append(o);}select.addEventListener('change',()=>scrollPage(Number(select.value)));select.id='page-select';left.append(select);
  controls.append(left,button('Ghi chú ↓','button small outline',()=>$('#chapter-notes').scrollIntoView({behavior:'smooth',block:'center'})));reader.append(controls);
  const heading=el('header','reader-heading');heading.append(el('span','eyebrow',c.number?'CHƯƠNG '+chapterNumber(c):c.id==='intro'?'LỜI GIỚI THIỆU':'PHỤ LỤC'),el('h1','',c.title));const rm=el('div','reader-meta');rm.append(el('span','',bookInfo.author||''),el('span','',`${data.pages.length} trang · PDF ${c.start}–${c.end}`),button('Mở trang gốc ↗','',()=>source(currentPage||c.start)));heading.append(rm);reader.append(heading);
  const body=el('div','reader-body');
  for(const p of data.pages){
    const section=el('section','source-page');section.id='page-'+p.page;section.dataset.page=p.page;section.setAttribute('aria-label',pageLabel(p.page));
    const tools=el('div','page-tools');tools.append(el('span','',pageLabel(p.page)));const pa=el('div','page-actions');pa.append(button('Đối chiếu bản gốc ↗','',()=>source(p.page)));
    const mark=button(isSaved(id,p.page)?'◆ Đã lưu':'◇ Lưu trang',isSaved(id,p.page)?'saved':'',()=>toggleBookmark(id,p.page));mark.dataset.bookmark=p.page;pa.append(mark);tools.append(pa);section.append(tools);
    const prose=el('div','translation');for(const b of p.blocks)if(b.text||b.type==='figure')prose.append(block(b,p.page));section.append(prose);body.append(section);
  }reader.append(body);
  const end=el('section','chapter-end');if(c.number){
    const complete=el('div','complete-row');const msg=el('div');msg.append(el('h2','','Một chương, thêm một bước.'),el('p','','Đánh dấu khi bạn đã đọc và ôn xong chương này.'));
    const done=button(state.completed.includes(id)?'✓ Đã học chương này':'Đánh dấu đã học','button',()=>{
      const i=state.completed.indexOf(id);if(i<0)state.completed.push(id);else state.completed.splice(i,1);persist(true);done.textContent=state.completed.includes(id)?'✓ Đã học chương này':'Đánh dấu đã học';done.setAttribute('aria-pressed',String(state.completed.includes(id)));renderNav();toast(state.completed.includes(id)?'Đã cập nhật tiến độ học':'Đã bỏ đánh dấu chương');
    });done.setAttribute('aria-pressed',String(state.completed.includes(id)));complete.append(msg,done);end.append(complete);
  }
  const notes=el('div','chapter-notes');notes.id='chapter-notes';const lab=el('label');lab.htmlFor='note-input';lab.append(document.createTextNode('Ghi chú của bạn'),el('span','',state.notes[id]?'Đã lưu':'Tự động lưu trên trình duyệt'));const input=el('textarea');input.id='note-input';input.placeholder='Ghi lại ý tưởng, thế cờ muốn ôn hoặc điều bạn còn băn khoăn…';input.value=state.notes[id]||'';
  input.addEventListener('input',()=>{state.notes[id]=input.value;persist();$('span',lab).textContent='Đã lưu trên trình duyệt';});notes.append(lab,input);end.append(notes);
  const nav=el('nav','chapter-navigation');nav.setAttribute('aria-label','Chuyển phần đọc');const ix=catalog.findIndex(x=>x.id===id);
  for(const [other,label]of [[catalog[ix-1],'← Phần trước'],[catalog[ix+1],'Phần tiếp theo →']]){if(other){const a=el('a');a.href='#'+other.id;a.append(document.createTextNode(label),el('strong','',other.title));nav.append(a);}else nav.append(el('span'));}end.append(nav);reader.append(end);
  const progress=el('div','reader-progress');progress.append(el('span'));reader.append(progress);$('#main').replaceChildren(reader);
  currentPage=c.start;
  if(targetPage&&data.pages.some(p=>p.page===targetPage)){
    requestAnimationFrame(()=>{scrollPage(targetPage,false);const section=$('#page-'+targetPage);Promise.all($$('img',section).map(im=>im.complete?Promise.resolve():new Promise(resolve=>{im.addEventListener('load',resolve,{once:true});im.addEventListener('error',resolve,{once:true});}))).then(()=>{if(current===id)scrollPage(targetPage,false);});});
  }else{window.scrollTo({top:0,behavior:'instant'});}
  state.last={id,page:targetPage||c.start};state.positions[id]={page:targetPage||c.start};persist();
}
function scrollPage(page,smooth=true){const x=$('#page-'+page);if(x){x.scrollIntoView({behavior:smooth?'smooth':'instant',block:'start'});currentPage=page;const s=$('#page-select');if(s)s.value=page;}}
async function route(){
  const [id,p]=location.hash.slice(1).split('/');if(id==='main'){document.querySelector('#main').focus({preventScroll:true});return;}
  persist(true);closeSidebar();const token=++routeRun;
  if(!id||id==='home'){renderHome();window.scrollTo({top:0,behavior:'instant'});return;}
  try{await renderReader(id,Number(p)||null,token);}catch(e){if(token!==routeRun)return;const x=el('div','error-box');x.append(el('h1','','Chưa mở được phần đọc'),el('p','','Hãy kiểm tra ứng dụng Tĩnh Huyền Các trên máy vẫn đang chạy rồi tải lại phần này.'),button('Thử lại','button',()=>route()));$('#main').replaceChildren(x);}
}
let scrollQueued=false;
window.addEventListener('scroll',()=>{
  if(scrollQueued||!current)return;scrollQueued=true;requestAnimationFrame(()=>{scrollQueued=false;const sections=$$('.source-page');if(!sections.length)return;let active=sections[0];for(const s of sections){if(s.getBoundingClientRect().top<=180)active=s;else break;}
    const page=Number(active.dataset.page);if(currentPage!==page){currentPage=page;state.positions[current]={page};state.last={id:current,page};persist();const select=$('#page-select');if(select)select.value=page;}
    const start=$('.reader-body').getBoundingClientRect().top+window.scrollY;const end=$('.reader-body').getBoundingClientRect().bottom+window.scrollY-window.innerHeight;const amount=Math.max(0,Math.min(1,(window.scrollY-start)/(end-start||1)));const fill=$('.reader-progress span');if(fill)fill.style.width=(amount*100)+'%';
  });
},{passive:true});
function normal(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();}
async function search(query){
  const run=++searchRun,results=$('#search-results');query=query.trim();
  if(query.length<2){results.replaceChildren(el('p','empty','Nhập ít nhất 2 ký tự để tìm trong toàn bộ sách.'));return;}
  results.replaceChildren(el('p','empty','Đang tìm trong toàn bộ sách…'));
  const all=await Promise.allSettled(catalog.map(c=>load(c.id)));if(run!==searchRun)return;const phrase=normal(query);const hits=[];let unavailable=0;
  for(let i=0;i<all.length;i++){
    if(all[i].status!=='fulfilled'){unavailable++;continue;}
    for(const p of all[i].value.pages){for(const b of p.blocks){const text=b.text||'';const norm=normal(text);if(norm.includes(phrase)){const pos=norm.indexOf(phrase);const start=Math.max(0,pos-65);const snippet=(start?'…':'')+text.slice(start,start+230)+(text.length>start+230?'…':'');hits.push({id:catalog[i].id,title:catalog[i].title,page:p.page,snippet});}}}
  }
  results.replaceChildren(el('div','result-count',`${hits.length} kết quả${hits.length>80?' · hiển thị 80 kết quả đầu':''}${unavailable?' · '+unavailable+' phần chưa tải được':''}`));
  if(!hits.length)results.append(el('p','empty','Chưa tìm thấy. Thử một từ ngắn hơn hoặc cách gọi khác.'));
  for(const h of hits.slice(0,80)){
    const item=button('','search-result',()=>{$('#search-dialog').close();if(current===h.id){scrollPage(h.page);}else go(h.id,h.page);});item.append(el('b','',h.title+' · '+pageLabel(h.page)));
    const p=el('p');const norm=normal(h.snippet),ix=norm.indexOf(phrase);if(ix>=0){p.append(document.createTextNode(h.snippet.slice(0,ix)),el('mark','',h.snippet.slice(ix,ix+phrase.length)),document.createTextNode(h.snippet.slice(ix+phrase.length)));}else p.textContent=h.snippet;item.append(p);results.append(item);
  }
}
function exportBackup(){
  persist(true);const payload={app:'thc-offline-book',packageId:bookInfo.id,exportedAt:new Date().toISOString(),state};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=el('a');a.href=url;a.download=BOOK_ID+'-tien-do-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Đã xuất bản sao lưu tiến độ và ghi chú');
}
async function importBackup(file){
  if(!file)return;if(file.size>5_000_000){toast('Tệp sao lưu quá lớn. Hãy chọn đúng tệp đã xuất.');return;}
  try{
    const b=JSON.parse(await file.text());const s=b.state;
    if(!((b.app==='thc-offline-book'&&b.packageId===bookInfo.id)||(bookInfo.legacy_backup_app&&b.app===bookInfo.legacy_backup_app))||s?.version!==1||!Array.isArray(s.bookmarks)||!Array.isArray(s.completed)||!s.notes||typeof s.notes!=='object')throw Error();
    for(const id of s.completed)if(meta(id)&&!state.completed.includes(id))state.completed.push(id);
    for(const m of s.bookmarks){const c=meta(m.id);if(c&&Number.isInteger(m.page)&&m.page>=c.start&&m.page<=c.end&&!isSaved(m.id,m.page))state.bookmarks.push({id:m.id,page:m.page,at:Number(m.at)||Date.now()});}
    let noteConflicts=0;
    for(const [id,n]of Object.entries(s.notes)){if(!meta(id)||typeof n!=='string'||!n)continue;if(!state.notes[id])state.notes[id]=n;else if(state.notes[id]!==n&&!state.notes[id].includes(n)){state.notes[id]+='\n\n— Ghi chú từ bản sao lưu —\n'+n;noteConflicts++;}}
    for(const [id,pos]of Object.entries(s.positions||{})){const c=meta(id);if(c&&Number.isInteger(pos.page)&&pos.page>=c.start&&pos.page<=c.end&&!state.positions[id])state.positions[id]={page:pos.page};}
    persist(true);$('#settings-dialog').close();renderNav();if(current){const input=$('#note-input');if(input)input.value=state.notes[current]||'';}else renderHome();toast('Đã nhập và hợp nhất bản sao lưu'+(noteConflicts?' · giữ cả hai bản ghi chú':''));
  }catch{toast('Tệp này không phải bản sao lưu hợp lệ của cuốn sách.');}
}
// Printing builds a separate document tree; reading position, progress and notes stay intact.
let preparingPrint=false, cancelPrint=false, printTitle=null;
function syncPrintOptions(){
  const scope=$('#print-scope').value;
  $('#print-chapter-field').hidden=scope!=='chapter';$('#print-range').hidden=scope!=='pages';$('#print-range-hint').hidden=scope!=='pages';
  $('#print-chapter').disabled=scope!=='chapter';
  for(const id of ['print-from','print-to']){$('#'+id).disabled=scope!=='pages';$('#'+id).required=scope==='pages';}
}
function openPrintOptions(){
  if(!catalog.length){toast('Chờ nội dung sách tải xong rồi thử in.');return;}
  if(preparingPrint)return;
  cleanupPrint();
  const select=$('#print-chapter');select.replaceChildren();
  for(const c of catalog){const o=el('option','',(c.number?'Chương '+chapterNumber(c)+' · ':'')+c.title);o.value=c.id;select.append(o);}
  select.value=meta(current)?current:catalog[0].id;$('#print-scope').value=current?'chapter':'all';
  const first=Math.min(...catalog.map(c=>c.start)),last=Math.max(...catalog.map(c=>c.end));
  for(const id of ['print-from','print-to']){$('#'+id).min=first;$('#'+id).max=last;}
  $('#print-from').value=meta(current)?.start||first;$('#print-to').value=meta(current)?.end||last;
  $('#print-status').textContent='';syncPrintOptions();
  for(const d of $$('dialog[open]'))d.close();
  $('#print-dialog').showModal();
}
function printSelection(scope,chapter,from,to){
  if(scope==='all')return catalog.map(c=>({c,from:c.start,to:c.end}));
  if(scope==='chapter'){const c=meta(chapter);if(!c)throw Error('Hãy chọn một chương để in.');return[{c,from:c.start,to:c.end}];}
  if(scope!=='pages'||!Number.isInteger(from)||!Number.isInteger(to)||from>to||from<Math.min(...catalog.map(c=>c.start))||to>Math.max(...catalog.map(c=>c.end)))throw Error('Khoảng trang PDF không hợp lệ. Kiểm tra trang bắt đầu và kết thúc.');
  const selected=catalog.filter(c=>c.end>=from&&c.start<=to).map(c=>({c,from:Math.max(from,c.start),to:Math.min(to,c.end)}));
  if(!selected.length)throw Error('Khoảng trang này chưa có nội dung đã nhập.');
  return selected;
}
function printBlock(b,page){
  // Original-language comparison scans stay out of the Vietnamese reading copy.
  if(b.original)return null;
  if(b.type==='figure'){
    const asset=(figures[page]||[]).find(f=>f.id===b.figureId);
    if(!asset)throw Error('Thiếu hình ở '+pageLabel(page)+'. Hãy nhập lại gói sách trước khi in.');
    const fig=el('figure',asset.group?'group':''),im=el('img');im.src=asset.src;im.loading='eager';im.alt=b.text||'Thế cờ trong sách';fig.append(im);if(b.text)fig.append(el('figcaption','',b.text));return fig;
  }
  const tag=['h2','h3'].includes(b.type)?b.type:b.type==='quote'?'blockquote':b.type==='moves'||b.type==='test'?'div':'p';
  return el(tag,['moves','test'].includes(b.type)?b.type:'',b.text||'');
}
function printChapter(c,data,from,to,notes){
  const pages=data.pages.filter(p=>p.page>=from&&p.page<=to);if(!pages.length)return null;
  const chapter=el('article','print-chapter'),heading=el('header','print-chapter-heading');
  heading.append(el('p','print-book-name',bookInfo.title),el('h1','',(c.number?'Chương '+chapterNumber(c)+' · ':'')+c.title));
  heading.append(el('p','print-book-meta',[bookInfo.author,bookInfo.edition||'Bản dịch tiếng Việt',`Trang PDF ${pages[0].page}–${pages.at(-1).page}`].filter(Boolean).join(' · ')));chapter.append(heading);
  for(const p of pages){const section=el('section','print-source-page');section.append(el('p','print-page-label',pageLabel(p.page)));const prose=el('div','translation');for(const b of p.blocks){const node=printBlock(b,p.page);if(node)prose.append(node);}section.append(prose);chapter.append(section);}
  if(notes?.trim()){const n=el('section','print-chapter-notes');n.append(el('h2','','Ghi chú của tôi'),el('p','',notes));chapter.append(n);}
  return chapter;
}
async function readyToPrint(root){
  // Eagerly load even off-screen diagrams before opening the browser's print preview.
  await Promise.all($$('img',root).map(im=>new Promise((resolve,reject)=>{
    let timer;const finish=ok=>{clearTimeout(timer);im.removeEventListener('load',loaded);im.removeEventListener('error',failed);ok?resolve():reject(Error('Một hình thế cờ chưa tải được. Kiểm tra ứng dụng đang chạy rồi thử in lại.'));};
    const loaded=()=>finish(im.naturalWidth>0),failed=()=>finish(false);
    im.addEventListener('load',loaded,{once:true});im.addEventListener('error',failed,{once:true});timer=setTimeout(failed,30000);if(im.complete)loaded();
  })));
  if(document.fonts?.ready)await document.fonts.ready;
}
function cleanupPrint(){
  $('#book-print-root')?.remove();document.body.classList.remove('book-print-active');
  if(printTitle!==null){document.title=printTitle;printTitle=null;}
}
function closePrintOptions(){
  if(preparingPrint){cancelPrint=true;$('#print-status').textContent='Đang hủy chuẩn bị bản in…';return;}
  $('#print-dialog').close();
}
async function prepareBookPrint(event){
  event?.preventDefault();if(preparingPrint)return;
  const status=$('#print-status');let selected,size=Number($('#print-size').value);
  try{selected=printSelection($('#print-scope').value,$('#print-chapter').value,Number($('#print-from').value),Number($('#print-to').value));if(![11,12,13,14,16].includes(size))throw Error('Cỡ chữ in không hợp lệ.');}catch(e){status.textContent=e.message;return;}
  preparingPrint=true;cancelPrint=false;$('#print-submit').disabled=true;$('#print-form').setAttribute('aria-busy','true');
  const root=el('div','book-print-root');root.id='book-print-root';root.setAttribute('aria-hidden','true');root.style.setProperty('--book-print-size',size+'pt');
  const includeNotes=$('#print-notes').checked,notes={...state.notes};
  try{
    for(let i=0;i<selected.length;i++){
      if(cancelPrint)break;const {c,from,to}=selected[i];status.textContent=`Đang chuẩn bị ${i+1}/${selected.length}: ${c.title}…`;
      const data=await load(c.id);if(cancelPrint)break;const chapter=printChapter(c,data,from,to,includeNotes?notes[c.id]:'');if(chapter)root.append(chapter);
    }
    if(cancelPrint){status.textContent='Đã hủy. Chưa mở hộp thoại in.';return;}
    if(!root.children.length)throw Error('Khoảng đã chọn không có nội dung để in.');
    cleanupPrint();document.body.append(root);status.textContent='Đang tải đầy đủ hình thế cờ và phông chữ…';
    await readyToPrint(root);if(cancelPrint){cleanupPrint();status.textContent='Đã hủy. Chưa mở hộp thoại in.';return;}
    printTitle=document.title;document.title=bookInfo.title+' · '+(selected.length===1?selected[0].c.title:'Bản in tiếng Việt');
    document.body.classList.add('book-print-active');$('#print-dialog').close();
    status.textContent='Đã chuẩn bị bản in.';
    window.print();
  }catch(e){cleanupPrint();status.textContent=cancelPrint?'Đã hủy. Chưa mở hộp thoại in.':e.message||'Chưa tạo được bản in. Hãy thử lại.';}
  finally{preparingPrint=false;$('#print-submit').disabled=false;$('#print-form').setAttribute('aria-busy','false');}
}
$('#home-button').addEventListener('click',()=>go('home'));
$('#menu-button').addEventListener('click',()=>{const open=$('#sidebar').classList.toggle('open');$('#sidebar-shade').classList.toggle('open',open);$('#menu-button').setAttribute('aria-expanded',String(open));});
$('#sidebar-shade').addEventListener('click',closeSidebar);
$('#theme-button').addEventListener('click',()=>{state.prefs.dark=!state.prefs.dark;applyPrefs();persist(true);});
$('#settings-button').addEventListener('click',()=>$('#settings-dialog').showModal());
$('#font-size').addEventListener('input',e=>{state.prefs.size=Number(e.target.value);applyPrefs();persist();});
$('#serif-toggle').addEventListener('change',e=>{state.prefs.serif=e.target.checked;applyPrefs();persist();});
$('#print-button').addEventListener('click',openPrintOptions);
$('#reader-print-button').addEventListener('click',openPrintOptions);
$('#print-scope').addEventListener('change',syncPrintOptions);
$('#print-form').addEventListener('submit',prepareBookPrint);
$('#print-close').addEventListener('click',closePrintOptions);$('#print-cancel').addEventListener('click',closePrintOptions);
$('#print-dialog').addEventListener('cancel',e=>{if(preparingPrint){e.preventDefault();closePrintOptions();}});
window.addEventListener('afterprint',cleanupPrint);
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='p'&&catalog.length){e.preventDefault();openPrintOptions();}});

$('#search-button').addEventListener('click',()=>{$('#search-dialog').showModal();$('#search-input').focus();});
let searchTimer;$('#search-input').addEventListener('input',e=>{clearTimeout(searchTimer);searchRun++;searchTimer=setTimeout(()=>search(e.target.value).catch(()=>toast('Chưa đọc được dữ liệu đã lưu. Hãy kiểm tra ứng dụng trên máy và thử lại.')),220);});
for(const d of $$('dialog:not(#print-dialog)')){d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});$('.close-dialog',d).addEventListener('click',()=>d.close());}
$('#source-dialog').addEventListener('close',()=>{$('#source-frame').src='about:blank';});
$('#backup-button').addEventListener('click',()=>$('#settings-dialog').showModal());
$('#export-button').addEventListener('click',exportBackup);$('#import-button').addEventListener('click',()=>$('#import-file').click());$('#import-file').addEventListener('change',e=>{importBackup(e.target.files[0]);e.target.value='';});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('dialog[open]')){e.preventDefault();$('#search-dialog').showModal();$('#search-input').focus();}});
window.addEventListener('hashchange',route);window.addEventListener('pagehide',()=>persist(true));
applyPrefs();
async function bootOffline(){
  if(!BOOK_ID)throw Error('Chưa chọn sách ngoại tuyến.');
  const response=await fetch(BASE+'/offline');if(!response.ok)throw Error('Chưa có nội dung ngoại tuyến. Hãy nhập gói sách từ Tủ sách học.');
  bookInfo=await response.json();
  $('#reader-practice-link').href='/book-practice.html?id='+encodeURIComponent(BOOK_ID);
  $('#reader-practice-link').hidden=!bookInfo.exercises;
  $('#offline-edition').textContent=bookInfo.edition||'Bản dịch tiếng Việt';
  $('#offline-title').textContent=bookInfo.title;$('#offline-author').textContent=bookInfo.author||'';$('#offline-footer').textContent=bookInfo.title+' · Đã lưu trên máy';$('#side-count').textContent=bookInfo.chapters+(bookInfo.exercises?' PHẦN':' CHƯƠNG');
  const fontFiles=[['Be Vietnam Pro','400','normal','be-vietnam-pro-400-normal.woff'],['Be Vietnam Pro','500','normal','be-vietnam-pro-500-normal.woff'],['Be Vietnam Pro','600','normal','be-vietnam-pro-600-normal.woff'],['Be Vietnam Pro','700','normal','be-vietnam-pro-700-normal.woff'],['Be Vietnam Pro','400','italic','be-vietnam-pro-400-italic.woff'],['Noto Serif VI','400','normal','noto-serif-regular.woff'],['Noto Serif VI','700','normal','noto-serif-bold.woff'],['Noto Serif VI','400','italic','noto-serif-italic.woff'],['Noto Serif VI','700','italic','noto-serif-bolditalic.woff']];
  const fonts=el('style');fonts.textContent=fontFiles.filter(f=>bookInfo.assets.includes('assets/fonts/'+f[3])).map(f=>`@font-face{font-family:'${f[0]}';font-weight:${f[1]};font-style:${f[2]};font-display:swap;src:url('${assetURL('assets/fonts/'+f[3])}') format('woff')}`).join('');document.head.append(fonts);
  const responses=await Promise.all(['catalog','figures','page-labels'].map(name=>fetch(BASE+'/content/'+name+'.json').then(r=>{if(!r.ok)throw Error('Thiếu dữ liệu đã nhập.');return r.json();})));
  [catalog,figures,labels]=responses;
  for(const group of Object.values(figures))for(const figure of group)figure.src=assetURL(figure.src);
  if(!bookInfo.pdf){$('#source-link').hidden=true;}
  if(!location.hash){const last=state.last&&meta(state.last.id)?state.last:null;go(last?.id||bookInfo.start||'home',last?.page);}
  $('#reader-print-button').disabled=false;
  await route();
}
bootOffline().catch(error=>{$('#main').replaceChildren(el('p','empty',error.message));});
