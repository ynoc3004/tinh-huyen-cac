// Structural validation is shared by backups, the arbiter report, and finish.
// It deliberately does not claim to certify a Swiss pairing system.
export function inspectGroup(g) {
 const issues=[], ids=new Set(g.ids), rows=[...g.pairings].sort((a,b)=>a.round-b.round||a.board-b.board);
 const seen=new Set(), rests=new Set(), colors={}, active=new Set();
 if(ids.size!==g.ids.length)issues.push('Danh sách kỳ thủ trùng mã');
 const rounds=[...new Set(rows.map(p=>p.round))];
 if(rounds.some((r,i)=>!Number.isSafeInteger(r)||r!==i+1))issues.push('Số vòng phải liên tục từ vòng 1');
 if(g.format==='round_robin'&&rounds.length>Math.max(0,g.ids.length-1+g.ids.length%2))issues.push('Vượt số vòng vòng tròn');
 if(g.format==='swiss'&&g.swiss_rounds&&rounds.length>g.swiss_rounds)issues.push('Vượt số vòng Swiss đã chốt');
 let expectedKnockout=null;
 for(const round of rounds){
  const ps=rows.filter(p=>p.round===round), present=[], boards=new Set();let byes=0;
  for(const p of ps){
   if(!Number.isSafeInteger(p.board)||p.board<1||boards.has(p.board))issues.push(`Vòng ${round}: số bàn không hợp lệ hoặc bị trùng`);
   boards.add(p.board);present.push(p.white_id);
   if(p.black_id===null){
    byes++;
    if(p.result!=='bye')issues.push(`Vòng ${round}: kết quả ván nghỉ không hợp lệ`);
    if(g.format==='swiss'&&rests.has(p.white_id))issues.push(`Vòng ${round}: kỳ thủ nghỉ có điểm lần thứ hai`);
    rests.add(p.white_id);continue;
   }
   present.push(p.black_id);
   if(p.white_id===p.black_id)issues.push(`Vòng ${round}: kỳ thủ tự gặp chính mình`);
   if(p.result!==null&&!['1-0','0-1','1/2'].includes(p.result))issues.push(`Vòng ${round}: kết quả không hợp lệ`);
   const key=[p.white_id,p.black_id].sort((a,b)=>a-b).join(':');
   if(['swiss','round_robin'].includes(g.format)&&seen.has(key))issues.push(`Vòng ${round}: trùng đối thủ`);
   seen.add(key);
   if(g.format==='arena'&&!p.result)for(const id of [p.white_id,p.black_id]){if(active.has(id))issues.push('Một kỳ thủ đang ở hai ván chưa hoàn thành');active.add(id);}
   for(const [id,c] of [[p.white_id,'w'],[p.black_id,'b']]){
    const cs=colors[id]??=[];cs.push(c);
    if(g.format==='swiss'&&p.pairing_source!=='arbiter'&&(Math.abs(cs.filter(c=>c==='w').length-cs.filter(c=>c==='b').length)>2||['www','bbb'].includes(cs.slice(-3).join(''))))issues.push(`Vòng ${round}: vi phạm màu quân`);
   }
  }
  if(new Set(present).size!==present.length)issues.push(`Vòng ${round}: một người xuất hiện ở hai bàn`);
  if(g.format!=='arena'&&present.some(id=>!ids.has(id)))issues.push(`Vòng ${round}: kỳ thủ ngoài danh sách`);
  if(['swiss','round_robin'].includes(g.format)){
   if(present.length!==g.ids.length)issues.push(`Vòng ${round}: thiếu kỳ thủ`);
   if(byes!==g.ids.length%2)issues.push(`Vòng ${round}: số lượt nghỉ không hợp lệ`);
  }
  if(g.format==='arena'&&byes)issues.push('Arena không có ván nghỉ được cộng điểm');
  if(g.format==='knockout'){
   const expected=expectedKnockout??g.ids;
   if(expected===null||present.length!==expected.length||present.some(id=>!expected.includes(id)))issues.push(`Vòng ${round}: nhánh loại trực tiếp không khớp người thắng vòng trước`);
   const size=2**Math.ceil(Math.log2(g.ids.length));
   if(ps.length!==(round===1?size/2:expected.length/2)||round>1&&byes)issues.push(`Vòng ${round}: số bàn/nhánh loại trực tiếp không hợp lệ`);
   expectedKnockout=ps.map(p=>p.black_id===null||p.result==='1-0'?p.white_id:p.result==='0-1'?p.black_id:null);
   if(expectedKnockout.includes(null)&&round!==rounds.at(-1))issues.push(`Vòng ${round}: vòng sau được ghép khi chưa phân định thắng thua`);
  }
 }
 return [...new Set(issues)];
}
