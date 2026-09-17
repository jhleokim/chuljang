import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import {defaultReport} from '../lib/report.ts';
import {buildReportWorkbook} from '../lib/report-workbook.ts';
const origin=process.argv[2]||'http://127.0.0.1:8811',collect=process.argv.includes('--collector');
const request=(path,cookie='',options={})=>fetch(origin+path,{...options,redirect:'manual',headers:{Cookie:cookie,Origin:origin,...options.headers}});
const json=(path,cookie,method,data)=>request(path,cookie,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const users=[];
let sharePath;
try{
 assert.equal((await request('/api/receipts','',{headers:{'oai-authenticated-user-id':'home-owner'}})).status,401);
 for(let i=0;i<2;i++){
  const page=await request('/');assert.equal(page.status,200);const html=await page.text();assert.ok(html.includes('별도 가입 없이 테스트'));assert.ok(!html.includes('href="/account"'));assert.ok(!html.includes('계정과 보안'));
  users.push(page.headers.get('set-cookie').split(';')[0]);
 }
 const [a,b]=users;assert.notEqual(a,b);
 assert.equal((await request('/signin-with-chatgpt',a)).headers.get('location'),'/');
 const day='2026-09-09',rows=[{source:'transit',date:day,merchant:'SYNTHETIC 지하철',amount:1500,reference:'TEST-'+randomUUID(),raw:'이용일: '+day+'\n결제금액 1500원',sourceUrl:'',attachmentIndex:0}];
 const upload=new FormData();upload.set('receipts',JSON.stringify(rows));upload.append('files',new Blob(['%PDF synthetic'],{type:'application/pdf'}),'synthetic.pdf');
 assert.equal((await request('/api/receipts',a,{method:'POST',body:upload})).status,200);
 const receipts=await(await request('/api/receipts',a)).json();assert.equal(receipts.length,1);assert.deepEqual(await(await request('/api/receipts',b)).json(),[]);
 assert.equal((await request('/api/receipts/'+receipts[0].id+'/attachment',b)).status,404);
 assert.equal(await(await request('/api/receipts/'+receipts[0].id+'/attachment',a)).text(),'%PDF synthetic');
 const xlsx=await buildReportWorkbook(receipts,[],[day],defaultReport),settings=new FormData();settings.set('config',JSON.stringify({...defaultReport,sheet:'출장 정산서'}));settings.set('template',new Blob([xlsx]),'synthetic.xlsx');
 assert.equal((await request('/api/report-settings',a,{method:'POST',body:settings})).status,200);
 assert.equal((await request('/api/report-settings/template',a)).status,200);assert.equal((await request('/api/report-settings/template',b)).status,404);
 const shareForm=new FormData();shareForm.set('file',new Blob([new Uint8Array([80,75,3,4]),'synthetic share'],{type:'application/zip'}),'synthetic.zip');
 const shared=await request('/api/report-shares',a,{method:'POST',body:shareForm});assert.equal(shared.status,200);const share=await shared.json();sharePath=share.path;
 assert.ok(Date.parse(share.expiresAt)>Date.now()&&Date.parse(share.expiresAt)<=Date.now()+86400000,'Shared files expire with the test space');
 assert.equal((await request(share.path)).status,200);assert.deepEqual(await(await request('/api/report-shares',b)).json(),[]);
 assert.equal((await request('/api/test-session/end',b,{method:'POST',headers:{Origin:'https://evil.invalid'}})).status,403);
 console.log('PASS: no app login or password form; two isolated test spaces, PDF and report template round trip, forged identity and cross-origin rejection.');
 if(collect)for(const provider of ['korail','tmoneyTransit']){
  assert.equal((await json('/api/collection',a,'POST',{action:'start',providers:[provider],requestedDates:[day],consent:true,jobId:randomUUID()})).status,200);
  let state;
  for(let i=0;i<35;i++){const response=await request('/api/collection',a);assert.equal(response.status,200);state=(await response.json()).connections.find(row=>row.providerId===provider);if(state.loginUrl||state.state==='error')break;await new Promise(resolve=>setTimeout(resolve,2000));}
  assert.ok(state.loginUrl,provider+': '+state.state+' '+state.note);
  const remote=await request(state.loginUrl,a);assert.equal(remote.status,200);assert.ok((await remote.text()).includes('id="keyboard"'));
  assert.equal((await request(state.loginUrl,b)).status,410);
  await new Promise((resolve,reject)=>{const ws=new WebSocket(origin.replace('http','ws')+state.loginUrl+'socket',{origin,headers:{Cookie:a}});const timer=setTimeout(()=>{ws.terminate();reject(new Error('RFB timeout'));},15000);ws.once('error',error=>{clearTimeout(timer);reject(error);});ws.once('message',value=>{clearTimeout(timer);try{assert.match(value.toString(),/^RFB /);ws.close();resolve();}catch(error){ws.terminate();reject(error);}});});
  assert.equal((await json('/api/collection',a,'POST',{action:'disconnect',providers:[provider]})).status,200);
  console.log(provider+': official login readiness, mobile remote controls, isolated WSS PASS. Member receipt totals not tested.');
 }
}finally{
 for(const cookie of users){const response=await request('/api/test-session/end',cookie,{method:'POST'});assert.equal(response.status,200,'Test cleanup');assert.equal((await request('/api/receipts',cookie)).status,401);}
 if(sharePath)assert.equal((await request(sharePath)).status,404,'Ended test space revokes its shared file');
}
