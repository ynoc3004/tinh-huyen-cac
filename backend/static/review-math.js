
// Independently implemented from the public model: https://lichess.org/page/accuracy
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function whiteWinningPercent(evaluation){
 if(typeof evaluation==="number")evaluation={cp:evaluation,mate:null};
 if(evaluation.mate!==null&&evaluation.mate!==undefined)
  return evaluation.mateWinner==="w"?100:0;
 return 100/(1+Math.exp(-0.00368208*evaluation.cp));
}

export function moveReview(best,played,color){
 const beforeWin=whiteWinningPercent(best),afterWin=whiteWinningPercent(played);
 const winLoss=Math.max(0,(color==="w"?1:-1)*(beforeWin-afterWin));
 const beforeCp=typeof best==="number"?best:best.cp,afterCp=typeof played==="number"?played:played.cp;
 const loss=Number.isFinite(beforeCp)&&Number.isFinite(afterCp)?Math.max(0,(color==="w"?1:-1)*(beforeCp-afterCp)):null;
 // The published curve, with the current model's one-point uncertainty allowance.
 const accuracy=winLoss===0?100:clamp(103.1668100711649*Math.exp(-0.04354415386753951*winLoss)-3.166924740191411+1,0,100);
 const kind=winLoss>=10?"blunder":winLoss>=5?"mistake":winLoss>=2?"inaccurate":winLoss>=0.5?"good":"accurate";
 const label={blunder:"Sai lầm lớn",mistake:"Sai lầm",inaccurate:"Chưa chính xác",good:"Tốt",accurate:"Chuẩn xác"}[kind];
 return {loss,winLoss,accuracy,kind,label,symbol:{blunder:"??",mistake:"?",inaccurate:"?!",good:"✓",accurate:"✓"}[kind],beforeWin,afterWin};
}

export function meanAccuracy(reviews,color,totalPlies=reviews.length){
 if(!reviews.length)return null;
 const size=clamp(Math.floor(totalPlies/10),2,8);
 const positions=[...reviews.map(r=>r.beforeWin),reviews.at(-1).afterWin];
 const values=reviews.map((review,i)=>{
  const start=clamp(i-size+2,0,Math.max(0,positions.length-size));
  const window=positions.slice(start,start+size),average=window.reduce((a,b)=>a+b,0)/window.length;
  const deviation=Math.sqrt(window.reduce((sum,n)=>sum+(n-average)**2,0)/window.length);
  return {...review,weight:clamp(deviation,0.5,12)};
 }).filter(r=>r.color===color);
 if(!values.length)return null;
 const weighted=values.reduce((sum,r)=>sum+r.accuracy*r.weight,0)/values.reduce((sum,r)=>sum+r.weight,0);
 const harmonic=values.some(r=>r.accuracy===0)?0:values.length/values.reduce((sum,r)=>sum+1/r.accuracy,0);
 return clamp((weighted+harmonic)/2,0,100);
}

export function averageCentipawnLoss(reviews,color){
 const values=reviews.filter(r=>r.color===color&&Number.isFinite(r.loss));
 return values.length?values.reduce((sum,r)=>sum+r.loss,0)/values.length:null;
}

export function needsConfirmation(best,played,color){
 const review=moveReview(best,played,color);
 const mateChanged=(best.mate===null)!==(played.mate===null)||best.mateWinner!==played.mateWinner;
 const improvement=(color==="w"?1:-1)*(review.afterWin-review.beforeWin);
 return review.winLoss>=5||review.loss>=200||mateChanged||improvement>=2;
}
