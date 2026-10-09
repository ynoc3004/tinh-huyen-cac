// Read the displayed Han chapter with a Chinese voice supplied by the browser.
export function speechChunks(text){
 const normalized=String(text??'').replace(/\s+/g,'').replace(/[.;,!?]/g,c=>({'.':'。',';':'；',',':'，','!':'！','?':'？'}[c]));
 const sentences=normalized.match(/[^。！？；]+[。！？；]?/gu)||[];
 // Short utterances avoid long-reading limits in some desktop speech engines.
 return sentences.flatMap(sentence=>Array.from(sentence.matchAll(/.{1,40}/gu),m=>m[0]));
}
const FEMALE_NAMES=['xiaoxiao','xiaoyi','yaoyao','huihui','hanhan','yating'];
const VOICE_STORAGE='thc:dao-voice:v1';
export function femaleVoiceName(voice){
 const name=String(voice.name||'').toLowerCase();
 return FEMALE_NAMES.find(n=>name.includes(n))||null;
}
export function voiceChoiceKey(voice){return JSON.stringify([voice.voiceURI||'',voice.name||'',voice.lang||'']);}
export function chineseVoices(voices){
 const language=v=>String(v.lang||'').toLowerCase().replace(/_/g,'-');
 const supported=v=>/^(zh(?:$|-)|cmn(?:$|-))/.test(language(v))&&!/^(zh-hk|yue)/.test(language(v));
 const rank=v=>{const lang=language(v),female=femaleVoiceName(v);return (female?FEMALE_NAMES.indexOf(female)*10:100)+(lang==='zh-cn'||lang.startsWith('cmn')?0:lang==='zh-tw'?2:4)+(v.localService?0:1);};
 return voices.filter(supported).sort((a,b)=>rank(a)-rank(b));
}
export function chineseVoice(voices){return chineseVoices(voices)[0]||null;}
export function mountDaoSpeech(root,env=globalThis){
 const button=root.querySelector('[data-dao-speak]'),label=root.querySelector('[data-dao-speak-label]'),status=root.querySelector('[data-dao-audio-status]'),text=root.querySelector('[data-dao-han]'),select=root.querySelector('[data-dao-voice]');
 if(!button||!label||!status||!text)return {stop(){},destroy(){}};
 const synth=env.speechSynthesis,Utterance=env.SpeechSynthesisUtterance;
 let preferred='';try{preferred=env.localStorage?.getItem(VOICE_STORAGE)||'';}catch{/* Reading remains available with blocked storage. */}
 let current=null,active=false,waitingVoice=false,generation=0,startedTimer=null;
 function state(playing){
  active=playing;button.setAttribute('aria-pressed',String(playing));
  button.setAttribute('aria-label',playing?'Dừng đọc Hán văn':'Nghe Hán văn bằng tiếng Trung');
  button.title=playing?'Bấm để dừng đọc':'Đọc chương đang hiển thị bằng tiếng Trung';
  label.textContent=playing?'Dừng đọc':'Nghe Hán văn';
 }
 function stop(message=''){
  const wasActive=active;generation++;env.clearTimeout(startedTimer);startedTimer=null;
  // Invalidate handlers before cancel(), which may fire an error synchronously.
  current=null;state(false);if(wasActive)synth?.cancel();status.textContent=message;
 }
 if(!synth||typeof Utterance!=='function'){
  button.disabled=true;if(select)select.disabled=true;status.textContent='Trình duyệt này chưa hỗ trợ đọc thành tiếng.';
  return {stop,destroy(){button.onclick=null;if(select)select.onchange=null;}};
 }
 function refreshVoices(){
  let voices;try{voices=chineseVoices(synth.getVoices());}catch{return;}
  if(select){
   const option=(value,text)=>{const node=env.document.createElement('option');node.value=value;node.textContent=text;return node;};
   select.replaceChildren(option('','Tự chọn · ưu tiên giọng nữ'),...voices.map(v=>option(voiceChoiceKey(v),v.name+(femaleVoiceName(v)?' · Nữ':'')+' · '+v.lang)));
   select.value=voices.some(v=>voiceChoiceKey(v)===preferred)?preferred:'';select.disabled=!voices.length;
  }
  if(waitingVoice&&voices.length){waitingVoice=false;status.textContent='Giọng tiếng Trung đã sẵn sàng. Bấm loa để nghe.';}
 }
 if(select)select.onchange=()=>{
  preferred=select.value;
  try{env.localStorage?.setItem(VOICE_STORAGE,preferred);}catch{/* Keep this choice for the current page even when storage is blocked. */}
  stop('Đã đổi giọng đọc. Bấm loa để nghe.');
 };
 function play(){
  if(active){stop('Đã dừng đọc.');return;}
  let voice;
  try{const voices=chineseVoices(synth.getVoices());voice=voices.find(v=>voiceChoiceKey(v)===preferred)||voices[0]||null;}catch{status.textContent='Không lấy được giọng đọc. Hãy thử lại.';return;}
  if(!voice){waitingVoice=true;status.textContent='Chưa có giọng tiếng Trung. Thêm giọng Chinese trong cài đặt giọng nói của máy rồi thử lại.';return;}
  const chunks=speechChunks(text.textContent);if(!chunks.length){status.textContent='Chưa có Hán văn để đọc.';return;}
  waitingVoice=false;const token=++generation;state(true);status.textContent='Đang chuẩn bị giọng đọc…';
  let position=0;
  function next(){
   if(token!==generation)return;
   if(position===chunks.length){stop('Đã đọc xong chương.');return;}
   const utterance=new Utterance(chunks[position++]);current=utterance;
   utterance.voice=voice;utterance.lang=voice.lang;utterance.rate=.85;utterance.pitch=1;utterance.volume=1;
   utterance.onstart=()=>{if(token!==generation)return;env.clearTimeout(startedTimer);startedTimer=null;status.textContent='Đang đọc Hán văn · '+voice.name;};
   utterance.onend=()=>{if(token!==generation)return;env.clearTimeout(startedTimer);startedTimer=null;current=null;next();};
   utterance.onerror=event=>{if(token!==generation)return;stop(event.error==='not-allowed'?'Trình duyệt chưa cho phát âm thanh. Bấm loa để thử lại.':'Không phát được giọng đọc. Hãy kiểm tra giọng tiếng Trung hoặc kết nối mạng rồi thử lại.');};
   startedTimer=env.setTimeout(()=>{if(token===generation)stop('Giọng đọc không phản hồi. Bấm loa để thử lại.');},15000);
   try{synth.speak(utterance);}catch{stop('Không phát được giọng đọc. Hãy thử lại.');}
  }
  next();
 }
 function hidden(){if(env.document.hidden&&active)stop('Đã dừng đọc khi rời trang.');}
 function leaving(){if(active)stop();}
 button.onclick=play;state(false);synth.addEventListener?.('voiceschanged',refreshVoices);
 // Trigger voice discovery early; some browsers populate the list asynchronously.
 refreshVoices();
 env.document.addEventListener('visibilitychange',hidden);env.addEventListener('pagehide',leaving);
 return {stop,destroy(){stop();button.onclick=null;if(select)select.onchange=null;synth.removeEventListener?.('voiceschanged',refreshVoices);env.document.removeEventListener('visibilitychange',hidden);env.removeEventListener('pagehide',leaving);}};
}
