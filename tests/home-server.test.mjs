import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HomeStorage } from '../selfhost/storage.mjs';
import { HomeAuth, hashPassword, safeReturn } from '../selfhost/auth.mjs';
import { publicIPv4, publicAddress } from '../selfhost/egress.mjs';
import { createHomeServer } from '../selfhost/server.mjs';
import { HomeCollector } from '../selfhost/collector.ts';
import { serviceLoginState } from '../server-collector/history-dom.ts';
import { runInNewContext } from 'node:vm';

async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'chuljang-home-test-')),storage=new HomeStorage(directory);
 t.after(async()=>{storage.close();await rm(directory,{recursive:true,force:true});});return {directory,storage};
}
async function until(check){const end=Date.now()+5000;while(Date.now()<end){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Test timed out');}
const start=(providers=['korail'],requestedDates=['2026-09-09'])=>({action:'start',providers,requestedDates,consent:true,jobId:randomUUID()});
const secret='a'.repeat(96);
test('login detection can execute in the remote page without build-time helper closures',()=>{
 const document={querySelectorAll:selector=>selector==='a,button'?[{getClientRects:()=>[{}],textContent:'로그아웃'}]:[],querySelector:()=>null};
 assert.equal(runInNewContext('('+serviceLoginState.toString()+')("korail")',{document}),true);
});

test('home SQLite batches roll back together, persist and isolate owner rows',async t=>{
 const {directory,storage}=await fixture(t);
 await storage.prepare('INSERT INTO trips VALUES (?,?,?,?,?)').bind('a','owner-a','one','2026-09-09','2026-09-09').run();
 await assert.rejects(storage.batch([
  storage.prepare('INSERT INTO trips VALUES (?,?,?,?,?)').bind('b','owner-b','two','2026-09-09','2026-09-09'),
  storage.prepare('INSERT INTO trips VALUES (?,?,?,?,?)').bind('a','owner-b','duplicate','2026-09-09','2026-09-09'),
 ]));
 assert.equal((await storage.prepare('SELECT * FROM trips WHERE user_id=?').bind('owner-b').all()).results.length,0);
 const reopened=new HomeStorage(directory);assert.equal((await reopened.prepare('SELECT * FROM trips').all()).results.length,1);reopened.close();
});
test('home attachments persist and reject filesystem traversal',async t=>{
 const {storage}=await fixture(t),bucket=storage.bucket(),key='receipts/'+randomUUID();
 await bucket.put(key,new Blob(['%PDF synthetic']).stream());assert.equal(new TextDecoder().decode((await bucket.get(key)).body),'%PDF synthetic');
 await assert.rejects(bucket.get('../../.ssh/id_rsa'));await bucket.delete(key);assert.equal(await bucket.get(key),null);
});
test('home login verifies password, expires/revokes sessions and rate limits persistent attempts',async t=>{
 const {storage}=await fixture(t),hash=await hashPassword('test-password'),auth=new HomeAuth(storage,'https://receipts.example.com',hash);
 assert.equal((await auth.login('wrong')).status,401);
 const result=await auth.login('test-password');assert.equal(result.status,200);assert.match(result.cookie,/HttpOnly; SameSite=Strict.*Secure/);
 assert.equal(auth.user(result.cookie),'home-owner');assert.equal(auth.user(result.cookie.replace(/session=./,'session=z')),null);
 assert.equal(new HomeAuth(storage,auth.origin,await hashPassword('changed')).user(result.cookie),null);
 auth.logout(result.cookie);assert.equal(auth.user(result.cookie),null);
 for(let i=0;i<8;i++)await auth.login('wrong');assert.equal((await auth.login('test-password')).status,429);
});
test('home return path cannot redirect to another origin or an auth loop',()=>{
 for(const url of ['//evil.test','https://evil.test','/\\evil.test','/signin-with-chatgpt','/signout-with-chatgpt'])assert.equal(safeReturn(url),'/');
 assert.equal(safeReturn('/service-login?provider=korail'),'/service-login?provider=korail');
});
test('browser egress blocks LAN, loopback, metadata, reserved and mixed DNS answers',async()=>{
 for(const ip of ['127.0.0.1','192.168.50.61','10.0.0.1','169.254.169.254','172.16.0.1','100.64.0.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicIPv4(ip),false,ip);
 assert.equal(publicIPv4('1.1.1.1'),true);
 await assert.rejects(publicAddress('example.com',async()=>[{address:'1.1.1.1'},{address:'127.0.0.1'}]));
 assert.equal(await publicAddress('example.com',async()=>[{address:'1.1.1.1'}]),'1.1.1.1');
});
test('home HTTP rejects forged identity, cross-origin login and unauthenticated remote access',async t=>{
 const {storage}=await fixture(t),auth=new HomeAuth(storage,'http://127.0.0.1',await hashPassword('test-password'));
 const web=await createHomeServer({auth,collector:{sessions:new Map()},handle:(req,res)=>{res.end(JSON.stringify({owner:req.headers['oai-authenticated-user-id']||null,proto:req.headers['x-forwarded-proto']}));}});
 await new Promise(resolve=>web.server.listen(0,'127.0.0.1',resolve));t.after(()=>web.close());auth.origin='http://127.0.0.1:'+web.server.address().port;
 const forged={'oai-authenticated-user-id':'victim','oai-authenticated-user-email':'victim@example.com','x-forwarded-proto':'https','x-middleware-subrequest':'middleware'};
 assert.equal((await fetch(auth.origin+'/api/receipts',{headers:forged})).status,401);
 assert.deepEqual(await (await fetch(auth.origin,{headers:forged})).json(),{owner:null,proto:'http'});
 assert.equal((await fetch(auth.origin+'/signin-with-chatgpt',{method:'POST',headers:{Origin:'https://evil.test'},body:'password=test-password'})).status,403);
 assert.equal((await fetch(auth.origin+'/remote-assets/core/rfb.js')).status,401);
 const response=await fetch(auth.origin+'/signin-with-chatgpt',{method:'POST',headers:{Origin:auth.origin},body:'password=test-password',redirect:'manual'});
 assert.equal(response.status,303);const cookie=response.headers.get('set-cookie');
 assert.deepEqual(await (await fetch(auth.origin+'/api/receipts',{headers:{...forged,Cookie:cookie}})).json(),{owner:'home-owner',proto:'http'});
 assert.equal((await fetch(auth.origin+'/remote/'+'f'.repeat(48)+'/',{headers:{Cookie:cookie}})).status,410);
});
function fakeBrowser(verified=()=>true){
 let url='';return {port:5999,close:async()=>{},page:{url:()=>url,goto:async value=>{url=value;},evaluate:async fn=>fn.name==='serviceLoginState'?verified():{inputs:[]}},context:{storageState:async()=>({cookies:[{name:'synthetic',value:'private-session'}],origins:[]})}};
}
test('home collection checkpoints exact non-contiguous dates and stores encrypted captures across restart',async t=>{
 const {storage,directory}=await fixture(t),days=['2026-09-09','2026-09-11'],queried=[];
 const collector=new HomeCollector(storage,secret,'owner',async()=>fakeBrowser(),async(page,day)=>{queried.push(day);return {blocks:['승차일 '+day+'\n결제금액 59,800원'],completed:true};});t.after(()=>collector.close());
 await collector.request('owner',start(['korail'],days));
 const result=await until(async()=>{const status=await collector.request('owner',{action:'status'});return status.connections.find(row=>row.providerId==='korail').state==='complete'&&status;});
 assert.deepEqual(queried,days);assert.equal(result.captures.length,1);assert.deepEqual(result.captures[0].packet.requestedDates,days);
 const values=storage.sql.prepare('SELECT value FROM home_state').all().map(row=>row.value).join('\n');assert.ok(!values.includes('private-session'));assert.ok(!values.includes('59,800'));
 const reopened=new HomeStorage(directory),next=new HomeCollector(reopened,secret,'owner',async()=>fakeBrowser());
 const again=await next.request('owner',{action:'status'});assert.equal(again.captures[0].captureId,result.captures[0].captureId);
 await next.request('owner',{action:'ack',provider:'korail',captureId:again.captures[0].captureId});assert.equal((await next.request('owner',{action:'status'})).captures.length,1);
 await assert.rejects(next.request('another-owner',{action:'status'}));await next.close();reopened.close();
});
test('disconnect revokes login windows and a late browser result cannot restore the session',async t=>{
 const {storage}=await fixture(t);let release;const launch=new Promise(resolve=>{release=resolve;});let closed=0;
 const collector=new HomeCollector(storage,secret,'owner',()=>launch);t.after(()=>collector.close());
 await collector.request('owner',start());await collector.request('owner',{action:'disconnect',providers:['korail']});
 release({...fakeBrowser(),close:async()=>{closed++;}});await until(()=>closed);
 const status=await collector.request('owner',{action:'status'}),korail=status.connections.find(row=>row.providerId==='korail');assert.equal(korail.state,'disconnected');assert.equal(korail.connected,false);assert.equal(collector.sessions.size,0);
});
test('unverified transit adapters remain explicitly pending after member login',async t=>{
 const {storage}=await fixture(t),collector=new HomeCollector(storage,secret,'owner',async()=>fakeBrowser());t.after(()=>collector.close());
 await collector.request('owner',start(['tmoneyTransit','kobus']));
 const status=await until(async()=>{const data=await collector.request('owner',{action:'status'});return data.connections.filter(row=>['tmoneyTransit','kobus'].includes(row.providerId)).every(row=>row.state==='adapter_pending')&&data;});
 assert.equal(status.captures.length,0);assert.ok(status.connections.filter(row=>row.state==='adapter_pending').every(row=>row.connected));
});
