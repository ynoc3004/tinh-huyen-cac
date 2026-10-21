/* Shared appearance: apply before paint, then mount the site shell.
   No book/game data or remote requests are involved. */
(() => {
  'use strict';
  if (window.THCAppearance) return;
  const root = document.documentElement, FONT_KEY = 'thc-font', THEME_KEY = 'thc-theme';
  const fonts = [
    {id:'default',name:'Mặc định · Charm / Noto Serif',body:'"Noto Serif", Georgia, serif',title:'"Charm", "Noto Serif", serif'},
    {id:'noto',name:'Noto Serif',family:'"Noto Serif", Georgia, serif'},
    {id:'philosopher',name:'Philosopher',family:'"Philosopher", "Noto Serif", serif'},
    {id:'cormorant',name:'Cormorant Garamond',family:'"Cormorant Garamond", "Noto Serif", serif'},
    {id:'yeseva',name:'Yeseva One',family:'"Yeseva One", "Noto Serif", serif'},
    {id:'dancing',name:'Dancing Script',family:'"Dancing Script", "Noto Serif", cursive'},
    {id:'charm',name:'Charm',family:'"Charm", "Noto Serif", cursive'},
    {id:'sriracha',name:'Sriracha',family:'"Sriracha", "Noto Serif", cursive'},
    {id:'playfair',name:'Playfair Display',family:'"Playfair Display", "Noto Serif", serif'}
  ];
  const read = key => {try{return localStorage.getItem(key)}catch{return null}};
  const legacyFont = () => fonts.find(f=>f.family && (read('titleFont')||'').includes(f.name))?.id || 'default';
  let fontId = fonts.find(f=>f.id===read(FONT_KEY))?.id || legacyFont();
  let themeMode = ['light','dark'].includes(read(THEME_KEY)) ? read(THEME_KEY) : 'auto', autoTheme = null;
  const queryTheme = new URLSearchParams(location.search).get('theme');
  function resolveTheme(suggested) {
    if (['light','dark'].includes(queryTheme)) return queryTheme;
    if (themeMode !== 'auto') return themeMode;
    if (['light','dark'].includes(suggested)) return suggested;
    if (autoTheme) return autoTheme;
    try {const now=new Date(),sun=window.ThienCo?.sunTimes(now,10.7769,106.7009);if(sun)return now>=sun.sunrise&&now<sun.sunset?'light':'dark'}catch{}
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function apply() {
    const f=fonts.find(f=>f.id===fontId)||fonts[0];
    root.style.setProperty('--font-body',f.family||f.body);root.style.setProperty('--title',f.family||f.title);root.style.setProperty('--tw','400');
    root.dataset.font=f.id;root.dataset.theme=resolveTheme();root.dataset.themeMode=themeMode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',root.dataset.theme==='light'?'#e5ebe4':'#0b1210');
    document.querySelectorAll('[data-site-font]').forEach(s=>s.value=fontId);document.querySelectorAll('[data-site-theme]').forEach(s=>s.value=themeMode);
    document.querySelectorAll('[data-font-id]').forEach(c=>{const on=c.dataset.fontId===fontId;c.classList.toggle('on',on);c.setAttribute('aria-pressed',String(on))});
    document.querySelector('.site-scenery .moon')?.classList.toggle('sun',root.dataset.theme==='light');
    window.dispatchEvent(new CustomEvent('thc:appearance',{detail:{font:fontId,theme:root.dataset.theme,mode:themeMode}}));
  }
  const persist=(key,value)=>{try{localStorage.setItem(key,value);return true}catch{return false}};
  function setFont(id) {if(!fonts.some(f=>f.id===id))return false;fontId=id;const saved=persist(FONT_KEY,id);try{localStorage.removeItem('titleFont')}catch{}apply();return saved}
  function setTheme(mode) {if(!['auto','light','dark'].includes(mode))return false;themeMode=mode;const saved=persist(THEME_KEY,mode);apply();return saved}
  window.THCAppearance={fonts,setFont,setTheme,resolveTheme,getFont:()=>fontId,getTheme:()=>themeMode,setAutoTheme:theme=>{if(['light','dark'].includes(theme)&&theme!==autoTheme){autoTheme=theme;apply()}}};
  apply();
  window.addEventListener('storage',e=>{
    if([FONT_KEY,'titleFont',null].includes(e.key))fontId=fonts.find(f=>f.id===read(FONT_KEY))?.id||legacyFont();
    if([THEME_KEY,null].includes(e.key))themeMode=['light','dark'].includes(read(THEME_KEY))?read(THEME_KEY):'auto';
    if([FONT_KEY,'titleFont',THEME_KEY,null].includes(e.key))apply();
  });
  const icon='<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor"><path d="M15 2h18l13 13v18L33 46H15L2 33V15z" opacity=".5"/><circle cx="24" cy="24" r="15"/><path d="M24 9a15 15 0 0 1 0 30a7.5 7.5 0 0 1 0-15a7.5 7.5 0 0 0 0-15" fill="currentColor"/><circle cx="24" cy="16.5" r="2.3" fill="currentColor"/><circle cx="24" cy="31.5" r="2.3" fill="var(--paper)" stroke="none"/></svg>';
  const paths=[
    ['/', 'Cổng môn', 'home', 'Trở về cổng quán', '111'],
    ['/dao-lo.html', 'Đạo lộ', 'dao-lo', 'Hồ sơ và hành trình', '110'],
    ['/library.html', 'Tàng kinh', 'library', 'Thư viện sách cờ', '101'],
    ['/bi-canh.html', 'Bí cảnh', 'bi-canh', 'Luyện thế cờ và công pháp', '100'],
    ['/worksheets.html', 'Soạn bài tập', 'worksheets', 'Soạn đề và xuất PDF', '011'],
    ['/arena.html', 'Đấu trường', 'arena', 'Tổ chức và điều hành giải', '010'],
    ['/history.html', 'Kỳ phổ', 'history', 'Ván đấu và phân tích đã lưu', '001'],
    ['/study.html', 'Thư phòng', 'study', 'Đọc sách và ghi chú', '000']
  ];
  function trigram(pattern, x=0, y=0, width=24, gap=6) {
    return [...pattern].map((line,row)=>line==='1'
      ? '<rect x="'+x+'" y="'+(y+row*gap)+'" width="'+width+'" height="2.5"/>'
      : '<rect x="'+x+'" y="'+(y+row*gap)+'" width="'+(width*.4)+'" height="2.5"/><rect x="'+(x+width*.6)+'" y="'+(y+row*gap)+'" width="'+(width*.4)+'" height="2.5"/>').join('');
  }
  const bagua='<svg class="site-bagua" viewBox="0 0 100 100" aria-hidden="true"><path d="M31 4h38l27 27v38L69 96H31L4 69V31z" fill="none" stroke="currentColor" stroke-width="1" opacity=".6"/>'+paths.map((path,index)=>'<g fill="currentColor" transform="rotate('+(index*45)+' 50 50)">'+trigram(path[4],42,10,16,4.5)+'</g>').join('')+'<circle cx="50" cy="50" r="23" fill="none" stroke="currentColor" opacity=".2"/><circle cx="50" cy="50" r="17" fill="var(--paper)" stroke="currentColor"/><path d="M50 33a17 17 0 0 1 0 34a8.5 8.5 0 0 1 0-17a8.5 8.5 0 0 0 0-17" fill="currentColor"/><circle cx="50" cy="41.5" r="2.5" fill="currentColor"/><circle cx="50" cy="58.5" r="2.5" fill="var(--paper)"/></svg>';
  function mount() {
    const page=location.pathname.replace(/^\//,'').replace(/\.html$/,'')||'home';document.body.dataset.page=page==='index'?'home':page;
    const active=['tournament','arena-live'].includes(page)?'arena':['reader','books','book'].includes(page)?'library':page==='learn'?'bi-canh':page==='translate'?'study':page==='index'?'home':page;
    const current=paths.find(path=>path[2]===active)?.[1]||(page==='review'?'Phân tích PGN':page==='fonts-preview'?'Diện mạo':'Điều hướng');
    let header=document.querySelector('.site-header');
    if(!header){
      header=document.createElement('header');header.className='site-header';
      const host=page==='learn'?document.querySelector('body > main'):document.querySelector('body > .wrap, body > .review-shell');(host||document.body).prepend(header);
    }
    header.classList.add('noprint');header.dataset.baguaMenu='';
    header.innerHTML='<a class="site-brand" href="/">'+icon+'<span><strong>Tĩnh Huyền Quán</strong><small>KỲ ĐẠO · TU TÂM · LUYỆN TRÍ</small></span></a><button type="button" class="site-menu-toggle" aria-label="Mở bát quái điều hướng" aria-haspopup="dialog" aria-controls="site-menu" aria-expanded="false"><span class="site-menu-caption"><small>BÁT QUÁI</small><strong>'+current+'</strong></span>'+bagua+'</button>';
    const toggle=header.querySelector('.site-menu-toggle'),menu=document.createElement('dialog');
    menu.id='site-menu';menu.className='site-menu-dialog noprint';menu.setAttribute('aria-labelledby','site-menu-title');
    menu.innerHTML='<div class="site-menu-heading"><span class="site-menu-emblem">'+bagua+'</span><div><p class="site-menu-eyebrow">TĨNH HUYỀN QUÁN</p><h2 id="site-menu-title">Bát quái điều hướng</h2><p>Chọn một lối để tiếp tục.</p></div><button type="button" class="site-menu-close" aria-label="Đóng bát quái điều hướng" autofocus>Đóng <span aria-hidden="true">×</span></button></div><nav class="site-navigation site-menu-links" aria-label="Điều hướng chính">'+paths.map(([href,name,key,note,pattern])=>'<a href="'+href+'"'+(key===active?' aria-current="page"':'')+'><svg class="site-path-icon" viewBox="0 0 24 15" aria-hidden="true" fill="currentColor">'+trigram(pattern)+'</svg><span><strong>'+name+'</strong><small>'+note+'</small></span><span class="site-path-arrow" aria-hidden="true">↗</span></a>').join('')+'</nav><a class="site-menu-extra" href="/review.html"'+(page==='review'?' aria-current="page"':'')+'>Phân tích PGN →</a><fieldset class="site-menu-appearance"><legend>Diện mạo</legend><div><label>Font toàn hệ thống<select data-site-font aria-label="Font toàn hệ thống">'+fonts.map(f=>'<option value="'+f.id+'">'+f.name+'</option>').join('')+'</select></label><label>Thiên sắc<select data-site-theme aria-label="Thiên sắc"><option value="auto">Theo mặt trời</option><option value="light">Ban ngày</option><option value="dark">Ban đêm</option></select></label></div><a href="/fonts-preview.html"'+(page==='fonts-preview'?' aria-current="page"':'')+'>Xem mẫu chữ →</a><small data-appearance-status role="status"></small></fieldset>';
    document.body.append(menu);
    const syncMenu=()=>{toggle.setAttribute('aria-expanded',String(menu.open));root.classList.toggle('site-menu-open',menu.open)};
    toggle.addEventListener('click',()=>{
      if(menu.open){menu.close();return;}
      menu.showModal();syncMenu();
      (menu.querySelector('a[aria-current="page"]')||menu.querySelector('.site-menu-links a')).focus();
    });
    menu.querySelector('.site-menu-close').addEventListener('click',()=>menu.close());
    menu.addEventListener('close',()=>{syncMenu();toggle.focus({preventScroll:true})});
    menu.addEventListener('click',event=>{
      if(event.target.closest('a')){menu.close();return;}
      if(event.target!==menu)return;
      const rect=menu.getBoundingClientRect();
      if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)menu.close();
    });
    // Native dialog keeps keyboard focus inside and closes with Escape.
    menu.querySelector('[data-site-font]').onchange=event=>{const saved=setFont(event.target.value);menu.querySelector('[data-appearance-status]').textContent=saved?'Đã đổi font ở mọi trang và các tab đang mở.':'Đã đổi trong trang này; trình duyệt không cho lưu lựa chọn.'};
    menu.querySelector('[data-site-theme]').onchange=event=>{const saved=setTheme(event.target.value);menu.querySelector('[data-appearance-status]').textContent=saved?'Đã lưu thiên sắc cho mọi trang.':'Đã đổi trong trang này; trình duyệt không cho lưu lựa chọn.'};
    // Keep the live weather/canvas on the homepage; share its scenery elsewhere.
    if(!document.querySelector('#sky, .site-scenery')){
      const scene=document.createElement('div');scene.className='site-scenery';scene.setAttribute('aria-hidden','true');
      scene.innerHTML='<span class="moon"></span><div class="site-mist"></div><div class="site-mist second"></div><svg class="site-ridge" viewBox="0 0 1200 150" preserveAspectRatio="none"><path class="far" d="M0 150V70L80 86 190 36 300 80 430 28 560 84 690 40 820 88 950 32 1080 74 1200 50V150z"/><path class="mid" d="M0 150V104L120 84 250 112 390 76 520 110 660 70 800 108 940 82 1080 112 1200 90V150z"/><path class="near" d="M0 150V128L150 114 300 132 470 112 640 134 810 116 980 134 1100 120 1200 130V150z"/></svg>';document.body.prepend(scene);
    }
    const positionOrb=()=>root.style.setProperty('--site-orb-top',Math.ceil(header.getBoundingClientRect().bottom+window.scrollY+24)+'px');
    positionOrb();window.addEventListener('resize',positionOrb);if(window.ResizeObserver)new ResizeObserver(positionOrb).observe(header);document.fonts?.ready.then(positionOrb);apply();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  window.setInterval(()=>{if(themeMode==='auto'&&!autoTheme)apply()},60000);
})();
