const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.join(__dirname,'../static');
(async()=>{
 const utils=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(root,'opponent-utils.js')).toString('base64'));
 assert.equal(utils.percent(null),'Chưa đủ dữ liệu');assert.equal(utils.percent(50),'50%');
 assert.equal(utils.moveLine(['e4','e5','Nf3','Nc6']),'1. e4 e5 2. Nf3 Nc6');
 assert.equal(utils.colorName('black'),'Đen');
 assert.equal(utils.esc('<img src=x onerror="bad">'),'&#60;img src=x onerror=&#34;bad&#34;&#62;');
 for(const url of ['javascript:alert(1)','https://lichess.org.attacker.example/a','https://user:pass@lichess.org/a','http://lichess.org/a'])assert.equal(utils.sourceLink(url),'');
 assert.equal(utils.sourceLink('https://lichess.org/abcdefgh'),'https://lichess.org/abcdefgh');
 const source=fs.readFileSync(path.join(root,'opponents.js'),'utf8'),html=fs.readFileSync(path.join(root,'opponents.html'),'utf8');
 for(const m of source.matchAll(/\$\('([^']+)'\)/g))assert(html.includes('id="'+m[1]+'"'),m[1]+' must exist in the real page');
 assert(source.includes('data-game'));assert(source.includes('recalculate'));assert(source.includes('gameToken'));
 assert(fs.readFileSync(path.join(root,'tien-canh.js'),'utf8').includes('/opponents.html'));
 const {Chess}=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(root,'vendor/chess.js')).toString('base64'));
 const inputs=[
  '[White "Target"]\n[Black "Other"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 1-0',
  '[White "Target"]\n[Black "Other"]\n[Result "0-1"]\n\n1. e4 a6 2. e5 d5 3. exd6 exd6 4. Nf3 Nf6 0-1'
 ];
 for(const pgn of inputs){
  const c=new Chess();c.loadPgn(pgn);const moves=c.history({verbose:true});while(c.undo()){}const fens=[c.fen()];for(const m of moves){c.move(m);fens.push(c.fen());}
  const result=JSON.parse(cp.execFileSync('python3',['-c',`import json,sys,hashlib
sys.path.insert(0,'.')
from services.opponents import read_game,game_summary
pgn=sys.stdin.read();g=game_summary(read_game(pgn),{'pgn':pgn},'target','lichess')
print(json.dumps({'fens':g['fens'],'key':hashlib.sha256('\\\\n'.join(g['fens']).encode()).hexdigest()}))`],{cwd:path.join(__dirname,'..'),input:pgn,encoding:'utf8'}));
  assert.deepEqual(fens,result.fens,'Python replay and real browser chess library must match through castling/en passant');
  assert.equal(crypto.createHash('sha256').update(fens.join('\\n')).digest('hex'),result.key,'Saved engine snapshots must use the exact same position hash');
 }
 console.log('PASS: opponent controls, evidence/replay wiring, safe profile links and text, missing-data display, castling/en-passant replay and shared engine cache identity');
})().catch(e=>{console.error(e);process.exitCode=1});
