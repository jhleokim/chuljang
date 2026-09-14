import { randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
import { hashPassword } from './auth.mjs';
const file=new URL('./.env',import.meta.url);
try{await access(file);throw new Error('selfhost/.env already exists; existing keys were preserved.');}catch(error){if(error.code!=='ENOENT')throw error;}
const origin=process.argv[2]||'http://localhost:3080';const url=new URL(origin);
if(url.origin!==origin||url.username||url.password||!['https:','http:'].includes(url.protocol))throw new Error('Use an origin without a path');
if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Remote access requires HTTPS');
const password=randomBytes(18).toString('base64url');
await writeFile(new URL('./admin-password.txt',import.meta.url),password+'\n',{mode:0o600,flag:'wx'});
await writeFile(file,`HOME_ORIGIN=${origin}\nHOME_OWNER_ID=home-owner\nHOME_PASSWORD_HASH=${await hashPassword(password)}\nHOME_COLLECTOR_KEY=${randomBytes(48).toString('hex')}\n`,{mode:0o600,flag:'wx'});
console.log('Created selfhost/.env and selfhost/admin-password.txt. Keep these private; existing files are never overwritten.');
