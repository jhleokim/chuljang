import { signInPath } from '@/lib/auth-paths';
// 기존 ChatGPT Sites 경로로 들어오는 링크를 새 로그인 화면으로 넘긴다.
export async function GET(request:Request){
 const url=new URL(request.url);
 return new Response(null,{status:302,headers:{Location:signInPath(url.searchParams.get('return_to')??'/'),'Cache-Control':'private, no-store'}});
}
