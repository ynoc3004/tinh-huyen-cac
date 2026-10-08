// One chapter per civil day in Vietnam, shared by every visitor.
export const START_DATE='2026-10-09';
const DAY=86400000;
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'});
function vietnamDay(date){
 const parts=Object.fromEntries(formatter.formatToParts(date).map(p=>[p.type,p.value]));
 return Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day))/DAY;
}
export function chapterNumber(date=new Date(),startDate=START_DATE){
 const first=Date.parse(startDate+'T00:00:00Z')/DAY;
 if(!Number.isInteger(first))throw Error('Ngày bắt đầu không hợp lệ.');
 const elapsed=vietnamDay(date)-first;
 return ((elapsed%81)+81)%81+1;
}
export function nextDayDelay(date=new Date()){
 return Math.max(1,(vietnamDay(date)+1)*DAY-7*3600000-date.getTime());
}
export function validateChapters(data){
 if(data?.chapters?.length!==81||data.start_date!==START_DATE)throw Error('Kho Hán văn chưa đầy đủ.');
 for(let i=0;i<81;i++){
  const c=data.chapters[i];
  if(c.chapter!==i+1||typeof c.han!=='string'||!c.han.trim()||c.source!=='https://nhantu.net/TonGiao/DaoDucKinh/DDK'+String(i+1).padStart(2,'0')+'.htm')throw Error('Chương Hán văn không hợp lệ.');
 }
 return data;
}
export function mountDailyDao(root){
 const title=root.querySelector('[data-dao-title]'),text=root.querySelector('[data-dao-han]'),source=root.querySelector('[data-dao-source]'),status=root.querySelector('[data-dao-status]');
 let dataset=null,timer=null;
 async function read(){
  if(!dataset)dataset=fetch('/dao-duc-kinh.json?v=1').then(r=>{if(!r.ok)throw Error('Không tải được Hán văn.');return r.json();}).then(validateChapters).catch(e=>{dataset=null;throw e;});
  return dataset;
 }
 function schedule(){clearTimeout(timer);timer=setTimeout(update,nextDayDelay(new Date())+20);}
 async function update(){
  try{
   const data=await read(),number=chapterNumber(new Date(),data.start_date),chapter=data.chapters[number-1];
   title.textContent='Đạo Đức Kinh · Chương '+number+' / 81';
   text.textContent=chapter.han;source.href=chapter.source;source.textContent='Hán văn · Nhân Tử';status.textContent='';
  }catch{status.textContent='Chưa tải được chương hôm nay. Đang hiển thị chương '+(title.textContent.match(/Chương (\d+)/)?.[1]||1)+'.';}
  finally{schedule();}
 }
 const visible=()=>{if(!document.hidden)update();};
 addEventListener('pageshow',update);document.addEventListener('visibilitychange',visible);update();
 return ()=>{clearTimeout(timer);removeEventListener('pageshow',update);document.removeEventListener('visibilitychange',visible);};
}
if(typeof document!=='undefined'){
 const root=document.querySelector('[data-daily-dao]');if(root)mountDailyDao(root);
}
