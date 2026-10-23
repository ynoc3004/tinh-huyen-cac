import test from 'node:test';
import assert from 'node:assert/strict';
import blossom from 'edmonds-blossom';
import {PythonRandom,roundRobin,swissPair,arenaPair,drawGroups,standings,recommendedRounds,PairingError} from '../lib/tournament/pairing.mjs';
import {spawnSync} from 'node:child_process';

test('Python integer seeds retain MT19937 sequence and draw replay',()=>{
 const r=new PythonRandom(123);assert.deepEqual(Array.from({length:5},()=>r.random()),[.052363598850944326,.08718667752263232,.4072417636703983,.10770023493843905,.9011988779516946]);
 const ps=Array.from({length:37},(_,i)=>({id:i+1,rating:i%3?1200:1500,club:i%2?'A':'B'}));assert.deepEqual(drawGroups(ps,6,'pots',123),drawGroups(ps.reverse(),6,'pots',123));
});
test('Berger schedules cover each opponent once and balance colours for 2–65 players',()=>{
 for(let n=2;n<=65;n++){const ids=Array.from({length:n},(_,i)=>i+1),rounds=roundRobin(ids),seen=new Set(),rests={},balance={};assert.equal(rounds.length,n-1+n%2);
  for(const rnd of rounds){const present=[];for(const [w,b] of rnd){present.push(w);if(b===null){rests[w]=(rests[w]||0)+1;continue;}present.push(b);const key=[w,b].sort((a,b)=>a-b).join(':');assert(!seen.has(key));seen.add(key);balance[w]=(balance[w]||0)+1;balance[b]=(balance[b]||0)-1;}assert.deepEqual(present.sort((a,b)=>a-b),ids);}
  assert.equal(seen.size,n*(n-1)/2);for(const id of ids){assert.equal(rests[id]||0,n%2);assert(Math.abs(balance[id]||0)<=1);}
 }
});
test('Global Swiss matching escapes dead ends and refuses infeasible schedules',()=>{
 const pairs=swissPair([1,2,3,4],[[1,4,'1/2'],[2,3,'1/2'],[3,4,'1/2']],{},9);assert.deepEqual(pairs.map(p=>p.sort((a,b)=>a-b)).sort(),[[1,3],[2,4]]);
 const odd=swissPair([1,2,3],[[1,2,'1/2']],{},1);assert.notEqual(odd.find(p=>p[1]===null)[0],3);
 assert.throws(()=>swissPair([1,2],[[1,2,'1/2']]),PairingError);assert.throws(()=>swissPair([1,2,3],[[1,null,'bye'],[2,null,'bye'],[3,null,'bye']]),PairingError);
 assert.throws(()=>swissPair([1,2],[[1,9,'1/2'],[1,10,'1/2'],[2,11,'1/2'],[2,12,'1/2']]),PairingError);
});
test('Swiss simulation covers every player, no repeats/byes, and strict colours',()=>{
 let generated=0;for(let n=3;n<=64;n++)for(let seed=0;seed<3;seed++){const ids=Array.from({length:n},(_,i)=>i+1),rng=new PythonRandom(seed),hist=[],seen=new Set(),byes=new Set(),colors={};
  for(let r=0;r<recommendedRounds(n);r++){let rnd;try{rnd=swissPair(ids,hist,{},seed);}catch(e){assert(e instanceof PairingError);break;}const present=[];for(const [w,b] of rnd){present.push(w);if(b===null){assert(!byes.has(w));byes.add(w);hist.push([w,b,'bye']);continue;}present.push(b);const k=[w,b].sort((a,b)=>a-b).join(':');assert(!seen.has(k));seen.add(k);for(const [x,c] of [[w,'w'],[b,'b']]){const cs=colors[x]??=[];cs.push(c);assert(Math.abs(cs.filter(c=>c==='w').length-cs.filter(c=>c==='b').length)<=2);assert(!cs.join('').includes('www'));assert(!cs.join('').includes('bbb'));}hist.push([w,b,['1-0','0-1','1/2'][rng.below(3)]]);}assert.deepEqual(present.sort((a,b)=>a-b),ids);generated++;}
 }assert(generated>700);console.log('Verified Swiss rounds:',generated);
});
test('Arena alternates repeat colours, rests a recent player, and awards no waiting points',()=>{
 assert.deepEqual(arenaPair([1,2],[[1,2,'1-0']]),[[2,1]]);const rnd=arenaPair([1,2,3],[[1,2,'1/2']]);assert.equal(rnd.length,1);assert(rnd[0].includes(3));
});
test('Buchholz/SB byes and ties match the retained Python implementation',()=>{
 const rr=roundRobin([1,2,3]).flatMap((rnd,i)=>rnd.map(([w,b])=>[w,b,b===null?'bye':'1/2',i+1]));assert.deepEqual(standings(rr,'round_robin').map(x=>[x.points,x.rank]),[[1,1],[1,1],[1,1]]);
 assert.equal(standings([[1,null,'bye',1],[1,2,'1-0',2],[1,3,'1-0',3]],'swiss',[],3)[0].bh,1.5);
 const fixtures=[];for(let n=2;n<=15;n++){const ids=Array.from({length:n},(_,i)=>i+1),rng=new PythonRandom(n),rows=roundRobin(ids).flatMap((rnd,i)=>rnd.map(([w,b])=>[w,b,b===null?'bye':['1-0','0-1','1/2'][rng.below(3)],i+1]));for(const fmt of ['swiss','round_robin'])fixtures.push({rows,fmt,ids,total:rows.at(-1)[3]});}
 const py=process.env.THC_TEST_PYTHON;if(!py)throw Error('Set THC_TEST_PYTHON for differential tests');const out=spawnSync(py,['-c',"import sys,json;sys.path.insert(0,'upstream/backend');from services.pairing import standings;data=json.load(sys.stdin);print(json.dumps([standings(x['rows'],x['fmt'],x['ids'],x['total']) for x in data]))"],{input:JSON.stringify(fixtures),encoding:'utf8'});assert.equal(out.status,0,out.stderr);const expected=JSON.parse(out.stdout);fixtures.forEach((f,i)=>assert.deepEqual(standings(f.rows,f.fmt,f.ids,f.total),expected[i]));
});
test('Weighted Blossom agrees with exhaustive optimum on small adversarial graphs',()=>{
 for(let n=2;n<=10;n+=2)for(let seed=0;seed<20;seed++){const rng=new PythonRandom(seed+n),edges=[],w={};for(let a=0;a<n;a++)for(let b=a+1;b<n;b++){const weight=-rng.below(200);edges.push([a,b,weight]);w[a+':'+b]=weight;}
  function brute(ids){if(!ids.length)return 0;const [a,...rest]=ids;return Math.max(...rest.map((b,i)=>w[Math.min(a,b)+':'+Math.max(a,b)]+brute(rest.filter((_,j)=>j!==i))));}
  const mate=blossom(edges,true);let total=0;for(let a=0;a<n;a++)if(mate[a]>a)total+=w[a+':'+mate[a]];assert.equal(total,brute(Array.from({length:n},(_,i)=>i)));
 }
});
