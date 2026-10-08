import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../static/daily-dao.js',import.meta.url),'utf8');
const {chapterNumber,nextDayDelay,validateChapters,START_DATE}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const data=JSON.parse(await readFile(new URL('../static/dao-duc-kinh.json',import.meta.url),'utf8'));
assert.equal(validateChapters(data),data);
assert.equal(START_DATE,data.start_date);
assert.equal(new Set(data.chapters.map(c=>c.han)).size,81);
for(const c of data.chapters){
 assert.match(c.han,/\p{Script=Han}/u);
 assert.doesNotMatch(c.han,/[a-zA-ZÀ-ỹ【】<>]/u,'Only the original Han text, without extraction markers or commentary');
}
assert.ok(data.chapters[0].han.replace(/\s/g,'').startsWith('道可道非常道.名可名非常名.'));
assert.ok(data.chapters[80].han.replace(/\s/g,'').endsWith('聖人之道為而不爭.'));
// The chapter changes at Vietnamese midnight, even while the UTC date is unchanged.
assert.equal(chapterNumber(new Date('2026-10-08T16:59:59.999Z')),81);
assert.equal(chapterNumber(new Date('2026-10-08T17:00:00.000Z')),1);
assert.equal(chapterNumber(new Date('2026-10-09T16:59:59.999Z')),1);
assert.equal(chapterNumber(new Date('2026-10-09T17:00:00.000Z')),2);
// All 81 chapters appear once per cycle, with no random reset after reload.
const start=Date.parse('2026-10-09T05:00:00Z');
for(let day=0;day<162;day++){
 const now=new Date(start+day*86400000);
 assert.equal(chapterNumber(now),day%81+1);
 assert.equal(chapterNumber(new Date(now.toISOString())),chapterNumber(now));
}
assert.equal(nextDayDelay(new Date('2026-10-09T16:59:59.000Z')),1000);
assert.equal(nextDayDelay(new Date('2026-10-09T17:00:00.000Z')),86400000);
assert.throws(()=>validateChapters({...data,chapters:data.chapters.slice(1)}));
assert.throws(()=>validateChapters({...data,chapters:data.chapters.map((c,i)=>i===0?{...c,chapter:2}:c)}));
assert.throws(()=>validateChapters({...data,start_date:'2026-01-01'}));
console.log('PASS: 81 Han chapters, Vietnam midnight, two complete cycles, stable reload and next-day timer');
