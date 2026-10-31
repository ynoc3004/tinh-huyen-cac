// Move the live board into a modal, so moves and progress use the same session.
export function createBoardPresentation({document, onPrevious, onNext, onFlip, onReset}) {
 const $=id=>document.getElementById(id), dialog=$('board-presentation'), fullscreenTarget=document.documentElement;
 let active=false, ownedFullscreen=false, requestedFullscreen=false, lastFocus=null, generation=0;
 const editing=target=>target?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName||'');
 function update({title,prompt,turn,position,previousDisabled,nextDisabled}) {
  $('presentation-title').textContent=title;
  $('presentation-prompt').textContent=prompt;
  $('presentation-turn').textContent=turn;
  $('presentation-position').textContent=position;
  $('presentation-previous').disabled=previousDisabled;
  $('presentation-next').disabled=nextDisabled;
 }
 function togglePrompt() {
  const show=$('presentation-prompt').hidden;
  $('presentation-prompt').hidden=!show;
  $('presentation-prompt-toggle').setAttribute('aria-pressed',String(show));
  $('presentation-prompt-toggle').textContent=show?'Ẩn đề bài':'Hiện đề bài';
  dialog.classList.toggle('with-prompt',show);
 }
 function close() {
  if(!active)return;
  active=false;generation++;
  $('board-home').append($('board'));
  document.body.classList.remove('presenting-board');
  if(dialog.open)dialog.close();
  if(requestedFullscreen&&document.fullscreenElement===fullscreenTarget) {
   try{Promise.resolve(document.exitFullscreen()).catch(()=>{});}catch{}
  }
  ownedFullscreen=false;requestedFullscreen=false;
  lastFocus?.focus({preventScroll:true});
 }
 function open() {
  if(active||$('workspace').hidden||$('board').getAttribute('aria-disabled')==='true')return;
  lastFocus=document.activeElement;
  // Keep the existing DOM and handlers, including drag/drop and promotion choice.
  dialog.showModal();
  $('presentation-stage').append($('board'));
  document.body.classList.add('presenting-board');
  active=true;const attempt=++generation;
  $('presentation-exit').focus({preventScroll:true});
  // Fullscreen can be denied or absent (e.g. mobile); the modal still fills the viewport.
  if(!document.fullscreenElement&&fullscreenTarget.requestFullscreen) {
   requestedFullscreen=true;
   try{Promise.resolve(fullscreenTarget.requestFullscreen()).then(()=>{
    if(active&&generation===attempt)ownedFullscreen=document.fullscreenElement===fullscreenTarget;
    else if(!active&&document.fullscreenElement===fullscreenTarget)Promise.resolve(document.exitFullscreen()).catch(()=>{});
   }).catch(()=>{});}catch{}
  }
 }
 $('present').onclick=open;
 $('presentation-exit').onclick=close;
 $('presentation-previous').onclick=()=>{if(!$('presentation-previous').disabled)onPrevious();};
 $('presentation-next').onclick=()=>{if(!$('presentation-next').disabled)onNext();};
 $('presentation-flip').onclick=onFlip;
 $('presentation-reset').onclick=onReset;
 $('presentation-prompt-toggle').onclick=togglePrompt;
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('close',close);
 document.addEventListener('fullscreenchange',()=>{
  if(active&&requestedFullscreen&&document.fullscreenElement===fullscreenTarget)ownedFullscreen=true;
  else if(active&&ownedFullscreen)close();
 });
 document.addEventListener('keydown',event=>{
  if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||editing(event.target))return;
  if(!active){if(event.key.toLowerCase()==='f'&&!document.querySelector('dialog[open]')){event.preventDefault();open();}return;}
  const action={ArrowLeft:()=>$('presentation-previous').click(),ArrowRight:()=>$('presentation-next').click(),PageUp:()=>$('presentation-previous').click(),PageDown:()=>$('presentation-next').click(),x:onFlip,h:togglePrompt,Escape:close}[event.key.length===1?event.key.toLowerCase():event.key];
  if(action){event.preventDefault();if(!event.repeat)action();}
 });
 return {update,close};
}
