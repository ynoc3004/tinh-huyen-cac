// The shared tien-canh.js owns the original header, bagua menu and appearance.
// This file only adds tournament utilities and routes links to the main Site.
document.addEventListener('DOMContentLoaded',()=>{
 const mainOrigin=document.querySelector('meta[name="thc-main-site"]')?.content;
 const mainRoutes=new Set(['/','/dao-lo.html','/library.html','/bi-canh.html','/worksheets.html','/history.html','/study.html','/review.html']);
 if(mainOrigin)for(const link of document.querySelectorAll('.site-header a, #site-menu a')){
  const path=link.getAttribute('href');if(mainRoutes.has(path))link.href=new URL(path,mainOrigin).href;
 }
 const tools=document.createElement('nav');tools.className='arena-utilities noprint';tools.setAttribute('aria-label','Tiện ích điều hành giải');
 tools.innerHTML='<span class="private-badge">Riêng tư</span><span><a href="/arena.html">Các giải đấu</a><a href="/huong-dan.html">Hướng dẫn</a></span>';
 const header=document.querySelector('.site-header');if(header)header.after(tools);
 const foot=document.createElement('footer');foot.className='site-foot noprint';foot.innerHTML='<span>TĨNH HUYỀN CÁC · LUẬN KIẾM LƯU NIÊN</span><a href="/huong-dan.html">Quy tắc bốc thăm & hệ số phụ ↗</a>';document.body.append(foot);
 const status=tools.querySelector('.private-badge');
 function connection(){status.classList.toggle('offline',!navigator.onLine);status.textContent=navigator.onLine?'Riêng tư':'Mất kết nối';if(!navigator.onLine){const msg=document.querySelector('#msg');if(msg)msg.textContent='Đang mất kết nối. Chờ có mạng trước khi lưu kết quả hoặc ghép vòng mới.';}}
 addEventListener('online',connection);addEventListener('offline',connection);connection();
 addEventListener('beforeunload',e=>{if(document.querySelector('tr[data-game].dirty')){e.preventDefault();e.returnValue='';}});
});
