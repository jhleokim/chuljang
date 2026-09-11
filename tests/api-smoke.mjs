import assert from 'node:assert/strict';
const base='http://localhost:5173';
const anonymous=await fetch(base+'/api/receipts');
assert.equal(anonymous.status,401,'anonymous records access');
const signIn=await fetch(base+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});
const cookies=signIn.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
assert.ok(cookies,'development sign-in cookie');
async function call(path,method='GET',body){const r=await fetch(base+path,{method,headers:{Cookie:cookies,...(body?{'Content-Type':'application/json',Origin:base}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;}
const suffix=crypto.randomUUID().slice(0,8);
const trip=await call('/api/trips','POST',{name:'자동검증 '+suffix,startDate:'2026-09-11',endDate:'2026-09-12'});
const candidate={source:'ktx',date:'2026-09-11',merchant:'테스트 서울 → 부산 '+suffix,amount:59800,reference:suffix,raw:'승차일 2026.09.11\n결제금액 59,800원'};
const first=await call('/api/receipts','POST',[candidate]);assert.equal(first.imported,1);
const duplicate=await call('/api/receipts','POST',[candidate]);assert.equal(duplicate.duplicates,1);assert.equal(duplicate.imported,0);
const missingRef={...candidate,reference:'',raw:'읽기 불명확 '+suffix};
assert.equal((await call('/api/receipts','POST',[missingRef,{...missingRef,amount:62800}])).imported,2,'corrected receipts remain distinct');
const records=await call('/api/receipts');const receipt=records.find(r=>r.reference===suffix);assert.ok(receipt);
await call('/api/receipts/'+receipt.id,'PATCH',{...receipt,tripId:trip.id,reviewed:true});
const reviewed=(await call('/api/receipts')).find(r=>r.id===receipt.id);assert.equal(reviewed.reviewed,1);assert.equal(reviewed.tripId,trip.id);
const denied=await fetch(base+'/api/receipts/'+receipt.id+'/attachment');assert.equal(denied.status,401);
const csrf=await fetch(base+'/api/trips',{method:'POST',headers:{Cookie:cookies,'Content-Type':'application/json',Origin:'https://attacker.invalid'},body:JSON.stringify({name:'bad',startDate:'2026-09-11',endDate:'2026-09-12'})});assert.equal(csrf.status,403);
const invalid=await fetch(base+'/api/receipts',{method:'POST',headers:{Cookie:cookies,'Content-Type':'application/json',Origin:base},body:JSON.stringify([{...candidate,amount:-10}])});assert.equal(invalid.status,400);
console.log('API smoke passed: sign-in, owner isolation, trip create, receipt import, retry deduplication, corrected fields, review update, anonymous attachment rejection, CSRF, validation.');


const wrongScope=await fetch(base+'/api/receipts',{method:'POST',headers:{Cookie:cookies,'Content-Type':'application/json',Origin:base},body:JSON.stringify([{...candidate,requestedDates:['2026-09-09']}])});assert.equal(wrongScope.status,400,'per-row travel scope rejects gap days');
const scopedBody=new FormData();scopedBody.set('receipts',JSON.stringify([candidate]));scopedBody.set('requestedDates',JSON.stringify(['2026-09-09']));
const wrongBatch=await fetch(base+'/api/receipts',{method:'POST',headers:{Cookie:cookies,Origin:base},body:scopedBody});assert.equal(wrongBatch.status,400,'multipart batch travel scope rejects gap days');
scopedBody.set('requestedDates',JSON.stringify(['2026-09-09','2026-09-11']));
const rightBatch=await fetch(base+'/api/receipts',{method:'POST',headers:{Cookie:cookies,Origin:base},body:scopedBody});assert.equal(rightBatch.status,200,'exact selected day accepted');
console.log('Selected-date API validation passed.');

assert.equal((await fetch(base+'/api/collection')).status,401,'collection requires sign-in');
const collector=await call('/api/collection');assert.equal(collector.configured,true);assert.equal(collector.connections.length,5);
assert.equal((await fetch(base+'/api/collection?skip=invalid',{headers:{Cookie:cookies}})).status,400);
const collectRequest={action:'start',providers:['korail'],requestedDates:[],consent:true,jobId:crypto.randomUUID()};
assert.equal((await fetch(base+'/api/collection',{method:'POST',headers:{Cookie:cookies,'Content-Type':'application/json',Origin:base},body:JSON.stringify(collectRequest)})).status,400,'empty date set rejected without starting browser');
assert.equal((await fetch(base+'/api/collection',{method:'POST',headers:{Cookie:cookies,'Content-Type':'application/json',Origin:'https://attacker.invalid'},body:JSON.stringify(collectRequest)})).status,403);
assert.equal((await fetch(base+'/api/collection',{method:'POST',headers:{Cookie:cookies,'Content-Type':'application/json'},body:JSON.stringify(collectRequest)})).status,403);
console.log('Collection API passed: authenticated server connection, date validation, skip validation, CSRF and missing Origin rejection.');
