const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'../static');
(async()=>{
 const {Chess}=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(root,'vendor/chess.js')).toString('base64'));
 const ctx=vm.createContext({Chess});vm.runInContext(fs.readFileSync(path.join(root,'book-exercise-session.js'),'utf8').replace(/^import .*;\n/gm,'').replace('export class','class'),ctx);
 const make=item=>{ctx.item=item;return vm.runInContext('new ExerciseSession(item)',ctx)};
 const leaf=move=>({move,next:[]}),line={id:'line',kind:'line',status:'verified',fen:new Chess().fen(),tree:[{move:'e2e4',next:[{move:'e7e5',next:[leaf('g1f3')]},{move:'c7c5',next:[leaf('g1f3')]}]},{move:'d2d4',next:[leaf('d7d5')]}]};
 let s=make(line);const initial=s.chess.fen();assert.equal(s.play('e2','e5').kind,'illegal');assert.equal(s.chess.fen(),initial);assert.equal(s.play('a2','a3').kind,'different');assert.equal(s.chess.fen(),initial,'Other legal moves should be reversible, not declared losing');assert(s.hint(1).includes('e2'));assert(s.hint(2).includes('e4'));assert.equal(s.chess.fen(),initial,'Hints must not move pieces');
 let result=s.play('e2','e4');assert.equal(result.kind,'correct');assert.equal(result.reply,'e5');assert.equal(s.chess.turn(),'w');assert.equal(s.play('g1','f3').kind,'complete');assert.equal(s.play('a2','a3').kind,'finished');assert.equal(s.solution().length,3);s.showSolution(1);assert.equal(s.chess.get('e4').type,'p');assert.equal(s.free,true);
 s=make(line);assert.equal(s.play('d2','d4').kind,'complete','Alternative root supplied in book must be accepted');
 s=make({...line,kind:'mate1',fen:'7k/8/5KQ1/8/8/8/8/8 w - - 0 1',tree:[leaf('g6g7')]});assert.equal(s.play('g6','g5').kind,'not-mate');assert.equal(s.play('g6','g7').kind,'complete');
 s=make({...line,fen:'k7/6P1/8/8/8/8/8/7K w - - 0 1',tree:[leaf('g7g8n')]});assert.equal(s.play('g7','g8','q').kind,'different');assert.equal(s.play('g7','g8','n').kind,'complete');assert.equal(s.chess.get('g8').type,'n');
 s=make({...line,fen:'4k3/8/8/8/8/8/8/4K2R w K - 0 1',tree:[leaf('e1g1')]});assert.equal(s.play('e1','g1').kind,'complete');assert.equal(s.chess.get('f1').type,'r');
 s=make({...line,fen:'7k/8/8/Pp6/8/8/8/7K w - b6 0 1',tree:[leaf('a5b6')]});assert.equal(s.play('a5','b6').kind,'complete');assert.equal(s.chess.get('b5'),undefined);
 s=make({...line,status:'review',tree:[]});assert.equal(s.free,true);assert.equal(s.play('a2','a3').kind,'free');assert.equal(s.finished,false);
 console.log('PASS: book lines, alternatives, automatic replies, hint isolation, no false evaluation of other lines, mate, promotion, castling, en passant and ungraded review mode');
})().catch(e=>{console.error(e);process.exitCode=1});
