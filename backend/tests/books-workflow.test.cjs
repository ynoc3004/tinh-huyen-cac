const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'../static'),script=fs.readFileSync(path.join(root,'books.js'),'utf8');
const seed={id:'winning-chess-strategies',title:'Winning Chess Strategies',author:'Yasser Seirawan',subject:'Chiến lược',description:'Bản dịch theo chương',url:'https://winning-chess-strategies-viet.exactpony8.chatgpt.site/#chapter-01'};
function client({reader=false,id=seed.id,book=seed}={}){
 const nodes=new Map(),requests=[],rows=new Map([[book.id,structuredClone(book)]]);let fail=false,accept=true;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',textContent:'',innerHTML:'',hidden:true,disabled:false,dataset:{},events:{},focus(){this.focused=true},showModal(){this.open=true},close(){this.open=false},querySelectorAll(){return[]},reportValidity:()=>true,addEventListener(k,f){this.events[k]=f}});return nodes.get(id)};
 const fetch=async(url,opt={})=>{
  const body=typeof opt.body==='string'?JSON.parse(opt.body):opt.body,method=opt.method||'GET';requests.push({url,method,body});
  if(fail)return{ok:false,json:async()=>({detail:'Không kết nối được tủ sách'})};
  let data,status=200;const id=decodeURIComponent(url.split('/').at(-1)),collection=url==='/api/books';
  if(url==='/api/books/import'){data={...seed,offline:1,stats:{chapters:12,pages:253,figures:131}};rows.set(seed.id,data)}
  else if(method==='GET'){data=collection?[...rows.values()]:rows.get(id);if(!data){status=404;data={detail:'Không tìm thấy sách trong tủ.'}}}
  else if(method==='POST'){data={id:'new-book',...body};rows.set(data.id,data)}
  else if(method==='PUT'){data={id,...body};rows.set(id,data)}
  else if(method==='DELETE'){rows.delete(id);data={deleted_id:id}}
  return{ok:status<400,json:async()=>structuredClone(data)};
 };
 const document={body:{dataset:{booksView:reader?'reader':'catalog'}},getElementById:node,title:''};
 const ctx={document,fetch,URL,URLSearchParams,location:{search:id?'?id='+encodeURIComponent(id):''},confirm:()=>accept};
 vm.runInNewContext(script,ctx);
 return{node,document,requests,rows,fail:v=>fail=v,confirm:v=>accept=v};
}
async function flush(){for(let i=0;i<35;i++)await Promise.resolve()}
const eventFor=(selector,button)=>({target:{closest:s=>s===selector?button:null}});
const submit=async c=>{await c.node('book-form').onsubmit({preventDefault(){}});await flush()};
(async()=>{
 const c=client();await flush();assert(c.node('books-grid').innerHTML.includes('Winning Chess Strategies'));assert(c.node('books-grid').innerHTML.includes('/book.html?id=winning-chess-strategies'));
 c.node('book-search').value='CHIEN LUOC';c.node('book-search').oninput();assert(c.node('books-count').textContent.startsWith('1 /'));
 c.node('book-search').value='khong tim thay';c.node('book-search').oninput();assert(c.node('books-grid').innerHTML.includes('Chưa tìm thấy'));
 c.node('book-search').value='';c.node('book-subject').value='Tàn cuộc';c.node('book-subject').onchange();assert(c.node('books-count').textContent.startsWith('0 /'));
 c.node('book-add').onclick();assert(c.node('book-dialog').open);assert(c.node('book-title').focused);
 for(const [id,value] of Object.entries({'book-title':'<img src=x onerror=alert(1)>','book-author':'Tác giả B','book-topic':'Tàn cuộc','book-url':'javascript:alert(1)','book-description':'Tập luyện'}))c.node(id).value=value;
 await submit(c);assert(c.node('book-form-status').textContent.includes('HTTPS'));assert.equal(c.requests.filter(r=>r.method==='POST').length,0);
 c.node('book-url').value='https://books.example.org/#chapter-02';c.fail(true);await submit(c);assert.equal(c.node('book-form-status').textContent,'Không kết nối được tủ sách');assert(c.node('book-dialog').open);assert.equal(c.node('book-add').disabled,false);
 c.fail(false);await submit(c);assert(!c.node('book-dialog').open);assert.equal(c.requests.at(-1).method,'POST');assert.equal(c.requests.at(-1).body.subject,'Tàn cuộc');assert.equal(c.rows.size,2);
 assert(c.node('books-grid').innerHTML.includes('&lt;img'));assert(!c.node('books-grid').innerHTML.includes('<img src=x'));assert(c.node('book-subject').innerHTML.includes('Tàn cuộc'));
 await c.node('books-grid').onclick(eventFor('[data-book-edit]',{dataset:{bookEdit:'new-book'}}));assert.equal(c.node('book-title').value,'<img src=x onerror=alert(1)>');
 c.node('book-title').value='Sách sửa tên';await submit(c);assert.equal(c.requests.at(-1).method,'PUT');assert.equal(c.rows.get('new-book').title,'Sách sửa tên');
 const remove=eventFor('[data-book-delete]',{dataset:{bookDelete:'new-book'}});c.confirm(false);await c.node('books-grid').onclick(remove);assert(c.rows.has('new-book'));
 c.confirm(true);c.fail(true);await c.node('books-grid').onclick(remove);assert(c.rows.has('new-book'));assert.equal(c.node('books-status').textContent,'Không kết nối được tủ sách');
 c.fail(false);await c.node('books-grid').onclick(remove);assert(!c.rows.has('new-book'));assert(c.rows.has(seed.id));assert(!c.node('book-subject').innerHTML.includes('Tàn cuộc'));
 c.fail(true);await c.node('books-retry').onclick();assert.equal(c.node('books-retry').hidden,false);c.fail(false);await c.node('books-retry').onclick();assert.equal(c.node('books-retry').hidden,true);
 const r=client({reader:true});await flush();assert.equal(r.node('book-frame').src,seed.url);assert.equal(r.node('reader-external').href,seed.url);assert.equal(r.node('reader-external').hidden,false);assert.equal(r.node('reader-content').hidden,false);assert.equal(r.node('reader-title').textContent,seed.title);
 const missing=client({reader:true,id:''});await flush();assert(missing.node('books-status').textContent.includes('Chưa chọn sách'));assert.equal(missing.node('reader-external').hidden,true);assert.equal(missing.node('book-frame').src,undefined);
 const bad=client({reader:true,book:{...seed,url:'javascript:alert(1)'}});await flush();assert(bad.node('books-status').textContent.includes('HTTPS'));assert.equal(bad.node('book-frame').src,undefined);
 const absent=client({reader:true,id:'deleted'});await flush();assert(absent.node('books-status').textContent.includes('Không tìm thấy sách'));
 const offline=client({reader:true,book:{...seed,offline:1}});await flush();assert.equal(offline.node('book-frame').src,'/offline-reader.html?id='+seed.id);assert.equal(offline.node('reader-external').href,offline.node('book-frame').src);assert(offline.node('reader-help').textContent.includes('không có Internet'));
 c.node('book-package').files=[{size:65*1024*1024}];await c.node('book-package').onchange();assert(c.node('books-status').textContent.includes('64 MB'));assert(!c.requests.some(r=>r.url==='/api/books/import'));
 c.node('book-package').files=[{size:1000,name:'book.thcbook'}];c.fail(true);await c.node('book-package').onchange();assert.equal(c.node('books-status').textContent,'Không kết nối được tủ sách');assert.equal(c.node('book-import').disabled,false);
 c.fail(false);await c.node('book-package').onchange();assert(c.node('books-status').textContent.includes('12 chương'));assert(c.node('books-grid').innerHTML.includes('ĐỌC NGOẠI TUYẾN')||c.node('books-grid').innerHTML.includes('Đọc ngoại tuyến'));assert.equal(c.node('book-package').value,'');
 const html=fs.readFileSync(path.join(root,'book.html'),'utf8');assert(html.includes('referrerpolicy="no-referrer"'));assert(html.includes('sandbox="allow-scripts allow-same-origin'));assert(html.includes('rel="noopener noreferrer"'));assert(!html.includes('allow-top-navigation'));
 const shelf=fs.readFileSync(path.join(root,'study.html'),'utf8'),vault=fs.readFileSync(path.join(root,'library.html'),'utf8');
 assert(shelf.includes('data-books-view="catalog"'));assert(shelf.includes('href="/scan.html"'));assert(!vault.includes('online-study-entry'));assert(!vault.includes('href="/books.html"'));assert(!shelf.includes('id="reading-pane"'));assert(html.includes('href="/study.html"'));

 console.log('PASS: online catalog search/filter/add/edit/remove/cancel/retry, escaped metadata, reader URL validation, missing book and external fallback');
})().catch(error=>{console.error(error);process.exitCode=1});
