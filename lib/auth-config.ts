import { env } from 'cloudflare:workers';
import { isLocalHost } from './session';
// 로컬 개발 전용 비밀키. 배포 호스트에서는 CHULJANG_AUTH_SECRET이 없으면 로그인을 막는다.
export const DEV_AUTH_SECRET='chuljang-local-development-secret';
function setting(name:string):string|undefined{
 const value=Reflect.get(env,name);
 return typeof value==='string'&&value.trim()?value.trim():undefined;
}
export function authSecret(host:string|null|undefined):string|undefined{
 return setting('CHULJANG_AUTH_SECRET')??(isLocalHost(host)?DEV_AUTH_SECRET:undefined);
}
export function accessCode():string|undefined{return setting('CHULJANG_ACCESS_CODE');}
export function allowedEmails():string|undefined{return setting('CHULJANG_ALLOWED_EMAILS');}
export function userAliases():string|undefined{return setting('CHULJANG_USER_ALIASES');}
// 기존 ChatGPT Sites 배포를 유지할 때만 켠다. 직접 배포에서는 헤더를 위조할 수 있으므로 기본값은 꺼짐이다.
export function trustsPlatformAuth():boolean{return setting('CHULJANG_TRUST_PLATFORM_AUTH')==='1';}
export function extraOrigins():string[]{
 return (setting('CHULJANG_APP_ORIGINS')||'').split(',').map(value=>value.trim()).filter(Boolean);
}
