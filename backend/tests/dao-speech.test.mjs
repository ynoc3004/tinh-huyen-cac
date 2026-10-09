import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mountDaoSpeech,speechChunks,chineseVoice,voiceChoiceKey,femaleVoiceName} from '../static/dao-speech.js';
const cn={name:'Chinese local',lang:'zh-CN',localService:true},tw={name:'Taiwan',lang:'zh-TW',localService:true},en={name:'English',lang:'en-US'};
assert.equal(chineseVoice([en,tw,cn]),cn);assert.equal(chineseVoice([en]),null);
assert.equal(chineseVoice([{lang:'zh-HK'},{lang:'yue-HK'}]),null);
assert.deepEqual(speechChunks('道 可 道. 名 可 名; 無 名, 天 地.'),['道可道。','名可名；','無名，天地。']);
assert.equal(speechChunks('道'.repeat(170)).map(s=>s.length).join(','),'40,40,40,40,10');
function mount({voices=[cn],supported=true,fail=false,storage=new Map(),blockedStorage=false}={}){
 const nodes=Object.fromEntries(['speak','speak-label','audio-status','han','voice'].map(key=>[key,{textContent:'',value:'',children:[],replaceChildren(...children){this.children=children;},attrs:{},setAttribute(k,v){this.attrs[k]=v;}}]));
 nodes.han.textContent='道 可 道. 名 可 名.';
 const root={querySelector:selector=>nodes[selector.slice(10,-1)]};
 const events=new Map(),documentEvents=new Map(),voiceEvents=new Map(),timers=new Map(),utterances=[];let timerId=0,cancels=0;
 class Utterance{constructor(text){this.text=text;}}
 const env={SpeechSynthesisUtterance:Utterance,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
  localStorage:{getItem:key=>{if(blockedStorage)throw Error('blocked');return storage.get(key);},setItem:(key,value)=>{if(blockedStorage)throw Error('blocked');storage.set(key,value);}},
  document:{createElement:()=>({}),hidden:false,addEventListener:(event,fn)=>documentEvents.set(event,fn),removeEventListener:event=>documentEvents.delete(event)},
  addEventListener:(event,fn)=>events.set(event,fn),removeEventListener:event=>events.delete(event),
  speechSynthesis:supported?{getVoices:()=>voices,speak:u=>{if(fail)throw Error('failed');utterances.push(u);},cancel(){cancels++;utterances.at(-1)?.onerror?.({error:'canceled'});},addEventListener:(event,fn)=>voiceEvents.set(event,fn),removeEventListener:event=>voiceEvents.delete(event)}:null};
 const controller=mountDaoSpeech(root,env);
 return {nodes,env,events,documentEvents,voiceEvents,utterances,timers,controller,storage,cancels:()=>cancels};
}
const app=mount();assert.equal(app.utterances.length,0,'Never auto-play');app.nodes.speak.onclick();
assert.equal(app.nodes.speak.attrs['aria-pressed'],'true');assert.equal(app.utterances[0].voice,cn);assert.equal(app.utterances[0].lang,'zh-CN');
app.utterances[0].onstart();assert.equal(app.timers.size,0);app.utterances[0].onend();assert.equal(app.utterances.length,2,'Read the full chapter sequentially');
app.utterances[1].onstart();app.utterances[1].onend();assert.match(app.nodes['audio-status'].textContent,/đọc xong/);assert.equal(app.nodes.speak.attrs['aria-pressed'],'false');
app.nodes.speak.onclick();const stale=app.utterances.at(-1);app.nodes.speak.onclick();assert.match(app.nodes['audio-status'].textContent,/Đã dừng/);
const count=app.utterances.length;stale.onend();assert.equal(app.utterances.length,count,'Late callbacks must not restart stopped speech');
app.nodes.han.textContent='玄 之 又 玄.';app.nodes.speak.onclick();assert.equal(app.utterances.at(-1).text,'玄之又玄。','Read the currently displayed text');
app.env.document.hidden=true;app.documentEvents.get('visibilitychange')();assert.equal(app.nodes.speak.attrs['aria-pressed'],'false');
app.env.document.hidden=false;app.nodes.speak.onclick();app.events.get('pagehide')();assert.equal(app.nodes.speak.attrs['aria-pressed'],'false');
app.nodes.speak.onclick();app.utterances.at(-1).onerror({error:'not-allowed'});assert.match(app.nodes['audio-status'].textContent,/chưa cho/);
app.controller.destroy();assert.equal(app.nodes.speak.onclick,null);assert.equal(app.events.size,0);assert.equal(app.documentEvents.size,0);assert.equal(app.voiceEvents.size,0);assert.equal(app.timers.size,0);
const delayed=[];const missing=mount({voices:delayed});missing.nodes.speak.onclick();assert.match(missing.nodes['audio-status'].textContent,/Chưa có giọng/);assert.equal(missing.utterances.length,0);
delayed.push(cn);missing.voiceEvents.get('voiceschanged')();assert.match(missing.nodes['audio-status'].textContent,/sẵn sàng/);assert.equal(missing.utterances.length,0,'Loading voices does not autoplay');missing.nodes.speak.onclick();assert.equal(missing.utterances.length,1);missing.controller.destroy();
const unsupported=mount({supported:false});assert.equal(unsupported.nodes.speak.disabled,true);assert.match(unsupported.nodes['audio-status'].textContent,/chưa hỗ trợ/);unsupported.controller.destroy();
const failed=mount({fail:true});failed.nodes.speak.onclick();assert.equal(failed.nodes.speak.attrs['aria-pressed'],'false');assert.match(failed.nodes['audio-status'].textContent,/Không phát/);assert.equal(failed.timers.size,0);failed.controller.destroy();
const timeout=mount();timeout.nodes.speak.onclick();[...timeout.timers.values()][0]();assert.match(timeout.nodes['audio-status'].textContent,/không phản hồi/);timeout.controller.destroy();
// Prefer known female voices, but respect an explicit voice choice after reload.
const male={name:'Microsoft Kangkang',lang:'zh-CN',localService:true},female={name:'Microsoft Huihui',lang:'zh-CN',localService:true},natural={name:'Microsoft Xiaoxiao Online (Natural)',lang:'zh-CN',localService:false};
assert.equal(chineseVoice([male,female,natural]),natural);
assert.equal(chineseVoice([male,female]),female);assert.equal(femaleVoiceName(male),null);
const selectable=mount({voices:[en,male,female,natural,tw]});
assert.equal(selectable.nodes.voice.children.length,5,'Only Chinese voices plus Auto are shown');
assert.match(selectable.nodes.voice.children[1].textContent,/Xiaoxiao.*Nữ/);
selectable.nodes.speak.onclick();assert.equal(selectable.utterances[0].voice,natural);
const old=selectable.utterances[0];selectable.nodes.voice.value=voiceChoiceKey(tw);selectable.nodes.voice.onchange();
assert.equal(selectable.nodes.speak.attrs['aria-pressed'],'false');old.onend();assert.equal(selectable.utterances.length,1,'Changing voice cancels the old queue without autoplay');
selectable.nodes.speak.onclick();assert.equal(selectable.utterances.at(-1).voice,tw);
const saved=selectable.storage;selectable.controller.destroy();
const reloaded=mount({voices:[natural,tw],storage:saved});assert.equal(reloaded.nodes.voice.value,voiceChoiceKey(tw));reloaded.nodes.speak.onclick();assert.equal(reloaded.utterances[0].voice,tw);reloaded.controller.destroy();
const later=[female];const deferred=mount({voices:later,storage:saved});assert.equal(deferred.nodes.voice.value,'','Missing saved voice uses Auto temporarily');later.push(tw);deferred.voiceEvents.get('voiceschanged')();assert.equal(deferred.nodes.voice.value,voiceChoiceKey(tw),'Restore saved choice when voices arrive');deferred.controller.destroy();
const blocked=mount({voices:[male,female],blockedStorage:true});blocked.nodes.voice.value=voiceChoiceKey(male);blocked.nodes.voice.onchange();blocked.nodes.speak.onclick();assert.equal(blocked.utterances[0].voice,male);blocked.controller.destroy();
const data=JSON.parse(await readFile(new URL('../static/dao-duc-kinh.json',import.meta.url),'utf8'));
for(const chapter of data.chapters){const chunks=speechChunks(chapter.han);assert.ok(chunks.length);assert.ok(chunks.every(chunk=>chunk.length<=40));assert.equal(chunks.join(''),chapter.han.replace(/\s+/g,'').replace(/[.;,!?]/g,c=>({'.':'。',';':'；',',':'，','!':'！','?':'？'}[c])));}
console.log('PASS: 81 complete chapters, female voice preference, selectable/saved voices, play/stop/end, delayed voices, errors/timeouts, current text, navigation cleanup and no autoplay');
