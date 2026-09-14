import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../selfhost/auth.mjs';
const directory=await mkdtemp(join(tmpdir(),'chuljang-production-smoke-'));
const origin='http://127.0.0.1:3091',password=randomBytes(24).toString('hex');
const child=spawn(process.execPath,['selfhost/server.mjs'],{cwd:process.cwd(),env:{...process.env,HOME_ORIGIN:origin,HOME_PASSWORD_HASH:await hashPassword(password),HOME_COLLECTOR_KEY:randomBytes(48).toString('hex'),CHULJANG_DATA_DIR:directory,PORT:'3091'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',chunk=>{logs+=chunk;});child.stderr.on('data',chunk=>{logs+=chunk;});
try{
 const deadline=Date.now()+20000;while(!logs.includes('home server ready')&&Date.now()<deadline){if(child.exitCode!==null)throw new Error(logs);await new Promise(resolve=>setTimeout(resolve,200));}
 assert.match(logs,/home server ready/);
 assert.equal((await fetch(origin+'/api/receipts',{headers:{'oai-authenticated-user-id':'spoof','oai-authenticated-user-email':'spoof@example.com'}})).status,401);
 const login=await fetch(origin+'/signin-with-chatgpt',{method:'POST',headers:{Origin:origin},body:'password='+password,redirect:'manual'});assert.equal(login.status,303);const cookie=login.headers.get('set-cookie');
 const headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json'};
 assert.equal((await fetch(origin,{headers})).status,200);
 const tripResponse=await fetch(origin+'/api/trips',{method:'POST',headers,body:JSON.stringify({name:'SYNTHETIC home smoke',startDate:'2026-09-09',endDate:'2026-09-09'})});assert.equal(tripResponse.status,201,await tripResponse.text());
 const trips=await (await fetch(origin+'/api/trips',{headers})).json();assert.equal(trips.length,1);
 const collection=await (await fetch(origin+'/api/collection',{headers})).json();assert.equal(collection.configured,true);assert.ok(collection.connections.length>=3);
 const rows=[{source:'ktx',date:'2026-09-09',merchant:'Synthetic KTX',amount:59800,reference:'SYNTHETIC-1',raw:'승차일 2026-09-09 결제금액 59,800원',sourceUrl:'',requestedDates:['2026-09-09']}];
 const imported=await fetch(origin+'/api/receipts',{method:'POST',headers,body:JSON.stringify(rows)});assert.equal(imported.status,200,await imported.text());
 const receipts=await (await fetch(origin+'/api/receipts',{headers})).json();assert.equal(receipts.length,1);assert.equal(receipts[0].tripId,trips[0].id);
 console.log('Home production smoke PASS: authenticated Next routes, SQLite writes, owner isolation, collector connection.');
}catch(error){console.error(logs);throw error;}
finally{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},5000).unref();});if(!resolve(directory).startsWith(resolve(tmpdir())+'\\chuljang-production-smoke-')&&!resolve(directory).startsWith(resolve(tmpdir())+'/chuljang-production-smoke-'))throw new Error('Unexpected test directory');await rm(directory,{recursive:true,force:true});}
