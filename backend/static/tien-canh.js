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
  const links=[['/','Cổng môn','home'],['/library.html','Tàng kinh','library'],['/bi-canh.html','Bí cảnh','bi-canh'],['/arena.html','Đấu trường','arena'],['/history.html','Kỳ phổ','history'],['/study.html','Thư phòng','study']];
  function mount() {
    const page=location.pathname.replace(/^\//,'').replace(/\.html$/,'')||'home';document.body.dataset.page=page==='index'?'home':page;
    let header=document.querySelector('.site-header');
    if(!header){
      header=document.createElement('header');header.className='site-header noprint';
      const active=['tournament','arena-live'].includes(page)?'arena':page==='reader'?'library':page;
      header.innerHTML='<a class="site-brand" href="/">'+icon+'<span><strong>Tĩnh Huyền Các</strong><small>KỲ ĐẠO · TU TÂM · LUYỆN TRÍ</small></span></a><nav class="site-navigation" aria-label="Điều hướng chính">'+links.map(([href,name,key])=>'<a href="'+href+'"'+(key===active?' aria-current="page"':'')+'>'+name+'</a>').join('')+'</nav>';
      const host=page==='learn'?document.querySelector('body > main'):document.querySelector('body > .wrap, body > .review-shell');(host||document.body).prepend(header);
    }else{
      header.classList.add('noprint');const nav=header.querySelector('.site-navigation');
      if(nav&&!nav.querySelector('a[href="/study.html"]')){const a=document.createElement('a');a.href='/study.html';a.textContent='Thư phòng';nav.append(a)}
    }
    const appearance=document.createElement('details');appearance.className='site-appearance';
    appearance.innerHTML='<summary>Diện mạo <span aria-hidden="true">☷</span></summary><div class="appearance-panel"><label>Font toàn hệ thống<select data-site-font aria-label="Font toàn hệ thống">'+fonts.map(f=>'<option value="'+f.id+'">'+f.name+'</option>').join('')+'</select></label><label>Thiên sắc<select data-site-theme aria-label="Thiên sắc"><option value="auto">Theo mặt trời</option><option value="light">Ban ngày</option><option value="dark">Ban đêm</option></select></label><a href="/fonts-preview.html">Xem mẫu chữ →</a><small data-appearance-status role="status"></small></div>';
    header.append(appearance);
    appearance.querySelector('[data-site-font]').onchange=e=>{const saved=setFont(e.target.value);appearance.querySelector('[data-appearance-status]').textContent=saved?'Đã đổi font ở mọi trang và các tab đang mở.':'Đã đổi trong trang này; trình duyệt không cho lưu lựa chọn.'};
    appearance.querySelector('[data-site-theme]').onchange=e=>{const saved=setTheme(e.target.value);appearance.querySelector('[data-appearance-status]').textContent=saved?'Đã lưu thiên sắc cho mọi trang.':'Đã đổi trong trang này; trình duyệt không cho lưu lựa chọn.'};
    document.addEventListener('click',e=>{if(!appearance.contains(e.target))appearance.open=false});appearance.addEventListener('keydown',e=>{if(e.key==='Escape'){appearance.open=false;appearance.querySelector('summary').focus()}});
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
