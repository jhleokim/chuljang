import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import {consentVersion} from './consent.mjs';
const derive=promisify(scrypt), cookieName='chuljang_home_session';
const digest=value=>createHash('sha256').update(value).digest('hex');
const modern={N:32768,r:8,p:3,maxmem:64*1024*1024};
const validHash=value=>/^(scrypt-v2:)?[a-f0-9]{48}:[a-f0-9]{128}$/.test(value||'');
const usernameOf=value=>typeof value==='string'?value.trim().toLowerCase():'';
let hashes=0;
async function boundedDerive(password,salt,options){
 if(hashes>=4)throw new AccountError(429,'로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
 hashes++;try{return await derive(password,salt,64,options);}finally{hashes--;}
}
export class AccountError extends Error{constructor(status,message){super(message);this.status=status;}}
export function passwordPolicy(password){if(typeof password!=='string'||[...password].length<15||[...password].length>128||/^(.)\1+$/.test(password))throw new AccountError(400,'비밀번호는 15~128자로, 다른 곳에서 쓰지 않는 긴 문장으로 정해 주세요.');}
export async function hashPassword(password){const salt=randomBytes(24).toString('hex');return 'scrypt-v2:'+salt+':'+Buffer.from(await boundedDerive(password,salt,modern)).toString('hex');}
export async function verifyPassword(password,encoded){
 if(typeof password!=='string'||password.length>512||!validHash(encoded))return false;
 const parts=encoded.split(':'),[salt,hash]=parts.slice(-2);
 return timingSafeEqual(Buffer.from(hash,'hex'),await boundedDerive(password,salt,parts.length===3?modern:undefined));
}
export function safeReturn(value){try{const url=new URL(value||'/','https://local.invalid');return url.origin==='https://local.invalid'&&!/^\/(signin-|signout-|join|recover)/.test(url.pathname)?url.pathname+url.search:'/';}catch{return '/';}}
export function sessionToken(cookie){return(cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';}
export class HomeAuth{
 constructor(storage,origin,passwordHash,ownerId='home-owner'){
  if(!validHash(passwordHash))throw new Error('Run npm run home:prepare first');
  this.storage=storage;this.origin=new URL(origin).origin;this.passwordHash=passwordHash;this.ownerId=ownerId;this.secure=this.origin.startsWith('https:');
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS home_users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS home_user_sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES home_users(id),expires INTEGER NOT NULL,seen INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS home_user_sessions_owner ON home_user_sessions(user_id);
   CREATE TABLE IF NOT EXISTS home_invites(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,creator TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS home_auth_attempts(scope TEXT NOT NULL,time INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS home_auth_attempts_scope ON home_auth_attempts(scope,time);
   CREATE TABLE IF NOT EXISTS home_recovery(user_id TEXT PRIMARY KEY,token_hash TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS home_audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,time INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS home_consents(user_id TEXT PRIMARY KEY,version TEXT NOT NULL,accepted_at INTEGER NOT NULL);`);
  for(const table of ['receipts','trips','report_settings','report_shares'])for(const action of ['INSERT','UPDATE'])storage.sql.exec(`CREATE TRIGGER IF NOT EXISTS active_owner_${table}_${action} BEFORE ${action} ON ${table} WHEN NOT EXISTS(SELECT 1 FROM home_users WHERE id=NEW.user_id AND disabled=0) BEGIN SELECT RAISE(ABORT,'Inactive owner'); END;`);
  storage.transaction(()=>{
   if(!this.account(ownerId)){storage.sql.prepare('INSERT INTO home_users VALUES (?,?,?,?,0,?)').run(ownerId,'admin',passwordHash,'admin',Date.now());storage.sql.prepare('DELETE FROM home_sessions').run();}
   const fingerprint=digest(passwordHash),previous=storage.get('auth-bootstrap-fingerprint');
   if(previous&&previous!==fingerprint){storage.sql.prepare('UPDATE home_users SET password_hash=? WHERE id=?').run(passwordHash,ownerId);storage.sql.prepare('DELETE FROM home_user_sessions WHERE user_id=?').run(ownerId);}
   storage.set('auth-bootstrap-fingerprint',fingerprint);
  });
 }
 account(id){return this.storage.sql.prepare('SELECT id,username,role,disabled,created FROM home_users WHERE id=?').get(id)||null;}
 cookie(value,maxAge){return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.secure?'; Secure':''}`;}
 user(cookie){
  const token=sessionToken(cookie);if(!/^[a-f0-9]{64}$/.test(token))return null;
  const now=Date.now(),hash=digest(token),row=this.storage.sql.prepare('SELECT s.user_id,s.seen FROM home_user_sessions s JOIN home_users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND s.seen>? AND u.disabled=0').get(hash,now,now-86400000);
  if(!row)return null;if(row.seen<now-60000)this.storage.sql.prepare('UPDATE home_user_sessions SET seen=? WHERE token=?').run(now,hash);return row.user_id;
 }
 attempt(scope,maximum=10){return this.storage.transaction(()=>{
  const now=Date.now();this.storage.sql.prepare('DELETE FROM home_auth_attempts WHERE time<?').run(now-300000);
  if(this.storage.sql.prepare('SELECT COUNT(*) AS n FROM home_auth_attempts WHERE scope=?').get(scope).n>=maximum||this.storage.sql.prepare('SELECT COUNT(*) AS n FROM home_auth_attempts').get().n>=150)return false;
  this.storage.sql.prepare('INSERT INTO home_auth_attempts VALUES (?,?)').run(scope,now);return true;
 });}
 audit(actor,action,target=''){
  this.storage.sql.prepare('DELETE FROM home_audit WHERE time<?').run(Date.now()-90*86400000);
  this.storage.sql.prepare('INSERT INTO home_audit VALUES (?,?,?,?,?)').run(randomUUID(),actor,action,target,Date.now());
  this.storage.sql.prepare('DELETE FROM home_audit WHERE id IN (SELECT id FROM home_audit ORDER BY time DESC LIMIT -1 OFFSET 10000)').run();
 }
 issueSession(id){
  const token=randomBytes(32).toString('hex'),ttl=7*86400,now=Date.now();
  this.storage.sql.prepare('DELETE FROM home_user_sessions WHERE expires<? OR seen<?').run(now,now-86400000);
  this.storage.sql.prepare('DELETE FROM home_user_sessions WHERE token IN (SELECT token FROM home_user_sessions WHERE user_id=? ORDER BY seen DESC LIMIT -1 OFFSET 9)').run(id);
  this.storage.sql.prepare('INSERT INTO home_user_sessions VALUES (?,?,?,?)').run(digest(token),id,now+ttl*1000,now);return{status:200,cookie:this.cookie(token,ttl)};
 }
 async login(password,username='admin'){
  username=usernameOf(username);if(!this.attempt('login:'+digest(username)))return{status:429};
  const row=this.storage.sql.prepare('SELECT * FROM home_users WHERE username=?').get(username),valid=await verifyPassword(password,row?.password_hash||this.passwordHash);
  if(!row||row.disabled||!valid)return{status:401};
  const fresh=this.storage.sql.prepare('SELECT disabled,password_hash FROM home_users WHERE id=?').get(row.id);
  if(!fresh||fresh.disabled||fresh.password_hash!==row.password_hash)return{status:401};
  this.audit(row.id,'login');return this.issueSession(row.id);
 }
 logout(cookie){this.storage.sql.prepare('DELETE FROM home_user_sessions WHERE token=?').run(digest(sessionToken(cookie)));return this.cookie('',0);}
 logoutAll(id){this.storage.sql.prepare('DELETE FROM home_user_sessions WHERE user_id=?').run(id);this.audit(id,'logout_all');return this.cookie('',0);}
 async verifyCurrent(id,password){
  if(!this.attempt('reauth:'+id))throw new AccountError(429,'인증 시도가 많습니다. 5분 후 다시 시도해 주세요.');
  const row=this.storage.sql.prepare('SELECT password_hash,disabled FROM home_users WHERE id=?').get(id);
  if(!row||row.disabled||!await verifyPassword(password,row.password_hash))throw new AccountError(403,'현재 비밀번호를 확인해 주세요.');
  const fresh=this.storage.sql.prepare('SELECT password_hash,disabled FROM home_users WHERE id=?').get(id);
  if(!fresh||fresh.disabled||fresh.password_hash!==row.password_hash)throw new AccountError(403,'다시 로그인해 주세요.');return row.password_hash;
 }
 requireAdmin(id){const row=this.account(id);if(row?.role!=='admin'||row.disabled)throw new AccountError(403,'관리자만 사용할 수 있습니다.');}
 createInvite(id){
  this.requireAdmin(id);this.storage.sql.prepare('DELETE FROM home_invites WHERE expires<? OR used=1').run(Date.now());
  if(this.storage.sql.prepare('SELECT COUNT(*) AS n FROM home_invites').get().n>=20)throw new AccountError(409,'사용하지 않은 초대는 20개까지 만들 수 있습니다.');
  const token=randomBytes(32).toString('hex'),inviteId=randomUUID(),expires=Date.now()+7*86400000;
  this.storage.sql.prepare('INSERT INTO home_invites VALUES (?,?,?,?,0)').run(inviteId,digest(token),id,expires);this.audit(id,'invite_created',inviteId);return{id:inviteId,token,expires};
 }
 revokeInvite(id,inviteId){this.requireAdmin(id);this.storage.sql.prepare('DELETE FROM home_invites WHERE id=?').run(inviteId);this.audit(id,'invite_revoked',inviteId);}
 invite(token){return /^[a-f0-9]{64}$/.test(token||'')?this.storage.sql.prepare('SELECT id FROM home_invites WHERE token_hash=? AND expires>? AND used=0').get(digest(token),Date.now()):null;}
 async register(token,username,password,acceptedVersion){
  if(acceptedVersion!==consentVersion)throw new AccountError(400,'운영자 접근 및 데이터 보관 안내를 확인하고 동의해 주세요.');
  if(!this.attempt('join:'+digest(String(token))))throw new AccountError(429,'가입 시도가 많습니다. 잠시 후 다시 시도해 주세요.');
  if(!this.invite(token))throw new AccountError(400,'초대가 만료되었거나 이미 사용됐습니다.');
  username=usernameOf(username);if(!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)||username==='admin')throw new AccountError(400,'아이디는 영문 소문자·숫자·점·밑줄·하이픈 3~40자로 정해 주세요.');
  passwordPolicy(password);const hash=await hashPassword(password),id=randomUUID(),recovery=randomBytes(24).toString('hex');
  this.storage.transaction(()=>{
   if(!this.invite(token))throw new AccountError(400,'초대가 만료되었거나 이미 사용됐습니다.');
   if(this.storage.sql.prepare('SELECT COUNT(*) AS n FROM home_users WHERE disabled=0').get().n>=100)throw new AccountError(409,'이 서버의 가입 한도에 도달했습니다.');
   if(this.storage.sql.prepare('SELECT 1 FROM home_users WHERE username=?').get(username))throw new AccountError(409,'사용할 수 없는 아이디입니다.');
   this.storage.sql.prepare('INSERT INTO home_users VALUES (?,?,?,?,0,?)').run(id,username,hash,'member',Date.now());
   this.storage.sql.prepare('UPDATE home_invites SET used=1 WHERE token_hash=?').run(digest(token));
   this.storage.sql.prepare('INSERT INTO home_recovery VALUES (?,?)').run(id,digest(recovery));
   this.storage.sql.prepare('INSERT INTO home_consents VALUES (?,?,?)').run(id,consentVersion,Date.now());this.audit(id,'account_created');
  });return{...this.issueSession(id),id,recovery};
 }
 async changePassword(id,current,next){
  const old=await this.verifyCurrent(id,current);passwordPolicy(next);const hash=await hashPassword(next);
  const changed=this.storage.sql.prepare('UPDATE home_users SET password_hash=? WHERE id=? AND password_hash=? AND disabled=0').run(hash,id,old);
  if(!changed.changes)throw new AccountError(409,'계정이 변경됐습니다. 다시 로그인해 주세요.');this.logoutAll(id);this.audit(id,'password_changed');
 }
 newRecovery(id){const token=randomBytes(24).toString('hex');this.storage.sql.prepare('INSERT OR REPLACE INTO home_recovery VALUES (?,?)').run(id,digest(token));this.audit(id,'recovery_created');return token;}
 async recover(username,token,next){
  username=usernameOf(username);if(!this.attempt('recover:'+digest(username),5))throw new AccountError(429,'복구 시도가 많습니다. 5분 후 다시 시도해 주세요.');
  const row=this.storage.sql.prepare('SELECT u.id FROM home_users u JOIN home_recovery r ON r.user_id=u.id WHERE u.username=? AND u.disabled=0 AND r.token_hash=?').get(username,digest(String(token)));
  if(!row)throw new AccountError(400,'아이디와 복구 코드를 확인해 주세요.');passwordPolicy(next);const hash=await hashPassword(next);
  this.storage.transaction(()=>{
   if(!this.account(row.id)||this.account(row.id).disabled)throw new AccountError(400,'계정을 복구할 수 없습니다.');
   const used=this.storage.sql.prepare('DELETE FROM home_recovery WHERE user_id=? AND token_hash=?').run(row.id,digest(String(token)));
   if(!used.changes)throw new AccountError(400,'이미 사용한 복구 코드입니다.');
   this.storage.sql.prepare('UPDATE home_users SET password_hash=? WHERE id=?').run(hash,row.id);this.logoutAll(row.id);this.audit(row.id,'account_recovered');
  });
 }
 disable(actor,target,disabled){
  this.requireAdmin(actor);const targetAccount=this.account(target);if(target===this.ownerId||!targetAccount||targetAccount.username.startsWith('deleted-'))throw new AccountError(400,'변경할 수 없는 계정입니다.');
  this.storage.sql.prepare('UPDATE home_users SET disabled=? WHERE id=?').run(disabled?1:0,target);if(disabled)this.logoutAll(target);this.audit(actor,disabled?'account_disabled':'account_enabled',target);
 }
}
