
export function moveReview(beforeWhite,afterWhite,color){
 const loss=Math.min(2000,Math.max(0,(color==="w"?1:-1)*(beforeWhite-afterWhite)));
 return {loss,accuracy:100*Math.exp(-loss/200),label:loss<=10?"Chuẩn xác":loss<=50?"Tốt":loss<=100?"Chưa chính xác":loss<=200?"Sai lầm":"Sai lầm lớn"};
}
export function meanAccuracy(reviews,color){const a=reviews.filter(r=>r.color===color);return a.length?a.reduce((n,r)=>n+r.accuracy,0)/a.length:null;}
