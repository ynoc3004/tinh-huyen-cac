import {env} from 'cloudflare:workers';
import {runOperation} from '../../../lib/tournament/store.mjs';
import {HttpError} from '../../../lib/tournament/engine.mjs';
export const dynamic='force-dynamic';
async function handle(req:Request){
 const url=new URL(req.url),path=url.pathname.slice(4),owner=req.headers.get('oai-authenticated-user-id');
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(!owner)return Response.json({detail:'Đăng nhập ChatGPT để mở dữ liệu riêng tư.'},{status:401,headers});
 if(!['GET','HEAD'].includes(req.method)&&req.headers.get('origin')&&req.headers.get('origin')!==url.origin)return Response.json({detail:'Nguồn yêu cầu không hợp lệ.'},{status:403,headers});
 try{
  if(!env.DB)throw new HttpError(503,'Lưu trữ chưa sẵn sàng');
  let body={};if(!['GET','HEAD'].includes(req.method)){if(Number(req.headers.get('content-length')||0)>2000000)throw new HttpError(413,'Yêu cầu quá lớn');const raw=await req.text();if(raw.length>2000000)throw new HttpError(413,'Yêu cầu quá lớn');if(raw)try{body=JSON.parse(raw);}catch{throw new HttpError(400,'Dữ liệu JSON không hợp lệ');}}
  if(body===null||typeof body!=='object')throw new HttpError(400,'Dữ liệu phải là đối tượng hoặc danh sách JSON.');
  const data=await runOperation(env.DB,owner,path,req.method,body,url.searchParams);
  if(url.searchParams.get('download')==='true'||path.endsWith('/export'))return new Response(JSON.stringify(data,null,2),{headers:{...headers,'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="tinh-huyen-cac-${path.includes('export')?'backup':'audit'}-${path.match(/\d+/)?.[0]||'data'}.json"`}});
  return Response.json(data,{headers});
 }catch(e:any){return Response.json({detail:e instanceof HttpError?e.message:'Không thể lưu dữ liệu. Tải lại và thử lại.'},{status:e instanceof HttpError?e.status:500,headers});}
}
export {handle as GET,handle as POST,handle as PUT,handle as PATCH,handle as DELETE};
