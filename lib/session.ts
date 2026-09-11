// 호스팅 플랫폼에 종속되지 않는 서명 세션. Node 테스트와 Workers 런타임에서 함께 동작한다.
const encoder=new TextEncoder();
export const SESSION_COOKIE='chuljang_session';
export const SESSION_MAX_AGE=60*60*24*30;
export type SessionPayload={email:string;name:string|null;iat:number;exp:number};
function base64url(value:Uint8Array){let text='';for(const byte of value)text+=String.fromCharCode(byte);return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function unbase64url(value:string){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),character=>character.charCodeAt(0));}
async function signingKey(secret:string){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export function normalizeEmail(value:unknown):string|null{
 if(typeof value!=='string')return null;
 const email=value.trim().toLowerCase();
 if(email.length<3||email.length>254)return null;
 return /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/.test(email)?email:null;
}
export function normalizeName(value:unknown):string|null{
 if(typeof value!=='string')return null;
 const name=value.trim().replace(/\s+/g,' ');
 return name&&name.length<=60?name:null;
}
// 이메일에서 안정적인 사용자 ID를 만든다. 같은 이메일은 배포가 바뀌어도 같은 ID를 받는다.
export async function userIdFor(email:string):Promise<string>{
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode('chuljang-user-v1:'+email)));
 return 'usr_'+base64url(digest).slice(0,27);
}
// 기존 배포에서 쓰던 사용자 ID를 이어받기 위한 별칭. CHULJANG_USER_ALIASES="me@example.com=user_123" 형식.
export function aliasFor(email:string,aliases:string|undefined|null):string|null{
 for(const entry of (aliases||'').split(',')){
  const separator=entry.indexOf('=');if(separator<1)continue;
  if(normalizeEmail(entry.slice(0,separator))!==email)continue;
  const id=entry.slice(separator+1).trim();
  if(id&&id.length<=100&&/^[\w.:@-]+$/.test(id))return id;
 }
 return null;
}
// 허용 목록이 비어 있으면 모든 이메일을 허용한다. 접속 코드 검사와 함께 사용한다.
export function emailAllowed(email:string,allowed:string|undefined|null):boolean{
 const list=(allowed||'').split(',').map(value=>normalizeEmail(value)).filter((value):value is string=>!!value);
 return list.length===0||list.includes(email);
}
export async function createSessionToken(secret:string,user:{email:string;name:string|null},now=Date.now()):Promise<string>{
 const payload:SessionPayload={email:user.email,name:user.name,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+SESSION_MAX_AGE};
 const body=base64url(encoder.encode(JSON.stringify(payload)));
 const signature=new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(secret),encoder.encode(body)));
 return body+'.'+base64url(signature);
}
export async function readSessionToken(secret:string,token:string|undefined|null,now=Date.now()):Promise<SessionPayload|null>{
 if(!token||token.length>4096)return null;
 const [body,signature]=token.split('.');
 if(!body||!signature)return null;
 try{
  if(!await crypto.subtle.verify('HMAC',await signingKey(secret),unbase64url(signature),encoder.encode(body)))return null;
  const payload=JSON.parse(new TextDecoder().decode(unbase64url(body))) as SessionPayload;
  const email=normalizeEmail(payload?.email);
  if(!email||typeof payload.exp!=='number'||payload.exp*1000<=now)return null;
  return {email,name:normalizeName(payload.name),iat:payload.iat,exp:payload.exp};
 }catch{return null;}
}
// 비밀값 비교는 길이·내용이 드러나지 않도록 해시를 거쳐 수행한다.
export async function secretsMatch(expected:string,received:unknown):Promise<boolean>{
 if(typeof received!=='string'||received.length>512)return false;
 const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(expected)),crypto.subtle.digest('SHA-256',encoder.encode(received))]);
 const left=new Uint8Array(a),right=new Uint8Array(b);
 let difference=0;for(let index=0;index<left.length;index+=1)difference|=left[index]^right[index];
 return difference===0;
}
export function sessionCookie(token:string,secure:boolean):string{
 return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; SameSite=Lax${secure?'; Secure':''}`;
}
export function expiredSessionCookie(secure:boolean):string{
 return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure?'; Secure':''}`;
}
// 로컬 개발에서만 개발용 비밀키와 접속 코드 없는 로그인을 허용하기 위한 판정.
export function isLocalHost(host:string|null|undefined):boolean{
 if(!host)return false;
 const hostname=host.trim().toLowerCase().replace(/:\d+$/,'').replace(/^\[|\]$/g,'');
 return hostname==='localhost'||hostname==='127.0.0.1'||hostname==='::1'||hostname==='::ffff:127.0.0.1';
}
