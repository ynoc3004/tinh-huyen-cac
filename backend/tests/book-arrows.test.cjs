const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const {arrowCenter,arrowSquareAt,arrowPath}=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../static/book-arrows.js')).toString('base64'));
 assert.deepEqual(arrowCenter('a1'),{x:.5,y:7.5});assert.deepEqual(arrowCenter('a1',true),{x:7.5,y:.5});assert.deepEqual(arrowCenter('h8'),{x:7.5,y:.5});assert.equal(arrowCenter('i9'),null);
 for(const flipped of [false,true])for(const width of [240,722,1000])for(const file of 'abcdefgh')for(const rank of '12345678'){
  const square=file+rank,c=arrowCenter(square,flipped),box={left:33,top:77,width,height:width};
  assert.equal(arrowSquareAt(box,box.left+c.x/8*width,box.top+c.y/8*width,flipped),square);
 }
 const box={left:20,top:30,width:800,height:800};assert.equal(arrowSquareAt(box,19,100),null);assert.equal(arrowSquareAt(box,820,100),null);assert.equal(arrowSquareAt(box,100,830),null);assert.equal(arrowSquareAt({...box,width:0},100,100),null);
 assert.equal(arrowPath('e2','e2'),'');assert.equal(arrowPath('invalid','e4'),'');
 for(const [from,to] of [['a1','h8'],['a8','h1'],['h1','a1'],['e2','e4'],['e4','e2'],['g1','f3']])for(const flipped of [false,true]){const d=arrowPath(from,to,flipped);assert(d.startsWith('M'));assert(d.endsWith('Z'));assert(!/NaN|Infinity/.test(d));}
 console.log('PASS: arrow geometry on every square, flipped/resized boards, bounds and finite arrowheads');
})().catch(e=>{console.error(e);process.exitCode=1});
