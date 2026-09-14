import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../selfhost/auth.mjs';
import {zipSync,strToU8} from 'fflate';
import {defaultReport} from '../lib/report.ts';
import {buildReportWorkbook} from '../lib/report-workbook.ts';
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
 const settings=await (await fetch(origin+'/api/report-settings',{headers})).json();assert.equal(settings.templateName,null);assert.equal(settings.config.title,defaultReport.title);
 const template=await buildReportWorkbook(receipts,[],['2026-09-09'],defaultReport),form=new FormData();form.set('config',JSON.stringify({...defaultReport,sheet:'출장 정산서',recipient:'synthetic@example.com'}));form.set('template',new Blob([template]),'synthetic.xlsx');
 const saved=await fetch(origin+'/api/report-settings',{method:'POST',headers:{Cookie:cookie,Origin:origin},body:form});assert.equal(saved.status,200,await saved.text());
 assert.equal((await fetch(origin+'/api/report-settings/template')).status,401);assert.equal((await fetch(origin+'/api/report-settings/template',{headers})).status,200);
 const configAgain=await (await fetch(origin+'/api/report-settings',{headers})).json();assert.equal(configAgain.templateName,'synthetic.xlsx');assert.equal(configAgain.config.recipient,'synthetic@example.com');
 const file=zipSync({'test.txt':strToU8('synthetic sharing test only')}),shareForm=new FormData();shareForm.set('file',new Blob([file]),'synthetic.zip');
 const shareResponse=await fetch(origin+'/api/report-shares',{method:'POST',headers:{Cookie:cookie,Origin:origin},body:shareForm});assert.equal(shareResponse.status,200);const share=await shareResponse.json();
 const publicFile=await fetch(origin+share.path);assert.equal(publicFile.status,200);assert.match(publicFile.headers.get('content-disposition'),/attachment/);assert.deepEqual(new Uint8Array(await publicFile.arrayBuffer()),file);
 const revoked=await fetch(origin+'/api/report-shares',{method:'DELETE',headers,body:JSON.stringify({id:share.id})});assert.equal(revoked.status,200);assert.equal((await fetch(origin+share.path)).status,404);assert.equal((await fetch(origin+'/share/'+'0'.repeat(64))).status,404);
 console.log('Home production smoke PASS: authentication, SQLite, collector, template persistence, anonymous token download, revocation, missing-token isolation.');
}catch(error){console.error(logs);throw error;}
finally{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},5000).unref();});if(!resolve(directory).startsWith(resolve(tmpdir())+'\\chuljang-production-smoke-')&&!resolve(directory).startsWith(resolve(tmpdir())+'/chuljang-production-smoke-'))throw new Error('Unexpected test directory');await rm(directory,{recursive:true,force:true});}
