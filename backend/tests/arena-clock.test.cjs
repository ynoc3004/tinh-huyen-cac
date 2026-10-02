const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../static/arena-live.html'),'utf8');
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
async function flush(){for(let i=0;i<20;i++)await Promise.resolve()}
async function run(status,remain){
  let calls=0, next=1;const intervals=new Map(),elements=new Map(),events={};
  const el=s=>{if(!elements.has(s))elements.set(s,{textContent:'',className:'',innerHTML:'',value:'',open:false,dataset:{},listeners:{},addEventListener(k,f){(this.listeners[k]??=[]).push(f)}});return elements.get(s)};
  const context={URLSearchParams,location:{search:'?id=1'},console,
    document:{visibilityState:'visible',activeElement:{matches:()=>false},querySelector:el,querySelectorAll:()=>[],addEventListener(k,f){events[k]=f}},
    setInterval(fn,ms){const id=next++;intervals.set(id,{fn,ms});return id},clearInterval(id){intervals.delete(id)},
    fetch:async url=>{calls++;return {ok:true,json:async()=>url.endsWith('/students')?[]:{name:'Test',status,remain_sec:remain,players:[],games:[],live:[],standings:[]}}}
  };
  vm.createContext(context);vm.runInContext(script,context);await flush();
  assert.equal(calls,2); // arena + students
  assert.equal(el('#btnPrint2').listeners.click.length,1);
  if(status==='finished'){
    assert.equal([...intervals.values()].filter(x=>x.ms===1000).length,0);
    await vm.runInContext('load()',context);await flush();
    assert.equal(el('#btnPrint2').listeners.click.length,1);
    assert.equal(calls,4);
    assert.equal(el('#btnPair').hidden,true);
    assert.equal(el('#clock').textContent,'0:00');
  }else{
    const clock=[...intervals.values()].find(x=>x.ms===1000);
    status='finished';remain=0;clock.fn();await flush();
    assert.equal(calls,4);assert.equal(el('#btnPrint2').listeners.click.length,1);
    assert.equal([...intervals.values()].filter(x=>x.ms===1000).length,0);
  }
  const poll=[...intervals.values()].find(x=>x.ms===15000);
  const before=calls;
  events.input({target:{matches:()=>true}});poll.fn();await flush();assert.equal(calls,before,'dirty form must not refresh');
  vm.runInContext('formDirty=false',context);context.document.activeElement={matches:()=>true};poll.fn();await flush();assert.equal(calls,before,'focused form must not refresh');
}
(async()=>{
  await run('finished',0);await run('running',1);
  new vm.Script(fs.readFileSync(path.join(__dirname,'../static/arena.js'),'utf8'));
  for(const file of ['tournament.html','arena.html','index.html','library.html','arena-live.html']){
    const text=fs.readFileSync(path.join(__dirname,'../static/',file),'utf8');
    for(const match of text.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
  }
  console.log('PASS: finished clock, expiry refresh, single print listener, dirty/focused form, JavaScript syntax');
})().catch(e=>{console.error(e);process.exitCode=1});
