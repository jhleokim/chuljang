import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { BriefcaseBusiness } from 'lucide-react';
import { getUser } from '@/app/auth';
import { accessCode, authSecret } from '@/lib/auth-config';
import { isLocalHost } from '@/lib/session';
import { SIGN_IN_ACTION, safeReturnPath } from '@/lib/auth-paths';
export const dynamic='force-dynamic';
const MESSAGES:Record<string,string>={
 email:'이메일 주소를 다시 확인해 주세요.',
 blocked:'이 이메일은 아직 허용되지 않았습니다. 관리자에게 문의해 주세요.',
 code:'접속 코드가 올바르지 않습니다.',
 request:'로그인 요청을 처리하지 못했습니다. 다시 시도해 주세요.',
};
export default async function SignIn({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const parameters=await searchParams;
 const single=(key:string)=>{const value=parameters[key];return Array.isArray(value)?value[0]:value;};
 const returnTo=safeReturnPath(single('return_to'));
 if(await getUser())redirect(returnTo);
 const host=(await headers()).get('host');
 const local=isLocalHost(host);
 const code=accessCode();
 const ready=!!authSecret(host)&&(!!code||local);
 const error=single('error');
 return <div className="auth-page">
  <Link className="brand" href="/"><span className="brand-icon"><BriefcaseBusiness size={21}/></span>출장<span className="brand-en">CHULJANG</span></Link>
  <div className="auth-card">
   <h1>로그인</h1>
   <p className="auth-lead">영수증을 내 공간에 보관하고, 다음에도 이어서 정리하려면 로그인해 주세요.</p>
   {!ready&&<p className="auth-error" role="alert">로그인 설정이 아직 준비되지 않았습니다. 서버에 CHULJANG_AUTH_SECRET{code?'':'과 CHULJANG_ACCESS_CODE'}를 설정해 주세요.</p>}
   {error&&ready&&<p className="auth-error" role="alert">{MESSAGES[error]||MESSAGES.request}</p>}
   <form method="post" action={SIGN_IN_ACTION} className="auth-form">
    <input type="hidden" name="return_to" value={returnTo}/>
    <label>이메일<input name="email" type="email" required maxLength={254} autoComplete="email" placeholder="name@example.com" disabled={!ready}/></label>
    <label>이름 <span className="auth-optional">(선택)</span><input name="name" type="text" maxLength={60} autoComplete="name" placeholder="표시할 이름" disabled={!ready}/></label>
    {(!!code||!local)&&<label>접속 코드<input name="code" type="password" required maxLength={512} autoComplete="current-password" disabled={!ready}/></label>}
    <button type="submit" className="auth-submit" disabled={!ready}>로그인</button>
   </form>
   <p className="auth-note">{local&&!code?'로컬 개발 로그인입니다. 배포 환경에서는 접속 코드가 필요합니다.':'접속 코드는 이 서비스를 운영하는 사람이 공유합니다.'}</p>
  </div>
 </div>;
}
