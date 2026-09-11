import { safeReturnPath } from '@/lib/auth-paths';
import { expiredSessionCookie } from '@/lib/session';
function signOut(request:Request,status:number){
 const url=new URL(request.url);
 const origin=request.headers.get('origin');
 if(origin&&origin!==url.origin)return new Response('허용되지 않은 요청입니다.',{status:403});
 return new Response(null,{status,headers:{Location:safeReturnPath(url.searchParams.get('return_to')),'Cache-Control':'private, no-store','Set-Cookie':expiredSessionCookie(url.protocol==='https:')}});
}
export async function GET(request:Request){return signOut(request,302);}
export async function POST(request:Request){return signOut(request,303);}
