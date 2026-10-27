export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
export const colorName=color=>color==='white'?'Trắng':'Đen';
export const speedName=speed=>({all:'Tất cả',rapid:'Rapid',blitz:'Blitz',bullet:'Bullet',classical:'Classical',correspondence:'Daily / qua thư',unknown:'Chưa rõ'})[speed]||speed;
export const percent=value=>Number.isFinite(value)?value.toLocaleString('vi-VN',{maximumFractionDigits:1})+'%':'Chưa đủ dữ liệu';
export function moveLine(moves){return moves.map((move,i)=>(i%2===0?(i/2+1)+'. ':'')+move).join(' ');}
export function ratingDifference(row){return Number.isFinite(row.mean_rating_difference)?(row.mean_rating_difference>=0?'+':'')+row.mean_rating_difference+' ('+row.rating_pairs+' ván)':'Thiếu rating';}
export function sourceLink(value){
 try{const url=new URL(value);return url.protocol==='https:'&&['chess.com','www.chess.com','lichess.org'].includes(url.hostname)&&!url.username&&!url.password&&!url.port?url.href:'';}catch{return '';}
}
