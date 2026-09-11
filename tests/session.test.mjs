import test from 'node:test';
import assert from 'node:assert/strict';
import { aliasFor, createSessionToken, emailAllowed, expiredSessionCookie, isLocalHost, normalizeEmail, normalizeName, readSessionToken, secretsMatch, sessionCookie, userIdFor } from '../lib/session.ts';
import { safeReturnPath, signInPath, signOutPath } from '../lib/auth-paths.ts';

test('sign-in session survives a round trip and rejects tampering',async()=>{
 const token=await createSessionToken('secret-key',{email:'a@example.com',name:'홍길동'});
 const session=await readSessionToken('secret-key',token);
 assert.equal(session.email,'a@example.com');assert.equal(session.name,'홍길동');
 assert.equal(await readSessionToken('other-key',token),null,'다른 키로 서명한 세션은 거부');
 const [body,signature]=token.split('.');
 assert.equal(await readSessionToken('secret-key',body+'.'+signature.slice(0,-2)+'aa'),null,'서명 변조 거부');
 assert.equal(await readSessionToken('secret-key',btoa('{"email":"b@example.com","exp":9999999999}')+'.'+signature),null,'본문 변조 거부');
 assert.equal(await readSessionToken('secret-key',token,Date.now()+31*24*60*60*1000),null,'만료된 세션 거부');
 assert.equal(await readSessionToken('secret-key',''),null);
 assert.equal(await readSessionToken('secret-key','not-a-token'),null);
});

test('user ids stay stable per email and can be aliased to an existing account',async()=>{
 const id=await userIdFor('a@example.com');
 assert.equal(id,await userIdFor('a@example.com'));
 assert.notEqual(id,await userIdFor('b@example.com'));
 assert.match(id,/^usr_[\w-]{27}$/);
 assert.equal(aliasFor('a@example.com','A@Example.com=user_legacy_1, b@example.com=user_2'),'user_legacy_1');
 assert.equal(aliasFor('c@example.com','a@example.com=user_legacy_1'),null);
 assert.equal(aliasFor('a@example.com','a@example.com=bad id'),null,'형식이 어긋난 별칭 무시');
 assert.equal(aliasFor('a@example.com',undefined),null);
});

test('email normalization and allow list gate sign-in',()=>{
 assert.equal(normalizeEmail('  Person@Example.COM '),'person@example.com');
 for(const value of ['','person','person@example','a@b,c@d','person @example.com',null,42,'x'.repeat(250)+'@example.com'])assert.equal(normalizeEmail(value),null,String(value));
 assert.equal(normalizeName('  홍 길동  '),'홍 길동');
 assert.equal(normalizeName('x'.repeat(61)),null);
 assert.ok(emailAllowed('a@example.com',''),'목록이 비면 모두 허용');
 assert.ok(emailAllowed('a@example.com','A@example.com , b@example.com'));
 assert.ok(!emailAllowed('c@example.com','a@example.com'));
});

test('access code comparison, cookies and local host detection',async()=>{
 assert.ok(await secretsMatch('code-1234','code-1234'));
 assert.ok(!await secretsMatch('code-1234','code-1235'));
 assert.ok(!await secretsMatch('code-1234',null));
 assert.match(sessionCookie('token',true),/^chuljang_session=token; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/);
 assert.ok(!sessionCookie('token',false).includes('Secure'));
 assert.match(expiredSessionCookie(false),/Max-Age=0/);
 for(const host of ['localhost','localhost:5173','127.0.0.1:8787','[::1]:5173'])assert.ok(isLocalHost(host),host);
 for(const host of ['chuljang.example.com','127.0.0.1.example.com','',null])assert.ok(!isLocalHost(host),String(host));
});

test('return paths stay on this site and never loop back into auth routes',()=>{
 assert.equal(safeReturnPath('/receipts?tab=review'),'/receipts?tab=review');
 for(const value of ['//evil.example.com','https://evil.example.com','/signin','/signout','/signin-with-chatgpt','/api/auth/signin','',null,undefined])assert.equal(safeReturnPath(value),'/',String(value));
 assert.equal(signInPath('/'),'/signin?return_to=%2F');
 assert.equal(signOutPath('//evil.example.com'),'/signout?return_to=%2F');
});
