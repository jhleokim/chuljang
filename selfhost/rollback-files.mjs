// Run only with the app stopped, immediately before reverting to an image
// which predates private-file encryption. Preserves newly written file content.
import {readdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {storageKey,encrypted,decryptFile} from './encryption.mjs';
if(process.argv[2]!=='--prepare-legacy-image')throw new Error('Explicit rollback flag required');
const root=resolve(process.env.CHULJANG_DATA_DIR||'/data'),key=storageKey(process.env.HOME_COLLECTOR_KEY);
for(const name of readdirSync(join(root,'files'))){
 if(!/^[a-f0-9-]{36}$/.test(name))continue;
 const target=join(root,'files',name),bytes=readFileSync(target);if(!encrypted(bytes))continue;
 const temp=target+'.'+randomUUID()+'.tmp';writeFileSync(temp,decryptFile(key,'receipts/'+name,bytes),{mode:0o600,flag:'wx'});renameSync(temp,target);
}
console.log('Legacy file compatibility restored.');
