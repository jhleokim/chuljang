import { signOutPath } from '@/lib/auth-paths';
// 기존 ChatGPT Sites 경로로 들어오는 링크를 새 로그아웃 경로로 넘긴다.
function forward(request:Request,status:number){
 const url=new URL(request.url);
 return new Response(null,{status,headers:{Location:signOutPath(url.searchParams.get('return_to')??'/'),'Cache-Control':'private, no-store'}});
}
export async function GET(request:Request){return forward(request,302);}
export async function POST(request:Request){return forward(request,303);}
