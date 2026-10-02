const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../static/arena.html'),'utf8');const script=fs.readFileSync(path.join(__dirname,'../static/arena.js'),'utf8');
const nodes=new Map(),requests=[];
function node(id){if(!nodes.has(id))nodes.set(id,{id,value:'',checked:false,hidden:false,innerHTML:'',textContent:'',dataset:{},events:{},classList:{toggle(){},remove(){}},setAttribute(){},removeAttribute(){},scrollIntoView(){},addEventListener(k,f){(this.events[k]??=[]).push(f)},closest(){return null}});return nodes.get(id)}
for(const m of html.matchAll(/id="([^"]+)"/g))node(m[1]);
node('grouping').value='draw';node('statusFilter').value='all';node('mode').value='pots';node('size').value='8';node('adur').value='60';node('avoid').checked=true;
const nav=['list','create','students'].map(tab=>({...node('nav-'+tab),dataset:{tab}})),panels=['list','create','students'].map(tab=>node('panel-'+tab)),radios=['classic','arena'].map(value=>({...node('radio-'+value),value}));
const students=Array.from({length:16},(_,i)=>({id:i+1,name:'Học viên '+(i+1),rating:null,club:i%3===0?'CLB A':null}));
const ctx={console,URLSearchParams,location:{href:'',pathname:'/arena.html',search:''},setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},matchMedia:()=>({matches:true}),confirm:()=>true,prompt:()=>null,print(){},addEventListener(){},document:{body:{dataset:{}},querySelector:s=>node(s.replace(/^#/,'')),querySelectorAll:s=>s==='.workspace-panel'?panels:s==='[data-tab]'?nav:s==='[name=eventType]'?radios:[]},fetch:async(url,opt)=>{const body=opt?.body?JSON.parse(opt.body):undefined;requests.push({url,body});let data=[];
if(url==='/api/students')data=students;
if(url==='/api/tournaments')data=[{id:1,name:'Giải tháng 10',status:'prepare'},{id:2,name:'Giải tháng 9',status:'finished'},{id:3,name:'Arena luyện tập',status:'running'}];
if(url==='/api/arenas')data=[{id:3,name:'Arena luyện tập',status:'running',duration_min:60}];
if(url==='/api/draw')data={seed:body.seed??42,format:body.format,groups:[{name:'Thiên',ids:body.student_ids.slice(0,8)},{name:'Địa',ids:body.student_ids.slice(8)}]};
if(url==='/api/tournaments/from-draw')data={tournament_id:10};
if(url==='/api/tournaments/10')data={id:10,name:'Giải kiểm thử',groups:[{id:11,name:'Thiên',ord:1,format:'swiss',players:students.slice(0,8)}]};
if(url==='/api/groups/11/pairings')data=[{id:1,round:1,board:1,white_id:1,black_id:2,result:null}];
if(url==='/api/arenas'&&body)data={tournament_id:20};
return {ok:true,json:async()=>data}}};
async function flush(){for(let i=0;i<30;i++)await Promise.resolve()}
async function click(id){const n=node(id);if(n.onclick)await n.onclick({target:n});await flush()}
async function viewEvent(id){const e={target:node(id)};for(const f of node('view').events.click||[])await f(e);await flush()}
(async()=>{vm.createContext(ctx);vm.runInContext(script,ctx);await flush();
assert.equal((node('tours').innerHTML.match(/data-open=/g)||[]).length,2,'Arena must not be duplicated in classic list');assert.equal((node('arenas').innerHTML.match(/data-arena=/g)||[]).length,1);
await click('quickCreate');assert.equal(node('panel-create').hidden,false);assert.equal(node('panel-list').hidden,true);assert.equal(node('view').hidden,true);
assert.equal(node('npick').textContent,'16 / 16');assert(node('ratingNote').textContent.includes('Chưa có rating'));await click('pnone');assert.equal(node('create').disabled,true);await click('pall');assert.equal(node('create').disabled,false);
node('gcount').value='2';node('seed').value='123';node('tname').value='Giải kiểm thử';await click('create');
const draw=requests.find(r=>r.url==='/api/draw').body;assert.equal(draw.student_ids.length,16);assert.equal(draw.group_count,2);assert.equal(draw.seed,123);assert.equal(draw.format,undefined);assert.equal(draw.avoid_club,true);assert.equal(draw.mode,'pots');assert(node('view').innerHTML.includes('id="commit"'));assert.equal(node('panel-list').hidden,false);assert.equal(node('view').hidden,false);
assert(!html.includes('id="format"'));
for(const f of node('view').events.change||[])await f({target:{dataset:{previewFormat:'1'},value:'swiss'}});
await viewEvent('commit');const committed=requests.find(r=>r.url==='/api/tournaments/from-draw').body;assert.equal(committed.groups.flat().length,16);assert.deepEqual(Array.from(committed.group_formats),['round_robin','swiss']);assert.equal(committed.format,undefined);assert.equal(committed.seed,123);
assert.equal(ctx.location.href,'/tournament.html?id=10');for(const metric of ['data-we','data-wt','data-be','data-bt','data-save-pair','data-swiss','mkfin'])assert(script.includes(metric),metric+' must remain available');
radios[1].onchange();assert.equal(node('arenaFields').hidden,false);assert.equal(node('classicFields').hidden,true);assert.equal(node('acreate').hidden,false);node('aname').value='Arena kiểm thử';node('adur').value='45';await click('acreate');const arena=requests.find(r=>r.url==='/api/arenas'&&r.body).body;assert.equal(arena.student_ids.length,16);assert.equal(arena.duration_min,45);assert.equal(ctx.location.href,'/arena-live.html?id=20');
await click('goStudents');assert.equal(node('panel-students').hidden,false);node('studentSearch').value='Học viên 16';node('studentSearch').oninput();assert.equal((node('studentBody').innerHTML.match(/<tr>/g)||[]).length,1);await click('backCreate');assert.equal(node('panel-create').hidden,false);
node('statusFilter').value='finished';node('statusFilter').onchange();assert(node('tours').innerHTML.includes('Giải tháng 9'));assert(!node('tours').innerHTML.includes('Giải tháng 10'));
console.log('PASS: navigation, shared selection, rating note, filters, complete draw/commit payload, four metrics, Swiss/finals controls, Arena payload, student search');
})().catch(e=>{console.error(e);process.exitCode=1});
