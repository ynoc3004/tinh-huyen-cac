const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../static/tien-canh.js'),'utf8');
function client(seed={},blocked=false,search=''){
 const values=new Map(Object.entries(seed)),events={},css={},root={dataset:{},style:{setProperty:(key,value)=>css[key]=value}};
 const context={URLSearchParams,Date,location:{search},CustomEvent:class{constructor(type,args){this.type=type;this.detail=args.detail;}},document:{documentElement:root,readyState:'loading',querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},localStorage:{getItem:key=>{if(blocked)throw Error('blocked');return values.get(key)||null;},setItem:(key,value)=>{if(blocked)throw Error('blocked');values.set(key,value);},removeItem:key=>values.delete(key)},matchMedia:()=>({matches:false}),addEventListener:(name,handler)=>events[name]=handler,dispatchEvent(){},setInterval(){}};
 context.window=context;vm.runInNewContext(source,context);return {api:context.THCAppearance,values,events,css,root};
}
const first=client();assert.equal(first.api.getFont(),'default');assert.match(first.css['--font-body'],/Noto Serif/);assert.match(first.css['--title'],/Charm/);
assert(first.api.setFont('philosopher'));assert.match(first.css['--font-body'],/Philosopher/);assert.equal(first.css['--title'],first.css['--font-body']);
const reopened=client(Object.fromEntries(first.values));assert.equal(reopened.api.getFont(),'philosopher');
reopened.values.set('thc-font','charm');reopened.events.storage({key:'thc-font'});assert.equal(reopened.api.getFont(),'charm');assert.match(reopened.css['--font-body'],/Charm/);
reopened.api.setFont('default');assert.match(reopened.css['--font-body'],/Noto Serif/);assert.match(reopened.css['--title'],/Charm/);
assert.equal(client({titleFont:"'Playfair Display',serif"}).api.getFont(),'playfair');assert.equal(client({'thc-font':'bogus'}).api.getFont(),'default');
assert.equal(first.api.setFont('unknown'),false);assert.equal(first.api.getFont(),'philosopher');
first.api.setAutoTheme('light');assert.equal(first.root.dataset.theme,'light');first.api.setTheme('dark');first.api.setAutoTheme('light');assert.equal(first.root.dataset.theme,'dark');
first.api.setTheme('auto');assert.equal(first.root.dataset.theme,'light');first.values.set('thc-theme','dark');first.events.storage({key:'thc-theme'});assert.equal(first.root.dataset.theme,'dark');
first.values.clear();first.events.storage({key:null});assert.equal(first.api.getTheme(),'auto');assert.equal(first.api.getFont(),'default');
const unavailable=client({},true);assert.equal(unavailable.api.setFont('philosopher'),false);assert.match(unavailable.css['--font-body'],/Philosopher/);assert.equal(unavailable.api.setTheme('light'),false);assert.equal(unavailable.root.dataset.theme,'light');
const demo=client({},false,'?theme=light');demo.api.setTheme('dark');assert.equal(demo.root.dataset.theme,'light');
console.log('PASS: global body/title fonts, reload, cross-tab changes, reset, legacy font, invalid values, auto/manual theme and blocked storage');
