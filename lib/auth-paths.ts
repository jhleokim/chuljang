// 클라이언트·서버 양쪽에서 쓰는 로그인 경로. 특정 호스팅 제공자에 묶이지 않는다.
export const SIGN_IN_PATH='/signin';
export const SIGN_OUT_PATH='/signout';
export const SIGN_IN_ACTION='/api/auth/signin';
const RESERVED=new Set([SIGN_IN_PATH,SIGN_OUT_PATH,SIGN_IN_ACTION,'/signin-with-chatgpt','/signout-with-chatgpt','/callback']);
export function safeReturnPath(value:string|null|undefined):string{
 if(!value||!value.startsWith('/')||value.startsWith('//'))return '/';
 let url:URL;
 try{url=new URL(value,'https://app.local');}catch{return '/';}
 if(url.origin!=='https://app.local'||RESERVED.has(url.pathname))return '/';
 return `${url.pathname}${url.search}${url.hash}`;
}
export function signInPath(returnTo='/'):string{return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`;}
export function signOutPath(returnTo='/'):string{return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`;}
