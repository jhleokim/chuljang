import { accessCode, allowedEmails, authSecret } from '@/lib/auth-config';
import { SIGN_IN_PATH, safeReturnPath } from '@/lib/auth-paths';
import { createSessionToken, emailAllowed, isLocalHost, normalizeEmail, normalizeName, secretsMatch, sessionCookie } from '@/lib/session';
function back(returnTo:string,error:string){
 return new Response(null,{status:303,headers:{Location:`${SIGN_IN_PATH}?return_to=${encodeURIComponent(returnTo)}&error=${error}`,'Cache-Control':'private, no-store'}});
}
export async function POST(request:Request){
 const url=new URL(request.url);
 const origin=request.headers.get('origin');
 if(origin&&origin!==url.origin)return new Response('허용되지 않은 요청입니다.',{status:403});
 if(Number(request.headers.get('content-length'))>8192)return new Response('요청이 너무 큽니다.',{status:413});
 let form:FormData;
 try{form=await request.formData();}catch{return back('/','request');}
 const returnTo=safeReturnPath(String(form.get('return_to')??'/'));
 const host=request.headers.get('host');
 const secret=authSecret(host);
 const code=accessCode();
 // 배포 호스트에서는 비밀키와 접속 코드가 모두 설정된 경우에만 로그인할 수 있다.
 if(!secret||(!code&&!isLocalHost(host)))return new Response('로그인 설정이 준비되지 않았습니다.',{status:503});
 const email=normalizeEmail(form.get('email'));
 if(!email)return back(returnTo,'email');
 if(!emailAllowed(email,allowedEmails()))return back(returnTo,'blocked');
 if(code&&!await secretsMatch(code,form.get('code'))){
  await new Promise(resolve=>setTimeout(resolve,400));// 접속 코드 추측 시도를 늦춘다.
  return back(returnTo,'code');
 }
 const token=await createSessionToken(secret,{email,name:normalizeName(form.get('name'))});
 return new Response(null,{status:303,headers:{Location:returnTo,'Cache-Control':'private, no-store','Set-Cookie':sessionCookie(token,url.protocol==='https:')}});
}
