import test from 'node:test';
import assert from 'node:assert/strict';
import {roundRobin,standings,swissPair} from '../lib/tournament/pairing.mjs';
import {inspectGroup} from '../lib/tournament/integrity.mjs';
import {perform,emptyState} from '../lib/tournament/engine.mjs';

test('Berger exact published FIDE tables for 4, 6, and 8 draw numbers',()=>{
 const fixtures={
  4:[[[1,4],[2,3]],[[4,3],[1,2]],[[2,4],[3,1]]],
  6:[[[1,6],[2,5],[3,4]],[[6,4],[5,3],[1,2]],[[2,6],[3,1],[4,5]],[[6,5],[1,4],[2,3]],[[3,6],[4,2],[5,1]]],
  8:[[[1,8],[2,7],[3,6],[4,5]],[[8,5],[6,4],[7,3],[1,2]],[[2,8],[3,1],[4,7],[5,6]],[[8,6],[7,5],[1,4],[2,3]],[[3,8],[4,2],[5,1],[6,7]],[[8,7],[1,6],[2,5],[3,4]],[[4,8],[5,3],[6,2],[7,1]]]
 };
 for(const [n,expected] of Object.entries(fixtures))assert.deepEqual(roundRobin(Array.from({length:+n},(_,i)=>i+1)),expected);
});

test('SB and BH have independently calculated expected values and round-robin rests stay zero',()=>{
 // A beats B and C, loses D; B draws C, beats D; C beats D.
 const rows=[[1,2,'1-0',1],[3,4,'1-0',1],[1,3,'1-0',2],[2,4,'1-0',2],[4,1,'1-0',3],[2,3,'1/2',3]];
 const st=Object.fromEntries(standings(rows,'round_robin',[1,2,3,4]).map(p=>[p.student_id,p]));
 assert.deepEqual([st[1].points,st[2].points,st[3].points,st[4].points],[2,1.5,1.5,1]);
 assert.deepEqual([st[1].sb,st[2].sb,st[3].sb,st[4].sb],[3,1.75,1.75,2]);
 const bye=Object.fromEntries(standings([[1,null,'bye',1],[2,3,'1-0',1],[1,2,'1/2',2],[3,4,'1-0',2],[1,3,'0-1',3],[2,4,'1/2',3]],'swiss',[1,2,3,4],3).map(p=>[p.student_id,p]));
 assert.equal(bye[1].points,1.5);assert.equal(bye[1].bh,5.5);assert.equal(bye[1].bhc1,4);assert.equal(bye[1].sb,2.5);
});

test('Integrity checker refuses round gaps, duplicate boards, self-pairing, and invalid rests',()=>{
 const row={white_id:1,black_id:2,round:1,board:1,result:null};
 const group={ids:[1,2],format:'round_robin',pairings:[row]};assert.deepEqual(inspectGroup(group),[]);
 for(const pairings of [[{...row,round:2}],[row,{...row}],[{...row,black_id:1}],[{...row,black_id:null,result:'bye'},{...row,white_id:2,black_id:null,result:'bye',board:2}]])assert(inspectGroup({...group,pairings}).length);
 const swiss={ids:[1,2,3],format:'swiss',swiss_rounds:1,pairings:[{...row},{white_id:3,black_id:null,round:1,board:2,result:'bye'}]};assert.deepEqual(inspectGroup(swiss),[]);
 assert(inspectGroup({...swiss,pairings:[...swiss.pairings,{...row,round:2},{white_id:3,black_id:null,round:2,board:2,result:'bye'}]}).length);
});

test('Independent Swiss field sizes 128 and 256 cover every entrant over four rounds',()=>{
 for(const n of [128,256]){const ids=Array.from({length:n},(_,i)=>i+1),history=[],seen=new Set();
  for(let r=1;r<=4;r++){const pairs=swissPair(ids,history,{},42);assert.equal(pairs.length,n/2);assert.equal(new Set(pairs.flat()).size,n);
   for(const [a,b] of pairs){const key=[a,b].sort((a,b)=>a-b).join(':');assert(!seen.has(key));seen.add(key);history.push([a,b,'1/2',r]);}
  }
 }
});

test('Metadata and Berger draw order persist; stale result edits cannot overwrite fresh results',()=>{
 let state=emptyState();const call=(path,method='GET',body={})=>{const op=perform(state,path,method,body);state=op.state;return op.result;};
 call('/students','POST',[{name:'An'},{name:'Bình'},{name:'Chi'}]);
 const {tournament_id:tid}=call('/tournaments/from-draw','POST',{name:'Giải chính thức',venue:'Nhà thi đấu',organizer:'CLB A',chief_arbiter:'Trọng tài A',time_control:'15+10',seed:42,groups:[[1,2,3]],group_names:['U6']});
 const gid=state.tours[0].groups[0].id;call('/groups/'+gid+'/pair','POST');
 const tour=call('/tournaments/'+tid);assert.equal(tour.venue,'Nhà thi đấu');assert.equal(tour.time_control,'15+10');assert.deepEqual([...tour.groups[0].draw_order].sort(),[1,2,3]);
 const p=state.tours[0].groups[0].pairings.find(p=>p.black_id!==null);
 call('/pairings/'+p.id,'PUT',{result:'1-0',expected_result:null});
 assert.throws(()=>call('/pairings/'+p.id,'PUT',{result:'0-1',expected_result:null}),e=>e.status===409);
 assert.equal(state.tours[0].groups[0].pairings.find(x=>x.id===p.id).result,'1-0');
});
