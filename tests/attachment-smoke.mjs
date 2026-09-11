import assert from 'node:assert/strict';
const base='http://localhost:5173';
const login=await fetch(base+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});
const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
const ref=crypto.randomUUID();
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6e2kAAAAASUVORK5CYII=','base64');
const form=new FormData();form.set('receipts',JSON.stringify([{source:'socar',date:'2026-09-11',merchant:'첨부 검증',amount:100,reference:ref,raw:'합성 테스트',attachmentIndex:0}]));form.append('files',new Blob([png],{type:'image/png'}),'synthetic.png');
const saved=await fetch(base+'/api/receipts',{method:'POST',headers:{Cookie:cookie,Origin:base},body:form});assert.equal(saved.status,200,await saved.text());
const all=await (await fetch(base+'/api/receipts',{headers:{Cookie:cookie}})).json();const record=all.find(r=>r.reference===ref);assert.equal(record.hasAttachment,1);
const detail=await fetch(base+'/api/receipts/'+record.id,{headers:{Cookie:cookie}});assert.equal((await detail.json()).raw,'합성 테스트');
const original=await fetch(base+'/api/receipts/'+record.id+'/attachment',{headers:{Cookie:cookie}});assert.equal(original.status,200);assert.equal(original.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await original.arrayBuffer()),png);
assert.equal((await fetch(base+'/api/receipts/'+record.id)).status,401);
console.log('Attachment smoke passed: multipart upload, R2 persistence, authenticated byte-for-byte download, detail isolation.');

