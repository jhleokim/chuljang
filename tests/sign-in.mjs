// 로컬 개발 서버에 로그인해 세션 쿠키를 얻는다. 스모크 테스트가 함께 사용한다.
export async function signIn(base='http://localhost:5173',email='local@chuljang.test'){
 const response=await fetch(base+'/api/auth/signin',{
  method:'POST',redirect:'manual',
  headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:base},
  body:new URLSearchParams({email,name:'로컬 검증',return_to:'/'}),
 });
 const cookie=response.headers.getSetCookie().filter(value=>value.startsWith('chuljang_session=')).map(value=>value.split(';')[0]).join('; ');
 if(!cookie)throw new Error('sign-in failed: '+response.status+' '+response.headers.get('location'));
 return cookie;
}
