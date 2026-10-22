import {Chess} from '/vendor/chess.js';

// Follow only legal lines supplied by the book. A different line is not declared bad.
export class ExerciseSession {
 constructor(item){this.item=item;this.chess=new Chess(item.fen);this.player=this.chess.turn();this.choices=item.tree;this.finished=false;this.free=item.status!=='verified';}
 play(from,to,promotion='q'){
  if(this.finished&&!this.free)return {kind:'finished'};
  let move;try{move=this.chess.move({from,to,promotion});}catch{return {kind:'illegal'};}
  if(this.free)return {kind:'free',san:move.san};
  if(this.item.kind==='mate1'){
   if(this.chess.isCheckmate()){this.finished=true;return {kind:'complete',san:move.san};}
   this.chess.undo();return {kind:'not-mate',san:move.san};
  }
  const uci=move.from+move.to+(move.promotion||''),choice=this.choices.find(x=>x.move===uci);
  if(!choice){this.chess.undo();return {kind:'different',san:move.san};}
  this.choices=choice.next;let reply='';
  if(this.choices.length){const response=this.choices[0],m=this.chess.move({from:response.move.slice(0,2),to:response.move.slice(2,4),promotion:response.move[4]||'q'});reply=m.san;this.choices=response.next;}
  this.finished=!this.choices.length;
  return {kind:this.finished?'complete':'correct',san:move.san,reply};
 }
 hint(level){if(this.free||this.finished)return '';const first=this.choices[0];if(!first)return '';if(level===1)return 'Quan sát quân ở ô '+first.move.slice(0,2)+'.';const b=new Chess(this.chess.fen());return 'Nước theo sách: '+b.move({from:first.move.slice(0,2),to:first.move.slice(2,4),promotion:first.move[4]||'q'}).san;}
 solution(){const board=new Chess(this.item.fen),steps=[];let choices=this.item.tree;while(choices.length&&steps.length<160){const n=choices[0];const move=board.move({from:n.move.slice(0,2),to:n.move.slice(2,4),promotion:n.move[4]||'q'});steps.push({fen:board.fen(),san:move.san});choices=n.next;}return steps;}
 showSolution(ply){const steps=this.solution();this.chess=new Chess(ply?steps[Math.min(ply,steps.length)-1].fen:this.item.fen);this.free=true;return steps;}
}
