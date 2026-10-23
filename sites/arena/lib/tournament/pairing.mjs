import blossom from 'edmonds-blossom';

export const SCORE = Object.freeze(Object.assign(Object.create(null),{'1-0':[1,0], '0-1':[0,1], '1/2':[.5,.5]}));
export class PairingError extends Error {}
export const recommendedRounds = n => Math.max(1,Math.ceil(Math.log2(Math.max(2,n))));
const key = (a,b) => a<b?`${a}:${b}`:`${b}:${a}`;

// Python's integer-seeded MT19937: retain replay of existing draw seeds.
export class PythonRandom {
 constructor(seed=0){
  this.mt=new Uint32Array(624);this.mt[0]=19650218;
  for(let i=1;i<624;i++)this.mt[i]=(Math.imul(1812433253,this.mt[i-1]^(this.mt[i-1]>>>30))+i)>>>0;
  let s=BigInt(Math.abs(seed)),keys=[];do{keys.push(Number(s&0xffffffffn));s>>=32n;}while(s);
  let i=1,j=0;
  for(let k=Math.max(624,keys.length);k;k--){this.mt[i]=((this.mt[i]^Math.imul(this.mt[i-1]^(this.mt[i-1]>>>30),1664525))+keys[j]+j)>>>0;i++;j++;if(i>=624){this.mt[0]=this.mt[623];i=1;}if(j>=keys.length)j=0;}
  for(let k=623;k;k--){this.mt[i]=((this.mt[i]^Math.imul(this.mt[i-1]^(this.mt[i-1]>>>30),1566083941))-i)>>>0;i++;if(i>=624){this.mt[0]=this.mt[623];i=1;}}
  this.mt[0]=0x80000000;this.idx=624;
 }
 uint(){if(this.idx>=624){for(let i=0;i<624;i++){const y=(this.mt[i]&0x80000000)|(this.mt[(i+1)%624]&0x7fffffff);this.mt[i]=this.mt[(i+397)%624]^(y>>>1)^((y&1)?0x9908b0df:0);}this.idx=0;}let y=this.mt[this.idx++];y^=y>>>11;y^=(y<<7)&0x9d2c5680;y^=(y<<15)&0xefc60000;y^=y>>>18;return y>>>0;}
 random(){return ((this.uint()>>>5)*67108864+(this.uint()>>>6))/9007199254740992;}
 below(n){const k=Math.floor(Math.log2(n))+1;let r;do{r=this.uint()>>>(32-k);}while(r>=n);return r;}
 shuffle(a){for(let i=a.length-1;i>0;i--){const j=this.below(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
 sample(n,k){const out=[];let setsize=21;if(k>5)setsize+=4**Math.ceil(Math.log(k*3)/Math.log(4));if(n<=setsize){const pool=Array.from({length:n},(_,i)=>i);for(let i=0;i<k;i++){const j=this.below(n-i);out.push(pool[j]);pool[j]=pool[n-i-1];}}else{const chosen=new Set();for(let i=0;i<k;i++){let j=this.below(n);while(chosen.has(j))j=this.below(n);chosen.add(j);out.push(j);}}return out;}
}

export function roundRobin(ids){
 ids=[...ids];if(ids.length<2)return[];if(ids.length%2)ids.push(null);
 const n=ids.length,m=n-1,h=n/2,out=[];
 // FIDE Berger: the rotating pivot advances by half the even field.
 // The highest draw number is a rest when the actual field is odd.
 for(let r=0;r<m;r++){
  const pivot=(r*h)%m;let a=ids[pivot],b=ids[n-1];if(r%2)[a,b]=[b,a];
  const pairs=[[a,b]];
  for(let k=1;k<h;k++)pairs.push([ids[(pivot+k)%m],ids[(pivot-k+m)%m]]);
  out.push(pairs.map(([a,b])=>a===null?[b,a]:[a,b]));
 }return out;
}

export function playerStats(ids,pairs){
 const pts={},colors={},opponents={},hadBye={};for(const x of ids){pts[x]=0;colors[x]=[];opponents[x]=new Set();hadBye[x]=false;}
 for(const [w,b,r] of pairs){if(b===null){if(w in pts){pts[w]+=1;hadBye[w]=true;}continue;}if(!SCORE[r])continue;const [sw,sb]=SCORE[r];
  if(w in pts){pts[w]+=sw;colors[w].push('w');opponents[w].add(b);}if(b in pts){pts[b]+=sb;colors[b].push('b');opponents[b].add(w);}
 }return {pts,colors,opponents,hadBye};
}
function colourCost(h,c,strict){const balance=h.filter(x=>x==='w').length-h.filter(x=>x==='b').length+(c==='w'?1:-1),bad=Math.abs(balance)>2||(h.length>=2&&h.slice(-2).every(x=>x===c));
 if(strict&&bad)return null;const pref=!h.length?null:balance-(c==='w'?1:-1)<0?'w':balance-(c==='w'?1:-1)>0?'b':h.at(-1)==='w'?'b':'w';
 return (bad?100:0)+Math.abs(balance)*2+(pref!==null&&pref!==c?1:0);
}

export function matchPlayers(ids,pairs,ratings={},seed=0,strict=true){
 ids=[...ids].sort((a,b)=>a-b);if(new Set(ids).size!==ids.length)throw new PairingError('Danh sách ghép cặp có người trùng');if(!ids.length)return[];
 const rng=new PythonRandom(seed),lot=Object.fromEntries(ids.map(x=>[x,rng.random()])),{pts,colors,opponents,hadBye}=playerStats(ids,pairs);
 const order=[...ids].sort((a,b)=>pts[b]-pts[a]||(ratings[b]||0)-(ratings[a]||0)||lot[a]-lot[b]),rank=Object.fromEntries(order.map((x,i)=>[x,i]));
 const encounters={},latest={},last=Object.fromEntries(ids.map(x=>[x,-1]));pairs.forEach(([w,b,r],i)=>{if(b!==null&&SCORE[r]){const k=key(w,b);encounters[k]=(encounters[k]||0)+1;latest[k]=i;if(w in last)last[w]=i;if(b in last)last[b]=i;}});
 const target=new Set();for(const score of new Set(Object.values(pts))){const g=order.filter(x=>pts[x]===score),h=Math.floor(g.length/2);for(let i=0;i<h;i++)target.add(key(g[i],g[i+h]));}
 const n=ids.length,colourUnit=(n+1)**2,gapUnit=colourUnit*(n+1)*220,repeatUnit=gapUnit*(n+1)*(pairs.length+1)*2;
 const orientations={},edges=[];
 for(let i=0;i<n;i++){const a=order[i];for(let j=i+1;j<n;j++){const b=order[j],k=key(a,b);if(strict&&opponents[a].has(b))continue;const options=[];
  for(const [w,black] of [[a,b],[b,a]]){const cw=colourCost(colors[w],'w',strict),cb=colourCost(colors[black],'b',strict);if(cw===null||cb===null)continue;const preferred=(rank[a]+(lot[a]>=.5?1:0))%2===0?a:b;options.push([cw+cb,w===preferred?0:1,w,black]);}
  options.sort((a,b)=>{for(let z=0;z<4;z++)if(a[z]!==b[z])return a[z]-b[z];return 0;});if(!options.length)continue;
  const [cost,,w,black]=options[0];orientations[k]=[w,black];let quality=Math.trunc(Math.abs(pts[a]-pts[b])*2)*gapUnit+cost*colourUnit+(!target.has(k)?n+1:0)+Math.abs(rank[a]-rank[b]);
  if(!strict)quality+=(encounters[k]||0)*repeatUnit+((latest[k]??-1)+1)*gapUnit;
  edges.push([i,j,-quality]);
 }}
 if(n%2){
  // Fix the strongest bye priority outside the numeric weight scale: avoids
  // Number overflow for large official-event rosters, while checking feasibility.
  const eligible=order.filter(x=>!strict||!hadBye[x]).sort((a,b)=>strict?(pts[a]-pts[b]||rank[b]-rank[a]):last[b]-last[a]);
  for(const x of eligible){const e=[...edges,[rank[x],n,0]],mate=blossom(e,true);if(mate.length===n+1&&mate.every(x=>x>=0)){return materialize(mate,order,orientations,n,strict);}}
  throw new PairingError('Không có lịch ghép đủ người mà vẫn tránh tái đấu, lặp bye và vi phạm màu quân. Cần trọng tài xử lý; chưa tạo vòng mới.');
 }
 const mate=edges.length?blossom(edges,true):[];
 if(mate.length!==n||mate.some(x=>x<0))throw new PairingError('Không có lịch ghép đủ người mà vẫn tránh tái đấu, lặp bye và vi phạm màu quân. Cần trọng tài xử lý; chưa tạo vòng mới.');
 return materialize(mate,order,orientations,n,strict);
}
function materialize(mate,order,orientations,n,strict){const out=[];for(let i=0;i<mate.length;i++){const j=mate[i];if(j<i)continue;if(i===n||j===n){if(strict)out.push([order[i===n?j:i],null]);}else out.push(orientations[key(order[i],order[j])]);}const rank=Object.fromEntries(order.map((x,i)=>[x,i]));return out.sort((a,b)=>(a[1]===null?1:0)-(b[1]===null?1:0)||(a[1]===null?n:Math.min(rank[a[0]],rank[a[1]]))-(b[1]===null?n:Math.min(rank[b[0]],rank[b[1]])));}
export const swissPair=(ids,pairs,ratings={},seed=0)=>matchPlayers(ids,pairs,ratings,seed,true);
export const arenaPair=(ids,pairs,ratings={},seed=0)=>matchPlayers(ids,pairs,ratings,seed,false);

export function drawGroups(players,n,mode='pots',seed=0,avoidClub=true){
 const rng=new PythonRandom(seed),ps=rng.shuffle([...players].sort((a,b)=>a.id-b.id));if(mode==='pots')ps.sort((a,b)=>(b.rating||0)-(a.rating||0));const groups=Array.from({length:n},()=>[]),tier={};
 for(let i=0;i<ps.length;i+=n){const pot=ps.slice(i,i+n);let order=pot.length===n?[...groups.keys()]:rng.sample(n,pot.length);if(mode==='pots')rng.shuffle(pot);pot.forEach((p,k)=>{groups[order[k]].push(p);tier[p.id]=mode==='pots'?Math.floor(i/n):0;});}
 const club=p=>(p.club||'').trim().toLocaleLowerCase(),count=(g,c)=>g.filter(p=>club(p)===c).length;
 if(avoidClub)for(let turn=0;turn<30;turn++){let moved=false;for(let a=0;a<n;a++)for(const p of [...groups[a]]){const c=club(p);if(!c||count(groups[a],c)<2)continue;let found=false;for(let b=0;b<n&&!found;b++){if(a===b)continue;for(const q of groups[b]){const d=club(q);if(tier[p.id]!==tier[q.id]||d===c)continue;const delta=count(groups[b],c)-(count(groups[a],c)-1)+(d?count(groups[a],d)-(count(groups[b],d)-1):0);if(delta<0){groups[a][groups[a].indexOf(p)]=q;groups[b][groups[b].indexOf(q)]=p;moved=found=true;break;}}}}if(!moved)break;}
 let conflicts=0;for(const g of groups){const cnt={};for(const p of g){const c=club(p);if(c)cnt[c]=(cnt[c]||0)+1;}for(const v of Object.values(cnt))conflicts+=v*(v-1)/2;}
 return {groups:groups.map(g=>g.map(p=>p.id)),conflicts};
}

export function standings(pairs,fmt='swiss',ids=[],totalRounds=null){
 const games=pairs.map((p,i)=>[p[3]??i+1,...p.slice(0,3)]).sort((a,b)=>a[0]-b[0]);totalRounds??=Math.max(0,...games.map(p=>p[0]));
 const pts=Object.fromEntries(ids.map(x=>[x,0]));for(const [,w,b] of games){if(w!==null)pts[w]??=0;if(b!==null)pts[b]??=0;}
 const played=[],byes=[];for(const [r,w,b,result] of games){if(b===null){if(fmt!=='round_robin'&&w!==null&&[null,'bye','1-0'].includes(result))byes.push([r,w]);}else if(SCORE[result])played.push([r,w,b,...SCORE[result]]);}
 for(const [,w,b,sw,sb] of played){pts[w]+=sw;pts[b]+=sb;}for(const [,x] of byes)pts[x]+=1;
 const opp={},wins={},head={},hc={};for(const x of Object.keys(pts)){opp[x]=[];wins[x]=0;head[x]={};}
 for(const [,w,b,sw,sb] of played){opp[w].push([pts[b],sw]);opp[b].push([pts[w],sb]);head[w][b]=(head[w][b]||0)+sw;head[b][w]=(head[b][w]||0)+sb;hc[key(w,b)]=(hc[key(w,b)]||0)+1;if(sw===1)wins[w]++;if(sb===1)wins[b]++;}
 for(const [,x] of byes)opp[x].push([Math.min(pts[x],.5*totalRounds),1]);for(const x in head)for(const y in head[x])head[x][y]/=hc[key(+x,+y)];
 const bh={},bhc1={},sb={};for(const x in pts){bh[x]=opp[x].reduce((s,o)=>s+o[0],0);bhc1[x]=opp[x].length?bh[x]-Math.min(...opp[x].map(o=>o[0])):0;sb[x]=opp[x].reduce((s,o)=>s+o[0]*o[1],0);}
 const metrics={bh,bhc1,sb,wins},keys=fmt==='round_robin'?['de','sb','wins']:['de','bhc1','bh','sb','wins'];
 function de(g){return g.length>=2&&g.every(a=>g.every(b=>a===b||head[a][b]!==undefined))?Object.fromEntries(g.map(a=>[a,g.reduce((s,b)=>s+(a===b?0:head[a][b]),0)])):null;}
 function split(g,level){if(g.length<2||level>=keys.length)return[g];const k=keys[level];let sc=k==='de'?de(g):metrics[k];if(!sc){if(fmt==='swiss'){const low=Object.fromEntries(g.map(a=>[a,g.reduce((s,b)=>s+(a===b?0:(head[a][b]||0)),0)])),high=Object.fromEntries(g.map(a=>[a,low[a]+g.filter(b=>b!==a&&head[a][b]===undefined).length]));for(const a of g)if(g.every(b=>b===a||low[a]>high[b]))return[[a],...split(g.filter(b=>b!==a),level)];}return split(g,level+1);}const buckets={};for(const x of g)(buckets[sc[x]]??=[]).push(x);const values=Object.keys(buckets).map(Number).sort((a,b)=>b-a);return values.flatMap(v=>split(buckets[v],k==='de'&&values.length>1?level:level+1));}
 const byPts={};for(const x in pts)(byPts[pts[x]]??=[]).push(+x);const out=[];for(const pv of Object.keys(byPts).map(Number).sort((a,b)=>b-a)){const d=de(byPts[pv]);for(const g of split(byPts[pv].sort((a,b)=>a-b),0)){const rank=out.length+1;for(const x of g)out.push({student_id:x,rank,points:pts[x],de:d?d[x]:null,bhc1:fmt==='round_robin'?null:bhc1[x],bh:fmt==='round_robin'?null:bh[x],sb:sb[x],wins:wins[x]});}}return out;
}

export function knockoutStandings(pairs,ids=[]){const reach=Object.fromEntries(ids.map(x=>[x,0])),wins=Object.fromEntries(ids.map(x=>[x,0]));for(const [w,b,r,round] of pairs){for(const x of [w,b])if(x!==null){reach[x]=Math.max(reach[x]||0,round);wins[x]??=0;}if(b!==null&&['1-0','0-1'].includes(r)){const winner=r==='1-0'?w:b;wins[winner]++;reach[winner]=Math.max(reach[winner],round+1);}}let rank=0,prev=null;return Object.keys(reach).map(Number).sort((a,b)=>reach[b]-reach[a]||a-b).map((x,i)=>{if(reach[x]!==prev){rank=i+1;prev=reach[x];}return{student_id:x,rank,points:wins[x],wins:wins[x],de:null,bhc1:null,bh:null,sb:null};});}
