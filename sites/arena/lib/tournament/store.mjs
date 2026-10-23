import {emptyState,perform,HttpError} from './engine.mjs';
const encodeState=s=>new Map([['meta',JSON.stringify(s.seq)],['students',JSON.stringify(s.students)],...s.tours.map(t=>['tour:'+t.id,JSON.stringify(t)])]);
async function read(db,owner){
 // One statement sees a consistent snapshot, including the CAS revision.
 const {results}=await db.prepare("SELECT key,payload,(SELECT revision FROM state_revisions WHERE owner=?) AS revision FROM state_documents WHERE owner=? AND (key='meta' OR key='students' OR key LIKE 'tour:%')").bind(owner,owner).all();
 const state=emptyState();let revision=0;
 for(const r of results){revision=r.revision??0;const v=JSON.parse(r.payload);if(r.key==='meta')state.seq=v;else if(r.key==='students')state.students=v;else if(r.key.startsWith('tour:'))state.tours.push(v);}
 state.tours.sort((a,b)=>a.id-b.id);return{state,revision};
}
export async function auditLog(db,owner,tid){const {results}=await db.prepare('SELECT id,action,details,at FROM arena_audit WHERE owner=? AND tournament_id=? ORDER BY id').bind(owner,tid).all();return results.map(r=>({...r,details:JSON.parse(r.details)}));}
export async function runOperation(binding,owner,path,method,body,query,now=Date.now()){
 const db=binding.withSession?binding.withSession('first-primary'):binding;
 if(method!=='GET')await db.batch([
  db.prepare('INSERT INTO state_revisions(owner,revision) SELECT ?,0 WHERE NOT EXISTS (SELECT 1 FROM state_revisions WHERE owner=?)').bind(owner,owner),
  db.prepare("INSERT INTO state_documents(owner,key,payload) SELECT ?,'meta',? WHERE NOT EXISTS (SELECT 1 FROM state_documents WHERE owner=? AND key='meta')").bind(owner,JSON.stringify(emptyState().seq),owner)
 ]);
 for(let attempt=0;attempt<4;attempt++){
  const {state,revision}=await read(db,owner);
  const match=path.match(/^\/tournaments\/(\d+)\/(audit|export)$/);
  if(method==='GET'&&match){const t=state.tours.find(t=>t.id===+match[1]);if(!t)throw new HttpError(404,'Không tìm thấy giải');const events=await auditLog(db,owner,t.id);return match[2]==='export'?{schema:'tinh-huyen-cac/1',exported_at:new Date(now).toISOString(),tournament:t,students:state.students.filter(p=>t.groups.some(g=>g.ids.includes(p.id)||g.pairings.some(x=>x.white_id===p.id||x.black_id===p.id))),events}:{tournament:t,events,notice:'Nhật ký hệ thống; không phải biên bản có chữ ký hoặc chứng nhận FIDE.'};}
  const op=perform(state,path,method,body,query,now);if(method==='GET')return op.result;
  const old=encodeState(state),fresh=encodeState(op.state),statements=[
   // A stale revision violates NOT NULL and rolls back the entire D1 batch.
   db.prepare('UPDATE state_revisions SET revision=CASE WHEN revision=? THEN revision+1 ELSE NULL END WHERE owner=?').bind(revision,owner)
  ];
  for(const [key,payload] of fresh)if(payload!==old.get(key)){if(new TextEncoder().encode(payload).byteLength>1900000)throw new HttpError(413,'Dữ liệu giải quá lớn; xuất sao lưu và chia thành các giải riêng');statements.push(db.prepare('DELETE FROM state_documents WHERE owner=? AND key=?').bind(owner,key),db.prepare('INSERT INTO state_documents(owner,key,payload) VALUES(?,?,?)').bind(owner,key,payload));}
  for(const key of old.keys())if(!fresh.has(key))statements.push(db.prepare('DELETE FROM state_documents WHERE owner=? AND key=?').bind(owner,key));
  for(const e of op.events)statements.push(db.prepare('INSERT INTO arena_audit(owner,tournament_id,action,details,at) VALUES(?,?,?,?,?)').bind(owner,e.tournament_id,e.action,JSON.stringify(e.details),new Date(now).toISOString()));
  try{await db.batch(statements);return op.result;}catch(e){if(!/NOT NULL constraint failed: state_revisions.revision/.test(String(e)))throw e;}
 }throw new HttpError(409,'Dữ liệu vừa được cập nhật ở cửa sổ khác. Tải lại và thử lại.');
}
