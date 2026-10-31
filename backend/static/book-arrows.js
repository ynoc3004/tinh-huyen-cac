const validSquare=s=>typeof s==='string'&&/^[a-h][1-8]$/.test(s);
export function arrowCenter(square,flipped=false){
 if(!validSquare(square))return null;
 const file='abcdefgh'.indexOf(square[0]),rank=Number(square[1]);
 return {x:(flipped?7-file:file)+.5,y:(flipped?rank-1:8-rank)+.5};
}
export function arrowSquareAt(box,x,y,flipped=false){
 if(box.width<=0||box.height<=0||!Number.isFinite(x)||!Number.isFinite(y))return null;
 const col=Math.floor((x-box.left)/box.width*8),row=Math.floor((y-box.top)/box.height*8);
 if(col<0||col>7||row<0||row>7)return null;
 return 'abcdefgh'[flipped?7-col:col]+(flipped?row+1:8-row);
}
export function arrowPath(from,to,flipped=false){
 const a=arrowCenter(from,flipped),b=arrowCenter(to,flipped);if(!a||!b||from===to)return '';
 const length=Math.hypot(b.x-a.x,b.y-a.y),dx=(b.x-a.x)/length,dy=(b.y-a.y)/length;
 const base={x:b.x-dx*.36,y:b.y-dy*.36};
 const side=(point,width)=>`${point.x-dy*width},${point.y+dx*width}`;
 return `M${side(a,.09)} L${side(base,.09)} L${side(base,.25)} L${b.x},${b.y} L${side(base,-.25)} L${side(base,-.09)} L${side(a,-.09)} Z`;
}

// Store arrows as squares, so resizing, flipping and fullscreen never change their targets.
export function createBoardArrows({document,board,getFlipped,canDraw,onStart,onPrimary,onSquare,onChange}){
 const arrows=new Map();let drag=null,overlay=null;
 function squareAt(event){const box=board.getBoundingClientRect();return arrowSquareAt({left:box.left+(board.clientLeft||0),top:box.top+(board.clientTop||0),width:board.clientWidth||box.width,height:board.clientHeight||box.height},event.clientX,event.clientY,getFlipped());}
 function release(pointerId){try{if(board.hasPointerCapture?.(pointerId))board.releasePointerCapture(pointerId);}catch{}}
 function render(){
  const preview=drag?.to&&drag.from!==drag.to?{from:drag.from,to:drag.to}:null;
  if(!arrows.size&&!preview){overlay?.remove();overlay=null;return;}
  if(!overlay||overlay.parentNode!==board){
   overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');
   overlay.setAttribute('class','board-arrows');overlay.setAttribute('viewBox','0 0 8 8');
   overlay.setAttribute('aria-hidden','true');overlay.setAttribute('focusable','false');board.append(overlay);
  }
  overlay.replaceChildren();
  for(const arrow of [...arrows.values(),...(preview?[preview]:[])]){
   const path=document.createElementNS('http://www.w3.org/2000/svg','path');
   path.setAttribute('d',arrowPath(arrow.from,arrow.to,getFlipped()));
   path.setAttribute('data-from',arrow.from);path.setAttribute('data-to',arrow.to);
   if(arrow===preview)path.setAttribute('data-preview','true');
   overlay.append(path);
  }
 }
 function cancel(){if(!drag)return;const id=drag.id;drag=null;release(id);render();}
 function clear({notify=true}={}){cancel();arrows.clear();render();if(notify)onChange();}
 board.addEventListener('contextmenu',event=>{if(canDraw())event.preventDefault();});
 board.addEventListener('pointerdown',event=>{
  if(event.button===0){cancel();onPrimary();return;}
  if(event.button!==2||!canDraw())return;
  const from=squareAt(event);if(!from)return;
  event.preventDefault();cancel();drag={id:event.pointerId,from,to:from};onStart();
  try{board.setPointerCapture(event.pointerId);}catch{}
  render();
 });
 board.addEventListener('pointermove',event=>{
  if(!drag||event.pointerId!==drag.id)return;
  if(!(event.buttons&2)){cancel();return;}
  event.preventDefault();drag.to=squareAt(event);render();
 });
 function finish(event){
  if(!drag||event.pointerId!==drag.id||event.button!==2)return;
  event.preventDefault();const {from,id}=drag,to=squareAt(event);drag=null;release(id);
  if(!to||!canDraw()){render();return;}
  if(from===to)onSquare(from);
  else {const key=from+to;if(arrows.has(key))arrows.delete(key);else arrows.set(key,{from,to});onChange();}
  render();
 }
 board.addEventListener('pointerup',finish);
 document.addEventListener('pointerup',finish); // Fallback when pointer capture is unavailable.
 const cancelled=event=>{if(drag&&event.pointerId===drag.id)cancel();};
 board.addEventListener('pointercancel',cancelled);document.addEventListener('pointercancel',cancelled);
 board.addEventListener('lostpointercapture',cancelled);
 document.addEventListener('keydown',event=>{if(event.key==='Escape')cancel();});
 document.defaultView?.addEventListener('blur',cancel);
 return {render,clear,count:()=>arrows.size};
}
