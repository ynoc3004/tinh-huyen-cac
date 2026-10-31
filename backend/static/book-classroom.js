// A deadline keeps the countdown accurate even when a browser throttles callbacks.
export function createClassroomCountdown({now=()=>Date.now(),schedule=(fn)=>setInterval(fn,250),cancel=id=>clearInterval(id),onChange}) {
 let duration=60,remaining=60,deadline=null,tick=null,started=false;
 function stopTick(){if(tick!==null)cancel(tick);tick=null;}
 function read(){return {remaining:deadline===null?remaining:Math.max(0,Math.ceil((deadline-now())/1000)),running:deadline!==null,started};}
 function emit(){const state=read();if(state.running&&state.remaining===0){remaining=0;deadline=null;stopTick();}onChange(read());}
 function pause(){remaining=read().remaining;deadline=null;stopTick();emit();}
 function reset(seconds=duration){stopTick();duration=Math.max(1,Math.min(1800,Number(seconds)||60));remaining=duration;deadline=null;started=false;emit();}
 function toggle(){if(deadline!==null){pause();return;}if(remaining<=0)remaining=duration;started=true;deadline=now()+remaining*1000;tick=schedule(emit);emit();}
 return {reset,pause,toggle,read};
}

export function createClassroomTools({document,onAction}) {
 const $=id=>document.getElementById(id),dialog=$('board-presentation');
 let active=false,pickerWasOpen=false,token=null,state={},answerVisible=false;
 const timer=createClassroomCountdown({onChange:s=>{
  const clock=$('presentation-clock');clock.hidden=!s.started;
  const clockText=s.remaining?`${Math.floor(s.remaining/60)}:${String(s.remaining%60).padStart(2,'0')}`:'Hết giờ';
  if(clock.textContent!==clockText)clock.textContent=clockText;
  clock.classList.toggle('expired',s.started&&s.remaining===0);
  $('presentation-timer-start').textContent=s.running?'Tạm dừng':s.started&&s.remaining?'Tiếp tục':'Bắt đầu';
  const status=s.started&&s.remaining===0?'Hết giờ · Mời học sinh nêu phương án.':s.running?'Đang đếm ngược. Hết giờ không tự mở đáp án.':s.started?'Đang tạm dừng.':'Chỉ bắt đầu khi giáo viên bấm nút.';
  if($('presentation-timer-status').textContent!==status)$('presentation-timer-status').textContent=status;
 }});
 function setDrawer(show,focus=false){
  $('presentation-tools').hidden=!show;dialog.classList.toggle('tools-open',show);
  $('presentation-tools-toggle').setAttribute('aria-expanded',String(show));
  if(focus&&show){$('presentation-tools').scrollTop=0;$('group').focus({preventScroll:true});}
  else if(!show&&active)$('presentation-tools-toggle').focus({preventScroll:true});
 }
 function showAnswer(){
  const show=answerVisible&&!!state.revealed;
  $('presentation-answer-panel').hidden=!show;
  $('presentation-reveal').textContent=show?'Ẩn lời giải':'Xem lời giải';
  $('presentation-reveal').setAttribute('aria-expanded',String(show));
  // Keep answer text out of the projection DOM until deliberately requested.
  $('presentation-answer').textContent=show?state.answer||'Sách chưa có phần lời giải bằng chữ cho bài này.':'';
 }
 function update(next){
  state=next;
  if(next.token!==token){token=next.token;answerVisible=false;timer.reset($('presentation-timer-duration').value);}
  const valid=!!next.valid;
  for(const id of ['presentation-hint','presentation-reveal','presentation-review','presentation-undo','presentation-mark','presentation-promotion','presentation-timer-start'])$(id).disabled=!valid;
  $('presentation-hint').disabled=!valid||next.hintDisabled;
  $('presentation-undo').disabled=!valid||!next.canUndo;
  $('presentation-mode').value=next.mode||'free';$('presentation-mode').disabled=!valid||next.modeDisabled;
  $('presentation-promotion').value=next.promotion||'q';
  $('presentation-review').setAttribute('aria-pressed',String(!!next.review));
  $('presentation-review').textContent=next.review?'✓ Đã đánh dấu cần ôn':'Đánh dấu cần ôn';
  $('presentation-mark').setAttribute('aria-pressed',String(!!next.marking));
  $('presentation-mark').textContent=next.marking?'Đang đánh dấu · Bấm để tắt':'Đánh dấu ô';
  $('presentation-clear-marks').disabled=!next.markCount;
  $('presentation-solution-prev').disabled=!next.revealed||next.solutionPly<=0;
  $('presentation-solution-next').disabled=!next.revealed||next.solutionPly>=next.stepCount;
  $('presentation-solution-ply').textContent=`${next.solutionPly||0} / ${next.stepCount||0}`;
  $('presentation-picker-status').textContent=next.pickerStatus||'';
  showAnswer();
 }
 function feedback(kind,text){
  const short={illegal:'Nước chưa hợp lệ. Em kiểm tra cách đi quân và an toàn của vua nhé.',different:'Chưa khớp đáp án sách. Em thử lại hoặc cùng thầy/cô kiểm tra phương án này.',
   'not-mate':'Chưa chiếu hết. Em tìm xem vua đối phương còn cách nào thoát.',correct:'Đúng theo sách! Em tìm nước tiếp theo nhé.',complete:'Hoàn thành! Em giải thích ý tưởng cho cả lớp nhé.',
   free:'Đang thử phương án tự do · Không chấm đúng/sai.',ready:'Tính trong đầu trước, rồi đi quân để trình bày phương án.',review:'Bài chưa xác minh · Thực hành tự do và đối chiếu sách.',revealed:'Đã mở lời giải · Dùng nút lùi/tiến để minh họa.'};
  $('presentation-feedback').textContent=short[kind]||text;
  $('presentation-feedback').dataset.kind=kind;
  if(kind==='complete'||kind==='revealed')timer.pause();
 }
 $('presentation-tools-toggle').onclick=()=>setDrawer($('presentation-tools').hidden);
 $('presentation-tools-close').onclick=()=>setDrawer(false);
 $('presentation-choose').onclick=()=>{$('exercise-picker').open=true;setDrawer(true,true);};
 for(const [id,action] of [['hint','hint'],['review','review'],['undo','undo'],['mark','mark'],['clear-marks','clear-marks'],['solution-prev','solution-prev'],['solution-next','solution-next']])$('presentation-'+id).onclick=()=>onAction(action);
 $('presentation-reveal').onclick=()=>{if(!state.valid)return;if(!state.revealed)onAction('reveal');answerVisible=!answerVisible;showAnswer();};
 $('presentation-mode').onchange=()=>onAction('mode',$('presentation-mode').value);
 $('presentation-promotion').onchange=()=>onAction('promotion',$('presentation-promotion').value);
 $('presentation-timer-duration').onchange=()=>timer.reset($('presentation-timer-duration').value);
 $('presentation-timer-start').onclick=()=>timer.toggle();
 $('presentation-timer-reset').onclick=()=>timer.reset($('presentation-timer-duration').value);
 timer.reset();
 return {update,feedback,toggle:()=>$('presentation-tools-toggle').click(),
  open(){active=true;answerVisible=false;showAnswer();pickerWasOpen=$('exercise-picker').open;$('presentation-picker').append($('exercise-picker'));$('exercise-picker').open=true;setDrawer(false);},
  close(){active=false;timer.pause();$('exercise-picker-home').append($('exercise-picker'));$('exercise-picker').open=pickerWasOpen;setDrawer(false);onAction('reset-annotations');},
  isActive:()=>active};
}
