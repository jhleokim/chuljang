'use client';
import {useEffect,useState} from 'react';
import {LoaderCircle} from 'lucide-react';
import type {CollectionStatus} from '@/lib/server-collector';
export default function ServiceLogin(){
 const [message,setMessage]=useState('공식 로그인 화면을 열고 있어요.');
 useEffect(()=>{const provider=new URLSearchParams(location.search).get('provider');const controller=new AbortController();let stopped=false;
  async function poll(){if(stopped)return;try{const response=await fetch('/api/collection',{signal:controller.signal});if(response.status===401){location.replace('/signin-with-chatgpt?return_to='+encodeURIComponent(location.pathname+location.search));return;}if(!response.ok)throw new Error('로그인 연결을 기다리고 있습니다.');const data=await response.json() as CollectionStatus;const connection=data.connections?.find(item=>item.providerId===provider);
   if(connection?.loginUrl){const url=new URL(connection.loginUrl,location.origin);const home=url.origin===location.origin&&/^\/remote\/[a-f0-9]{48}\/$/.test(url.pathname);const cloud=url.protocol==='https:'&&url.hostname==='live.browser.run';if(!home&&!cloud)throw new Error('로그인 주소를 확인하지 못했습니다.');stopped=true;location.replace(url.href);return;}
   if(connection?.connected){setMessage('로그인됐습니다. 출장 날짜 조회를 자동으로 이어갑니다.');window.close();return;}
   if(connection?.state==='error')setMessage(connection.note);else setMessage('공식 로그인 화면을 준비하고 있어요. 잠시만 기다려 주세요.');
  }catch(error){if(!controller.signal.aborted)setMessage((error as Error).message);}}
  void poll();const timer=setInterval(()=>void poll(),2000);return()=>{stopped=true;controller.abort();clearInterval(timer);};
 },[]);
 return <main className="service-login-wait"><LoaderCircle size={30} className="animate-spin"/><h1>서비스 로그인</h1><p>{message}</p><p>로그인 후에는 이 창을 닫아도 됩니다. 별도의 완료 버튼은 없어요.</p></main>;
}
