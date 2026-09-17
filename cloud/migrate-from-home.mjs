// Run once in the stopped home app's Docker image with its data volume mounted.
// The TLS-protected destination authenticates migration separately from collection.
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {storageKey,decryptFile} from '../selfhost/encryption.mjs';
import {signCollector} from '../lib/collector-security.ts';
const settings=JSON.parse(readFileSync(process.argv[2],'utf8'));
const database=new DatabaseSync('/data/chuljang.sqlite',{readOnly:true});
const key=storageKey(process.env.HOME_COLLECTOR_KEY);
async function send(action,payload){
 const body=JSON.stringify({action,payload}),time=String(Date.now());
 const response=await fetch('https://chuljang.hanatrust.workers.dev/internal/migrate',{method:'POST',headers:{'Content-Type':'application/json','x-collector-time':time,'x-collector-signature':await signCollector(settings.CLOUD_MIGRATION_KEY,time,body)},body,signal:AbortSignal.timeout(120000),redirect:'error'});
 if(!response.ok)throw new Error('Migration failed for '+action+' with HTTP '+response.status);return response.json();
}
if((await send('status',{})).complete)throw new Error('Migration already completed');
const accountTables=['home_users','home_invites','home_recovery','home_audit','home_consents'];
await send('accounts',Object.fromEntries(accountTables.map(table=>[table,database.prepare('SELECT * FROM '+table).all()])));
const counts={};
for(const table of ['trips','receipts','report_settings','report_shares']){
 const rows=database.prepare('SELECT * FROM '+table).all();counts[table]=rows.length;
 for(let i=0;i<rows.length;i+=100)await send('rows',{table,rows:rows.slice(i,i+100)});
}
const files=database.prepare('SELECT attachment_key AS key FROM receipts WHERE attachment_key IS NOT NULL UNION SELECT template_key AS key FROM report_settings WHERE template_key IS NOT NULL UNION SELECT file_key AS key FROM report_shares').all();
for(const file of files){if(!/^receipts\/[a-f0-9-]{36}$/.test(file.key))throw new Error('Invalid private file key');const bytes=decryptFile(key,file.key,readFileSync('/data/files/'+file.key.slice(9)));await send('file',{key:file.key,base64:bytes.toString('base64')});}
await send('finish',{counts});database.close();
console.log('CLOUD_MIGRATION_COMPLETE',JSON.stringify({...counts,files:files.length}));
