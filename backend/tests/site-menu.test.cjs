const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const directory=path.join(__dirname,'../static'),source=fs.readFileSync(path.join(directory,'tien-canh.js'),'utf8');

// A small DOM fixture executes the real shell; native dialog close/cancel is modeled.
function client(pathname,{existing=false,blocked=false,seed={}}={}){
 const storage=new Map(Object.entries(seed)),events={},css={},document={readyState:'loading',activeElement:null};
 class Element{
  constructor(tag){this.tagName=tag.toLowerCase();this.attributes={};this.children=[];this.dataset={};this.listeners={};this.value='';this.open=false;this.style={setProperty:(key,value)=>css[key]=value};this.text='';
   this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(' ')},toggle:(name,on)=>{const values=new Set(this.className.split(/\s+/).filter(Boolean));if(on??!values.has(name))values.add(name);else values.delete(name);this.className=[...values].join(' ');return values.has(name)},contains:name=>this.className.split(/\s+/).includes(name)};
  }
  get className(){return this.attributes.class||''}set className(value){this.attributes.class=value}
  get id(){return this.attributes.id||''}set id(value){this.attributes.id=value}
  setAttribute(key,value){this.attributes[key]=String(value);if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value)}
  getAttribute(key){return this.attributes[key]??null}
  append(child){child.parent=this;this.children.push(child)}prepend(child){child.parent=this;this.children.unshift(child)}
  set innerHTML(value){this.html=value;this.children=[];const stack=[this],voids=new Set(['input','meta','link','img','br']);
   for(const token of value.match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){stack.pop();continue}if(!token.startsWith('<')){stack.at(-1).text+=token;continue}
    const name=token.match(/^<([\w-]+)/)?.[1];if(!name)continue;const element=new Element(name);
    const attributes=token.slice(name.length+1).replace(/\/?\s*>$/,'');for(const match of attributes.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g))element.setAttribute(match[1],match[2]??match[3]??match[4]??'');
    stack.at(-1).append(element);if(!token.endsWith('/>')&&!voids.has(name))stack.push(element);
   }
  }
  get innerHTML(){return this.html||''}
  matches(selector){const attr=selector.match(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/);if(attr&&(this.getAttribute(attr[1])===null||attr[2]!==undefined&&this.getAttribute(attr[1])!==attr[2]))return false;
   const rest=selector.replace(/\[[^\]]+\]/g,'');const tag=rest.match(/^[\w-]+/);if(tag&&tag[0]!==this.tagName)return false;const id=rest.match(/#([\w-]+)/);if(id&&this.id!==id[1])return false;
   return [...rest.matchAll(/\.([\w-]+)/g)].every(match=>this.classList.contains(match[1]));
  }
  querySelectorAll(selector){const found=[];const visit=node=>{for(const child of node.children){if(selector.split(',').some(part=>{const pieces=part.trim().split(/\s+/);if(!child.matches(pieces.at(-1)))return false;let parent=child.parent;for(let i=pieces.length-2;i>=0;i--){while(parent&&!parent.matches(pieces[i]))parent=parent.parent;if(!parent)return false;parent=parent.parent}return true}))found.push(child);visit(child)}};visit(this);return found}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  closest(selector){for(let node=this;node;node=node.parent)if(node.matches(selector))return node;return null}
  addEventListener(type,callback){(this.listeners[type]??=[]).push(callback)}
  fire(type,args={}){const event={type,target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true},...args};for(const listener of this.listeners[type]||[])listener(event);return event}
  focus(){document.activeElement=this}
  showModal(){this.open=true;this.modal=true}
  close(){if(!this.open)return;this.open=false;this.modal=false;this.fire('close')}
  cancel(){const event=this.fire('cancel');if(!event.defaultPrevented)this.close()}
  getBoundingClientRect(){return this.tagName==='dialog'?{left:20,right:660,top:30,bottom:740}:{bottom:78}}
 }
 document.documentElement=new Element('html');document.body=new Element('body');document.documentElement.append(document.body);
 const host=new Element(pathname==='/learn.html'?'main':'div');host.className=pathname==='/review.html'?'review-shell':'wrap';document.body.append(host);
 if(existing){const header=new Element('header');header.className='site-header';header.innerHTML='<a class="site-brand" href="/">Quán</a><nav class="site-navigation"><a href="/">Cổng môn</a></nav>';host.append(header)}
 const sky=new Element('div');sky.id='sky';document.body.append(sky);
 document.createElement=tag=>new Element(tag);
 document.querySelector=selector=>{if(selector==='body > main')return document.body.children.find(node=>node.tagName==='main')||null;if(selector==='body > .wrap, body > .review-shell')return host;return document.documentElement.querySelector(selector)};
 document.querySelectorAll=selector=>document.documentElement.querySelectorAll(selector);
 document.addEventListener=(type,callback)=>(events[type]??=[]).push(callback);
 const context={document,location:{pathname,search:''},URLSearchParams,Date,CustomEvent:class{constructor(type,args){this.type=type;this.detail=args.detail}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(blocked)throw Error('blocked');storage.set(key,value)},removeItem:key=>storage.delete(key)},matchMedia:()=>({matches:false}),setInterval(){},scrollY:0,addEventListener:(type,callback)=>(events[type]??=[]).push(callback),dispatchEvent(){}};
 context.window=context;vm.createContext(context);vm.runInContext(source,context);for(const callback of events.DOMContentLoaded)callback();document.readyState='complete';
 return{document,context,storage,header:document.querySelector('.site-header'),menu:document.querySelector('#site-menu'),toggle:document.querySelector('.site-menu-toggle'),root:document.documentElement};
}

