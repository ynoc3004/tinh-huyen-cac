const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const {createClassroomCountdown}=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../static/book-classroom.js')).toString('base64'));
 let time=0,id=0,last;const ticks=new Map();
 const timer=createClassroomCountdown({now:()=>time,schedule:fn=>{ticks.set(++id,fn);return id},cancel:id=>ticks.delete(id),onChange:s=>last=s});
 const advance=ms=>{time+=ms;for(const fn of [...ticks.values()])fn()};
 timer.reset(60);assert.equal(last.started,false);timer.toggle();advance(12500);assert.equal(last.remaining,48);
 timer.pause();assert.equal(ticks.size,0);advance(30000);assert.equal(timer.read().remaining,48);timer.toggle();advance(48000);assert.equal(last.remaining,0);assert.equal(last.running,false);assert.equal(ticks.size,0);
 timer.toggle();assert.equal(last.remaining,60,'Restart after expiration starts a new duration');timer.reset(120);assert.equal(last.remaining,120);assert.equal(last.started,false);assert.equal(ticks.size,0);
 timer.toggle();advance(500000);assert.equal(last.remaining,0,'A delayed/background callback uses the deadline');assert.equal(ticks.size,0);
 timer.reset(30);timer.toggle();timer.pause();timer.pause();assert.equal(ticks.size,0);assert.equal(last.remaining,30);
 console.log('PASS: classroom countdown deadline accuracy, throttling, pause/resume, expiry, reset and interval cleanup');
})().catch(e=>{console.error(e);process.exitCode=1});
