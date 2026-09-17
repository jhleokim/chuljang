import {createHash,randomBytes,randomUUID} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
export const testCookieName='chuljang_test_session';
export function testToken(cookie){return (cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(testCookieName+'='))?.slice(testCookieName.length+1)||'';}
export function installTestWorkspaces(storage){storage.sql.exec('CREATE TABLE IF NOT EXISTS test_workspaces(token TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE,expires INTEGER NOT NULL)');}
export function testIdentity(storage,auth,cookie,now=Date.now()){
 const token=testToken(cookie);if(!/^[a-f0-9]{64}$/.test(token))return null;
 const row=storage.sql.prepare('SELECT user_id FROM test_workspaces WHERE token=? AND expires>?').get(hash(token),now);
 const user=row&&auth.account(row.user_id);return user&&!user.disabled?user:null;
}
export function createTestWorkspace(storage,auth,scope,now=Date.now()){
 if(!auth.attempt('test:'+hash(scope),8)||storage.sql.prepare('SELECT COUNT(*) AS n FROM test_workspaces WHERE expires>?').get(now).n>=40)throw new Error('잠시 후 다시 시작해 주세요.');
 const id='test-'+randomUUID(),token=randomBytes(32).toString('hex'),expires=now+86400000;
 storage.transaction(()=>{
  storage.sql.prepare('INSERT INTO home_users VALUES (?,?,?,?,0,?)').run(id,id,'test-no-password','test',now);
  storage.sql.prepare('INSERT INTO test_workspaces VALUES (?,?,?)').run(hash(token),id,expires);
 });
 return {id,cookie:`${testCookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${auth.secure?'; Secure':''}`};
}