const routes={'/':'home','/index.html':'home','/dao-lo.html':'dao-lo','/library.html':'library','/bi-canh.html':'bi-canh','/worksheets.html':'worksheets','/arena.html':'arena','/history.html':'history','/study.html':'study','/tournament.html':'arena','/arena-live.html':'arena','/reader.html':'library','/books.html':'study','/book.html':'study','/scan.html':'study','/learn.html':'bi-canh','/translate.html':'study','/review.html':'review','/fonts-preview.html':'fonts-preview'};
const targets=['/','/dao-lo.html','/library.html','/bi-canh.html','/worksheets.html','/arena.html','/history.html','/study.html'];
for(const [route,key] of Object.entries(routes)){
 const c=client(route,{existing:['/','/index.html','/bi-canh.html','/review.html'].includes(route)});
 assert.equal(c.document.querySelectorAll('.site-header').length,1,route);assert.equal(c.document.querySelectorAll('#site-menu').length,1);
 assert.equal(c.header.querySelector('.site-navigation'),null,'Only the compact gate should remain in the header');
 assert.deepEqual(c.menu.querySelectorAll('.site-menu-links a').map(a=>a.getAttribute('href')),targets);
 assert.equal(c.toggle.getAttribute('aria-expanded'),'false');assert.equal(c.toggle.getAttribute('aria-controls'),c.menu.id);assert.equal(c.toggle.getAttribute('aria-haspopup'),'dialog');
 c.toggle.fire('click');assert(c.menu.open&&c.menu.modal);assert.equal(c.toggle.getAttribute('aria-expanded'),'true');assert(c.root.classList.contains('site-menu-open'));
 const active=c.menu.querySelector('a[aria-current="page"]');assert(active,route);assert.equal(c.document.activeElement,active);
 const target=key==='review'?'/review.html':key==='fonts-preview'?'/fonts-preview.html':key==='home'?'/':key==='library'?'/library.html':key==='bi-canh'?'/bi-canh.html':key==='worksheets'?'/worksheets.html':key==='arena'?'/arena.html':key==='history'?'/history.html':key==='study'?'/study.html':'/dao-lo.html';
 assert.equal(active.getAttribute('href'),target,route);
 c.menu.cancel();assert(!c.menu.open);assert.equal(c.toggle.getAttribute('aria-expanded'),'false');assert(!c.root.classList.contains('site-menu-open'));assert.equal(c.document.activeElement,c.toggle);
 c.toggle.fire('click');c.menu.fire('click',{target:c.menu,clientX:40,clientY:60});assert(c.menu.open,'Clicking dialog padding must not close it');
 c.menu.fire('click',{target:c.menu,clientX:0,clientY:0});assert(!c.menu.open,'Backdrop click should close');
 c.toggle.fire('click');c.menu.querySelector('.site-menu-close').fire('click');assert(!c.menu.open);
 c.toggle.fire('click');c.menu.fire('click',{target:c.menu.querySelector('.site-menu-links a')});assert(!c.menu.open,'Following a route closes and unlocks the menu');
 vm.runInContext(source,c.context);assert.equal(c.document.querySelectorAll('#site-menu').length,1,'Repeated loading must not duplicate the gate');
}
const c=client('/worksheets.html');c.toggle.fire('click');
const font=c.menu.querySelector('[data-site-font]'),theme=c.menu.querySelector('[data-site-theme]');font.value='philosopher';font.onchange({target:font});theme.value='light';theme.onchange({target:theme});
assert(c.menu.open,'Changing appearance must keep the menu open');assert.equal(c.root.dataset.font,'philosopher');assert.equal(c.root.dataset.theme,'light');assert.equal(c.storage.get('thc-font'),'philosopher');assert.equal(c.storage.get('thc-theme'),'light');
const reopened=client('/arena.html',{seed:Object.fromEntries(c.storage)});assert.equal(reopened.menu.querySelector('[data-site-font]').value,'philosopher');assert.equal(reopened.menu.querySelector('[data-site-theme]').value,'light');
const unavailable=client('/library.html',{blocked:true});const select=unavailable.menu.querySelector('[data-site-font]');select.value='charm';select.onchange({target:select});assert(unavailable.menu.querySelector('[data-appearance-status]').textContent.includes('không cho lưu'));
for(const filename of fs.readdirSync(directory).filter(name=>name.endsWith('.html')&&name!=='offline-reader.html')){const html=fs.readFileSync(path.join(directory,filename),'utf8');assert(html.includes('/tien-canh.css?v=bagua-menu-3'),filename);assert(html.includes('/tien-canh.js?v=bagua-menu-3'),filename)}
console.log('PASS: compact bagua navigation on all pages, route/active mapping, modal open/cancel/backdrop/close/link, focus restoration, no duplication and appearance persistence');
