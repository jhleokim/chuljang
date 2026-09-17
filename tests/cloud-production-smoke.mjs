import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
import {defaultReport} from '../lib/report.ts';
import {buildReportWorkbook} from '../lib/report-workbook.ts';
import {consentVersion} from '../selfhost/consent.mjs';
const origin=process.argv[2]||'http://127.0.0.1:8811',password=process.env.CHULJANG_TEST_PASSWORD;
if(!password)throw new Error('Set CHULJANG_TEST_PASSWORD privately');
const request=(path,cookie='',options={})=>fetch(origin+path,{redirect:'manual',...options,headers:{Cookie:cookie,Origin:origin,...options.headers}});
const post=(path,cookie,form)=>request(path,cookie,{method:'POST',body:new URLSearchParams(form)});
const json=(path,cookie,method,data)=>request(path,cookie,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const users=[];let admin;
try {
 assert.equal((await request('/api/receipts','',{headers:{'oai-authenticated-user-id':'home-owner','oai-authenticated-user-email':'admin@home.local'}})).status,401);
 const login=await post('/signin-with-chatgpt','',{username:'admin',password});assert.equal(login.status,303);admin=login.headers.get('set-cookie').split(';')[0];
 const original=await(await request('/api/receipts',admin)).json();
 for(let i=0;i<2;i++){
  const inviteResponse=await post('/account',admin,{action:'invite',current:password});assert.equal(inviteResponse.status,200);
  const invite=(await inviteResponse.text()).match(/\/join#([a-f0-9]{64})/)[1],name='test-'+randomBytes(6).toString('hex'),memberPassword=randomBytes(24).toString('hex');
  const form={invite,username:name,password:memberPassword,consent_version:consentVersion};
  assert.equal((await post('/join','',form)).status,400);
  const joined=await post('/join','',{...form,accepted:'yes'});assert.equal(joined.status,201);
  users.push({name,password:memberPassword,cookie:joined.headers.get('set-cookie').split(';')[0]});
 }
 const [a,b]=users;
 assert.deepEqual(await(await request('/api/receipts',a.cookie)).json(),[]);
 assert.equal((await post('/account',b.cookie,{action:'invite',current:b.password})).status,403);
 const day='2026-09-09';
 const trip=await json('/api/trips',a.cookie,'POST',{name:'SYNTHETIC cloud test',startDate:day,endDate:day});assert.equal(trip.status,201);
 const rows=[{source:'hipass',date:day,merchant:'SYNTHETIC 서울 → 수원',amount:2300,reference:'SYNTHETIC-'+randomBytes(8).toString('hex'),raw:'이용일: '+day+'\n결제금액: 2300원',sourceUrl:'',attachmentIndex:0}];
 const upload=new FormData();upload.set('receipts',JSON.stringify(rows));upload.append('files',new Blob(['%PDF synthetic private file'],{type:'application/pdf'}),'synthetic.pdf');
 const imported=await request('/api/receipts',a.cookie,{method:'POST',body:upload});assert.equal(imported.status,200,await imported.text());
 const receipts=await(await request('/api/receipts',a.cookie)).json();assert.equal(receipts.length,1);
 assert.deepEqual(await(await request('/api/receipts',b.cookie)).json(),[]);
 assert.equal((await request('/api/receipts/'+receipts[0].id,b.cookie)).status,404);
 assert.equal((await request('/api/receipts/'+receipts[0].id+'/attachment',b.cookie)).status,404);
 assert.equal(await(await request('/api/receipts/'+receipts[0].id+'/attachment',a.cookie)).text(),'%PDF synthetic private file');
 const template=await buildReportWorkbook(receipts,[],[day],defaultReport),settings=new FormData();settings.set('config',JSON.stringify({...defaultReport,sheet:'출장 정산서',recipient:'synthetic@example.com'}));settings.set('template',new Blob([template]),'synthetic.xlsx');
 assert.equal((await request('/api/report-settings',a.cookie,{method:'POST',body:settings})).status,200);
 assert.equal((await request('/api/report-settings/template',a.cookie)).status,200);
 assert.equal((await request('/api/report-settings/template',b.cookie)).status,404);
 assert.equal((await(await request('/api/report-settings',b.cookie)).json()).templateName,null);
 const zip=zipSync({'test.txt':strToU8('SYNTHETIC only')}),shareForm=new FormData();shareForm.set('file',new Blob([zip]),'synthetic.zip');
 const shared=await request('/api/report-shares',a.cookie,{method:'POST',body:shareForm});assert.equal(shared.status,200);const share=await shared.json();
 assert.deepEqual(new Uint8Array(await(await request(share.path)).arrayBuffer()),zip);
 assert.deepEqual(await(await request('/api/report-shares',b.cookie)).json(),[]);
 await json('/api/report-shares',b.cookie,'DELETE',{id:share.id});assert.equal((await request(share.path)).status,200);
 const removed=await post('/account',a.cookie,{action:'delete',current:a.password,confirm:a.name});assert.equal(removed.status,200);a.deleted=true;
 assert.equal((await request('/api/receipts',a.cookie)).status,401);assert.equal((await request(share.path)).status,404);
 assert.deepEqual(await(await request('/api/receipts',admin)).json(),original);
 assert.equal((await request('/api/trips',b.cookie,{method:'POST',headers:{Origin:'https://evil.invalid'}})).status,403);
 console.log('Cloud application PASS: consent, invitations, personal accounts, receipt/trip/template/file/share isolation, encrypted file round trip, self deletion, owner data preserved.');
}finally{
 for(const user of users)if(!user.deleted){const removed=await post('/account',user.cookie,{action:'delete',current:user.password,confirm:user.name});assert.equal(removed.status,200,'Synthetic cleanup');}
 if(admin)await post('/account',admin,{action:'logout'});
}
