import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import {consentVersion} from '../selfhost/consent.mjs';
const origin='https://chuljang.hanatrust.workers.dev',password=process.env.CHULJANG_TEST_PASSWORD;
if(!password)throw new Error('Set CHULJANG_TEST_PASSWORD privately');
const request=(path,cookie='',options={})=>fetch(origin+path,{redirect:'manual',...options,headers:{Cookie:cookie,Origin:origin,...options.headers}});
const post=(path,cookie,form)=>request(path,cookie,{method:'POST',body:new URLSearchParams(form)});
const action=(cookie,values)=>request('/api/collection',cookie,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const users=[];let admin;
function connect(path,cookie){return new Promise((resolve,reject)=>{
 const ws=new WebSocket(origin.replace('https:','wss:')+path+'socket',{origin,headers:{Cookie:cookie}});
 const timer=setTimeout(()=>{ws.terminate();reject(new Error('Remote screen timeout'));},15000);
 ws.once('message',bytes=>{clearTimeout(timer);assert.match(bytes.toString(),/^RFB /);ws.close();resolve();});
 ws.once('error',error=>{clearTimeout(timer);reject(error);});
});}
try{
 const login=await post('/signin-with-chatgpt','',{username:'admin',password});assert.equal(login.status,303);admin=login.headers.get('set-cookie').split(';')[0];
 for(let i=0;i<2;i++){
  const invited=await post('/account',admin,{action:'invite',current:password});assert.equal(invited.status,200);
  const invite=(await invited.text()).match(/\/join#([a-f0-9]{64})/)[1],name='bridge-'+randomBytes(6).toString('hex'),memberPassword=randomBytes(24).toString('hex');
  const joined=await post('/join','',{invite,username:name,password:memberPassword,accepted:'yes',consent_version:consentVersion});assert.equal(joined.status,201);
  users.push({name,password:memberPassword,cookie:joined.headers.get('set-cookie').split(';')[0]});
 }
 const [a,b]=users;
 for(const provider of ['korail','hipass']){
  assert.equal((await action(a.cookie,{action:'start',providers:[provider],requestedDates:['2026-09-09'],consent:true,jobId:randomUUID()})).status,200);
  let state;
  for(let i=0;i<25;i++){
   const response=await request('/api/collection',a.cookie);assert.equal(response.status,200);
   state=(await response.json()).connections.find(row=>row.providerId===provider);
   if(state.loginUrl||state.state==='error')break;
   await pause(2000);
  }
  assert.ok(state.loginUrl,provider+' did not reach login: '+state.state+' '+state.note);
  assert.equal((await request(state.loginUrl,a.cookie)).status,200);
  assert.equal((await request(state.loginUrl,b.cookie)).status,410);
  assert.equal((await request(state.loginUrl)).status,401);
  assert.equal((await fetch('https://chuljang-jhleokim.asuscomm.com'+state.loginUrl,{redirect:'manual'})).status,403);
  await connect(state.loginUrl,a.cookie);
  assert.equal((await action(a.cookie,{action:'disconnect',providers:[provider]})).status,200);
  assert.equal((await request(state.loginUrl,a.cookie)).status,410);
  console.log(provider+': cloud → home login screen and WSS PASS; owner isolation and closed session PASS. No member login or receipt collection performed.');
 }
 assert.equal((await fetch('https://chuljang-jhleokim.asuscomm.com/collector',{method:'POST',body:'{}'})).status,403);
}finally{
 for(const user of users){const result=await post('/account',user.cookie,{action:'delete',current:user.password,confirm:user.name});assert.equal(result.status,200,'Synthetic account cleanup');}
 if(admin)await post('/account',admin,{action:'logout'});
}
