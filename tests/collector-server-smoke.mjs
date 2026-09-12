// Uses a disposable server owner and public login pages. Never logs login capability URLs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {signCollector} from '../lib/collector-security.ts';
const vars=await readFile(new URL('../.dev.vars',import.meta.url),'utf8');
const secret=/CHULJANG_COLLECTOR_SECRET="([^"]+)"/.exec(vars)?.[1];
assert.ok(secret,'private local integration configuration required');
const endpoint='https://chuljang-collector.hanatrust.workers.dev';
const owner='integration-'+crypto.randomUUID();
async function call(values){const body=JSON.stringify({owner,...values}),timestamp=String(Date.now());const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-collector-time':timestamp,'x-collector-signature':await signCollector(secret,timestamp,body)},body});const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;}
assert.equal((await fetch(endpoint,{method:'POST',body:'{}'})).status,401);
const initial=await call({action:'status'});assert.equal(initial.connections.length,6);assert.ok(initial.connections.every(row=>!row.connected));
try{
 const started=await call({action:'start',providers:['korail'],requestedDates:['2026-09-11'],consent:true,jobId:crypto.randomUUID()});assert.equal(started.connections[0].state,'queued');
 let result;
 for(let i=0;i<40;i++){await new Promise(resolve=>setTimeout(resolve,5000));result=(await call({action:'status'})).connections.find(row=>row.providerId==='korail');if(['login','error','partial'].includes(result.state))break;}
 console.log(JSON.stringify({state:result?.state,hasLoginUrl:!!result?.loginUrl,note:result?.note}));
 assert.equal(result?.state,'login','server should expose an actual official login session');assert.ok(result.loginUrl.startsWith('https://'));assert.equal(result.connected,false);await new Promise(resolve=>setTimeout(resolve,12000));const resumed=(await call({action:'status'})).connections.find(row=>row.providerId==='korail');assert.equal(resumed.state,'login','login persists across request disconnect and alarm');console.log('Login remains available across requests.');
}finally{await call({action:'disconnect',providers:['korail']});const after=await call({action:'status'});assert.equal(after.connections.find(row=>row.providerId==='korail').state,'disconnected');console.log('Disposable server connection revoked.');}
