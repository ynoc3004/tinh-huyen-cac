import {Chess} from "/vendor/chess.js";
export const MAX_PGN_BYTES=2*1024*1024;

// Use the same checks for vault documents and files pasted/imported by the user.
export function parseReviewPgn(raw){
 const pgn=String(raw??"").replace(/^\uFEFF/,"").trim();
 if(!pgn)throw Error("Kỳ phổ trống. Hãy chọn file hoặc dán nội dung PGN.");
 if(new TextEncoder().encode(pgn).length>MAX_PGN_BYTES)throw Error("PGN lớn hơn 2 MB. Hãy xuất riêng một ván.");
 if((pgn.match(/^\s*\[Event\s/gm)||[]).length>1||(pgn.match(/(?:1-0|0-1|1\/2-1\/2|\*)\s*\[/g)||[]).length)
  throw Error("File chứa nhiều ván. Hãy xuất riêng ván muốn phân tích.");
 const board=new Chess();
 try{board.loadPgn(pgn);}catch{throw Error("PGN không hợp lệ hoặc có nước đi sai. Hãy kiểm tra nội dung kỳ phổ.");}
 if(!board.history().length)throw Error("Kỳ phổ chưa có nước đi để phân tích.");
 return {pgn,board};
}

export function evaluationPoints(scores,total){
 return scores.map((score,index)=>{
  const cp=score.mate!==null&&score.mate!==undefined?(score.mateWinner==="w"?600:-600):score.cp;
  return {index,x:10+980*index/Math.max(1,total),y:90-75*Math.max(-600,Math.min(600,cp))/600};
 });
}
