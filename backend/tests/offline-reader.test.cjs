const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const directory=path.join(__dirname,'../static'),source=fs.readFileSync(path.join(directory,'offline-reader.js'),'utf8'),html=fs.readFileSync(path.join(directory,'offline-reader.html'),'utf8');
const core=source.slice(0,source.indexOf("$('#home-button').addEventListener"))+source.slice(source.indexOf('async function bootOffline(){'),source.lastIndexOf('bootOffline().catch'));
function client(storage=new Map(),exercises=0){
 class E{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.events={};this.attrs={};this.style={setProperty(){}};this.className='';this.value='';this.complete=true;this._text='';this.classList={add:n=>this.className+=' '+n,remove:n=>this.className=this.className.split(' ').filter(x=>x!==n).join(' '),toggle:(n,on)=>{const has=this.className.split(' ').includes(n);on=on??!has;if(on&&!has)this.className+=' '+n;else if(!on)this.className=this.className.split(' ').filter(x=>x!==n).join(' ');return on}}}
  set textContent(value){this._text=String(value);this.children=[]}get textContent(){return this._text+this.children.map(c=>c.textContent).join('')}
  append(...children){for(const child of children){child.parent=this;this.children.push(child)}}replaceChildren(...children){this._text='';this.children=[];this.append(...children)}
  setAttribute(k,v){this.attrs[k]=String(v)}getAttribute(k){return this.attrs[k]}
  addEventListener(k,f){(this.events[k]??=[]).push(f)}fire(k){for(const f of this.events[k]||[])f({target:this})}
  focus(){}scrollIntoView(){}showModal(){this.open=true}close(){this.open=false}getBoundingClientRect(){return{top:0,bottom:500}}
  matches(s){if(s.startsWith('#'))return this.id===s.slice(1);if(s.startsWith('.'))return this.className.split(' ').includes(s.slice(1));const data=s.match(/^\[data-bookmark="(\d+)"\]$/);if(data)return String(this.dataset.bookmark)===data[1];return s.toUpperCase()===this.tagName}
  querySelectorAll(s){const result=[];for(const child of this.children){if(child.matches(s))result.push(child);result.push(...child.querySelectorAll(s))}return result}querySelector(s){return this.querySelectorAll(s)[0]||null}
 }
 const body=new E('body'),head=new E('head'),root=new E('html');root.append(head,body);
 for(const match of html.matchAll(/id="([^"]+)"/g)){const node=new E();node.id=match[1];body.append(node)}
 const document={body,head,documentElement:root,title:'',querySelector:s=>root.querySelector(s),querySelectorAll:s=>root.querySelectorAll(s),createElement:tag=>new E(tag),createTextNode:text=>{const n=new E('text');n.textContent=text;return n}};
 const meta={exercises,id:'sample',title:'Sách của tôi',author:'Tác giả',start:'chapter-01',chapters:2,pages:2,assets:[],pdf:true,cover:'assets/cover.png'};
 const catalog=[{id:'chapter-01',title:'Kế hoạch',start:1,end:1,number:1},{id:'chapter-02',title:'Tàn cuộc',start:2,end:2,number:2}];
 const chapters={'chapter-01':{pages:[{page:1,blocks:[{type:'p',text:'Kế hoạch <script>alert(1)</script>'},{type:'figure',figureId:'f1',text:'Thế cờ'},{type:'moves',text:'1. e4 e5'}]}]},'chapter-02':{pages:[{page:2,blocks:[{type:'p',text:'Ôn tàn cuộc'}]}]}};
 const requests=[];let hash='';const location={search:'?id=sample',get hash(){return hash},set hash(v){hash=v.startsWith('#')?v:'#'+v}};
 const fetch=async url=>{assert(url.startsWith('/api/books/sample/'),'Reader must only request local book data');requests.push(url);let data;
  if(url.endsWith('/offline'))data=meta;else if(url.endsWith('catalog.json'))data=catalog;else if(url.endsWith('figures.json'))data={'1':[{id:'f1',src:'assets/f1.png'}]};else if(url.endsWith('page-labels.json'))data={'1':'1','2':'2'};else data=chapters[url.split('/').at(-1).replace('.json','')];
  return{ok:!!data,json:async()=>structuredClone(data)};
 };
 const ctx={document,location,fetch,URLSearchParams,URL,Blob,Date,console,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:f=>f(),window:{addEventListener(){},scrollTo(){},open(){},innerHeight:900,scrollY:0}};
 vm.createContext(ctx);vm.runInContext(core,ctx);return{ctx,document,storage,requests,run:code=>vm.runInContext(code,ctx)};
}
(async()=>{
 const c=client();await c.run('bootOffline()');assert.equal(c.document.querySelector('#reader-practice-link').hidden,true);
 const exerciseBook=client(new Map(),5334);await exerciseBook.run('bootOffline()');assert.equal(exerciseBook.document.querySelector('#reader-practice-link').hidden,false);assert.equal(exerciseBook.document.querySelector('#reader-practice-link').href,'/book-practice.html?id=sample');const main=c.document.querySelector('#main');assert(main.textContent.includes('Kế hoạch <script>alert(1)</script>'));assert.equal(main.querySelectorAll('script').length,0,'Book text must never become executable HTML');
 assert.equal(main.querySelector('img').src,'/api/books/sample/asset/assets/f1.png');assert.equal(c.document.title,'Kế hoạch · Sách của tôi');
 c.run("toggleBookmark('chapter-01',1)");assert(JSON.parse(c.storage.get('thc-offline-book-sample')).bookmarks.some(b=>b.id==='chapter-01'));
 const note=main.querySelector('#note-input');note.value='Ý tưởng cần ôn';note.fire('input');c.run('persist(true)');assert.equal(JSON.parse(c.storage.get('thc-offline-book-sample')).notes['chapter-01'],'Ý tưởng cần ôn');
 await c.run("search('TAN CUOC')");assert(c.document.querySelector('#search-results').textContent.includes('Tàn cuộc'));
 c.run("source(1)");assert.equal(c.document.querySelector('#source-frame').src,'/api/books/sample/asset/book.pdf#page=1&view=FitH');
 c.run("go('chapter-02')");await c.run('route()');c.run('persist(true)');assert(c.document.querySelector('#main').textContent.includes('Ôn tàn cuộc'));
 const next=client(c.storage);await next.run('bootOffline()');assert.equal(next.document.title,'Tàn cuộc · Sách của tôi','Reading position should survive reopening');
 assert(c.requests.every(url=>!url.includes('chatgpt.site')));assert.equal(c.run("assetURL('assets/fonts/a b.woff')"),'/api/books/sample/asset/assets/fonts/a%20b.woff');
 assert(!/https?:\/\//.test(source),'Reader code must not depend on a remote host');
 c.run("bookInfo.exercises=2;bookInfo.start='home';state.last=null;renderHome()");
 const home=c.document.querySelector('#main');const begin=home.querySelectorAll('button').find(b=>b.textContent.includes('Bắt đầu đọc sách'));assert(begin);begin.fire('click');assert.equal(c.ctx.location.hash,'#chapter-01','Home-based books must start at the first readable part');
 const practice=home.querySelectorAll('button').find(b=>b.textContent.includes('Vào luyện tập'));assert(practice);practice.fire('click');assert.equal(c.ctx.location.href,'/book-practice.html?id=sample');
 c.run("block({type:'test',text:'Bài 2',exerciseId:'2'},1).children[0].fire('click')");assert.equal(c.ctx.location.href,'/book-practice.html?id=sample&exercise=2');
 c.run("bookInfo.exercises=0");c.run("block({type:'test',text:'Bài 7',exerciseId:'7'},1).children[0].fire('click')");assert.equal(c.ctx.location.href,'/book-practice.html?id=sample&exercise=7','Legacy metadata cannot hide the exercise action');
 const original=c.run("figureBlock({type:'figure',figureId:'f1',text:'Trang gốc',original:true},1)");assert.equal(original.tagName,'DETAILS');assert(original.textContent.includes('nguyên ngữ'));
 console.log('PASS: native offline reader renders chapters/images as text, searches all chapters, saves notes/bookmarks/position per book and opens the local PDF without remote requests');
})().catch(error=>{console.error(error);process.exitCode=1});
