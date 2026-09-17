import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {HomeStorage} from '../selfhost/storage.mjs';
import {HomeAuth,hashPassword} from '../selfhost/auth.mjs';
import {HomeCollectors,BrowserPool} from '../selfhost/collector-manager.ts';
import {createHomeServer} from '../selfhost/server.mjs';
import {deleteAccountData} from '../selfhost/accounts.mjs';
import {consentVersion} from '../selfhost/consent.mjs';
const pass='A different long test password!';
async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'chuljang-accounts-')),key=randomBytes(48).toString('hex'),storage=new HomeStorage(directory,key),auth=new HomeAuth(storage,'http://127.0.0.1',await hashPassword(pass));t.after(async()=>{storage.close();await rm(directory,{recursive:true,force:true});});return{directory,key,storage,auth};}
async function member(auth,name){const invite=auth.createInvite(auth.ownerId);return auth.register(invite.token,name,pass,consentVersion);}
async function until(check){const end=Date.now()+5000;while(Date.now()<end){const result=await check();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Timed out');}

test('single-use invitations require recorded explicit consent and cannot create an administrator',async t=>{
 const {auth,storage}=await fixture(t),invite=auth.createInvite(auth.ownerId);
 await assert.rejects(auth.register(invite.token,'alice',pass),/동의/);assert.ok(auth.invite(invite.token));
 const attempts=await Promise.allSettled(['alice','bob'].map(name=>auth.register(invite.token,name,pass,consentVersion)));
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
 const user=attempts.find(r=>r.status==='fulfilled').value;assert.equal(auth.account(user.id).role,'member');
 assert.equal(storage.sql.prepare('SELECT version FROM home_consents WHERE user_id=?').get(user.id).version,consentVersion);
 assert.throws(()=>auth.createInvite(user.id),/관리자/);assert.equal(auth.invite(invite.token),undefined);
 assert.ok(!JSON.stringify(storage.sql.prepare('SELECT * FROM home_invites').all()).includes(invite.token));
 const expired=auth.createInvite(auth.ownerId);storage.sql.prepare('UPDATE home_invites SET expires=0 WHERE id=?').run(expired.id);await assert.rejects(auth.register(expired.token,'charlie',pass,consentVersion),/초대/);
});

test('sessions, password changes, recovery and disabling are confined to one account',async t=>{
 const {auth,storage}=await fixture(t),alice=await member(auth,'alice'),bob=await member(auth,'bob');
 assert.equal(auth.user(alice.cookie),alice.id);assert.equal(auth.user(bob.cookie),bob.id);
 await auth.changePassword(alice.id,pass,pass+' new');assert.equal(auth.user(alice.cookie),null);assert.equal(auth.user(bob.cookie),bob.id);
 assert.equal((await auth.login(pass,'alice')).status,401);const next=await auth.login(pass+' new','alice');assert.equal(next.status,200);
 await auth.recover('alice',alice.recovery,pass+' recovered');assert.equal(auth.user(next.cookie),null);await assert.rejects(auth.recover('alice',alice.recovery,pass+' again'),/복구/);
 auth.disable(auth.ownerId,bob.id,true);assert.equal(auth.user(bob.cookie),null);assert.equal((await auth.login(pass,'bob')).status,401);
 auth.disable(auth.ownerId,bob.id,false);const bobLogin=await auth.login(pass,'bob');assert.equal(bobLogin.status,200);
 storage.sql.prepare('UPDATE home_user_sessions SET seen=0 WHERE user_id=?').run(bob.id);assert.equal(auth.user(bobLogin.cookie),null);
 assert.throws(()=>auth.disable(bob.id,auth.ownerId,true),/관리자/);
});

test('encrypted files authenticate their path and legacy files migrate before use',async t=>{
 const {auth,storage,key,directory}=await fixture(t),one='receipts/'+randomUUID(),two='receipts/'+randomUUID(),payload=Buffer.from('private receipt only');
 await storage.bucket().put(one,payload);await storage.bucket().put(two,payload);
 const cipher=await readFile(storage.filePath(one));assert.ok(!cipher.includes(payload));assert.deepEqual(Buffer.from((await storage.bucket().get(one)).body),payload);
 await writeFile(storage.filePath(two),cipher);await assert.rejects(storage.bucket().get(two));await storage.bucket().delete(two);
 const legacy='receipts/'+randomUUID();await writeFile(storage.filePath(legacy),payload);
 const reopened=new HomeStorage(directory,key);assert.deepEqual(Buffer.from((await reopened.bucket().get(legacy)).body),payload);assert.ok(!(await readFile(reopened.filePath(legacy))).includes(payload));reopened.close();
 assert.ok(auth.account(auth.ownerId));
});

test('browser leases never share a display, preserve other accounts and cancel queued work',async()=>{
 const pool=new BrowserPool(2),a=new AbortController(),b=new AbortController(),c=new AbortController();
 const first=await pool.acquire('alice',a.signal);let aliceAgain=false;
 const second=pool.acquire('alice',a.signal).then(lease=>{aliceAgain=true;return lease;});
 const bob=await pool.acquire('bob',b.signal);assert.notEqual(first.slot,bob.slot);assert.equal(aliceAgain,false);
 const blocked=pool.acquire('charlie',c.signal);c.abort();await assert.rejects(blocked,/closed/);
 first.release();const after=await second;assert.notEqual(after.slot,bob.slot);after.release();bob.release();
});

test('legacy-image rollback converts encrypted files without losing content',async t=>{
 const {storage,directory,key}=await fixture(t),path='receipts/'+randomUUID(),bytes=Buffer.from('rollback-only synthetic original');await storage.bucket().put(path,bytes);
 const result=spawnSync(process.execPath,['selfhost/rollback-files.mjs','--prepare-legacy-image'],{cwd:process.cwd(),env:{...process.env,CHULJANG_DATA_DIR:directory,HOME_COLLECTOR_KEY:key},encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 assert.deepEqual(await readFile(storage.filePath(path)),bytes);
});

test('collectors keep credentials, captures, acknowledgements and revocation in the owning account',async t=>{
 const {auth,storage,key}=await fixture(t),alice=await member(auth,'alice'),bob=await member(auth,'bob');let sequence=0;
 const launch=async(slot,saved)=>{let url='',identity=saved?.cookies?.[0]?.value||'session-'+(++sequence);return{port:5900+slot,close:async()=>{},page:{url:()=>url,goto:async value=>{url=value;},evaluate:async fn=>fn.name==='serviceLoginState'?true:{inputs:[]}},context:{storageState:async()=>({cookies:[{name:'owner-cookie',value:identity}],origins:[]})}};};
 const manager=new HomeCollectors(storage,key,launch,async()=>({blocks:['승차일 2026-09-09\n결제금액 59,800원'],completed:true}));t.after(()=>manager.close());
 const request=()=>({action:'start',providers:['korail'],requestedDates:['2026-09-09'],consent:true,jobId:randomUUID()});
 await Promise.all([manager.request(alice.id,request()),manager.request(bob.id,request())]);
 const results=await until(async()=>{const values=await Promise.all([alice,bob].map(user=>manager.request(user.id,{action:'status'})));return values.every(v=>v.connections[0].state==='complete')&&values;});
 const [a,b]=results.map(v=>v.captures[0]);assert.notEqual(a.captureId,b.captureId);
 await manager.request(bob.id,{action:'ack',provider:'korail',captureId:a.captureId});assert.equal((await manager.request(alice.id,{action:'status'})).captures[0].captureId,a.captureId);
 await manager.revoke(alice.id);assert.equal((await manager.request(bob.id,{action:'status'})).captures[0].captureId,b.captureId);
 assert.equal((await manager.request(alice.id,{action:'status'})).captures.length,0);
 assert.ok(!JSON.stringify(storage.sql.prepare('SELECT value FROM home_state').all()).includes('session-'));
 await assert.rejects(async()=>manager.request('not-a-user',{action:'status'}));
});

test('HTTP consent, identity and remote login pages cannot be bypassed by another member',async t=>{
 const {auth}=await fixture(t),alice=await member(auth,'alice'),bob=await member(auth,'bob'),remoteId='a'.repeat(48);
 const web=await createHomeServer({auth,collector:{sessions:new Map([[remoteId,{owner:alice.id,port:5999}]])},handle:(req,res)=>res.end(req.headers['oai-authenticated-user-id']||'anonymous')});
 await new Promise(resolve=>web.server.listen(0,'127.0.0.1',resolve));t.after(()=>web.close());auth.origin='http://127.0.0.1:'+web.server.address().port;
 const invite=auth.createInvite(auth.ownerId),params=new URLSearchParams({invite:invite.token,username:'charlie',password:pass,consent_version:consentVersion});
 const join=()=>fetch(auth.origin+'/join',{method:'POST',headers:{Origin:auth.origin},body:params});
 assert.equal((await join()).status,400);params.set('accepted','yes');assert.equal((await join()).status,201);
 const bHeaders={Cookie:bob.cookie,'oai-authenticated-user-id':alice.id};
 assert.equal(await(await fetch(auth.origin+'/api/receipts',{headers:bHeaders})).text(),bob.id);
 assert.equal((await fetch(auth.origin+'/remote/'+remoteId+'/',{headers:bHeaders})).status,410);
 assert.equal((await fetch(auth.origin+'/remote/'+remoteId+'/',{headers:{Cookie:alice.cookie}})).status,200);
 const account=await(await fetch(auth.origin+'/account',{headers:{Cookie:bob.cookie}})).text();assert.ok(!account.includes('name="target"'));assert.ok(account.includes('서버 운영자는 관리 권한'));
 assert.equal((await fetch(auth.origin+'/account',{method:'POST',headers:{Cookie:bob.cookie,Origin:auth.origin},body:new URLSearchParams({action:'invite',current:pass})})).status,403);
 assert.equal((await fetch(auth.origin+'/account',{method:'POST',headers:{Cookie:bob.cookie,Origin:'https://other.example'},body:'action=logout_all'})).status,403);
});

test('account deletion removes only its records and files; late writes and admin reactivation fail',async t=>{
 const {auth,storage}=await fixture(t),alice=await member(auth,'alice'),bob=await member(auth,'bob');
 const keys=[];for(const user of [alice,bob]){const key='receipts/'+randomUUID();keys.push(key);await storage.bucket().put(key,Buffer.from(user.id));storage.sql.prepare('INSERT INTO report_settings VALUES (?,?,?,?)').run(user.id,'{}',key,'test.xlsx');}
 storage.sql.prepare('UPDATE home_users SET disabled=1 WHERE id=?').run(alice.id);await deleteAccountData(auth,alice.id);
 assert.equal(auth.user(alice.cookie),null);assert.equal(await storage.bucket().get(keys[0]),null);assert.ok(await storage.bucket().get(keys[1]));
 assert.equal(storage.sql.prepare('SELECT COUNT(*) AS n FROM report_settings').get().n,1);
 assert.throws(()=>storage.sql.prepare('INSERT INTO trips VALUES (?,?,?,?,?)').run(randomUUID(),alice.id,'late write','2026-09-09','2026-09-09'),/Inactive/);
 assert.throws(()=>auth.disable(auth.ownerId,alice.id,false),/계정/);assert.equal(auth.user(bob.cookie),bob.id);
});
