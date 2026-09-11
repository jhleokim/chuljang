'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Check,Link2,LoaderCircle,Settings2,Upload,Unplug} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Calendar} from '@/components/ui/calendar';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {ko} from 'date-fns/locale';
import {format} from 'date-fns';
import {SOURCES} from '@/collector/providers.js';
import type {CollectionStatus} from '@/lib/server-collector';
import {signInPath} from '@/lib/auth-paths';
const live=['queued','opening','login','collecting'];
const labels:Record<string,string>={disconnected:'연결 전',queued:'수집 대기',opening:'연결하는 중',login:'로그인 필요',collecting:'수집 중',partial:'조회 범위 확인 필요',error:'다시 연결 필요',stopped:'중단됨'};
type Props={signedIn:boolean;upload:()=>void;requestedDates:string[];onDatesChange:(days:string[])=>void;skipCaptures:()=>string[];onCapture:(packet:unknown,id:string)=>Promise<void>};
export function TripCollection({signedIn,upload,requestedDates,onDatesChange,skipCaptures,onCapture}:Props){
 const [status,setStatus]=useState<CollectionStatus|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[consent,setConsent]=useState(false);
 const [selected,setSelected]=useState(['korail','kobus','koreanAir']);
 const [preferencesReady,setPreferencesReady]=useState(false);
 useEffect(()=>{try{const stored=JSON.parse(localStorage.getItem('chuljang-service-preferences')||'null');if(Array.isArray(stored)){const ids=stored.filter((id:unknown)=>typeof id==='string'&&SOURCES.some(source=>source.id===id));if(ids.length)setSelected([...new Set(ids)]);}}catch{}setPreferencesReady(true);},[]);
 useEffect(()=>{if(preferencesReady)try{localStorage.setItem('chuljang-service-preferences',JSON.stringify(selected));}catch{}},[selected,preferencesReady]);
 const handlers=useRef({skipCaptures,onCapture});handlers.current={skipCaptures,onCapture};
 const pollNow=useRef<()=>Promise<void>>(async()=>{}),polling=useRef(false);
 const running=!!status?.connections.some(item=>live.includes(item.state));
 useEffect(()=>{if(!signedIn)return;const controller=new AbortController();
  async function poll(){if(polling.current)return;polling.current=true;try{
   const skip=handlers.current.skipCaptures().slice(-200).join(',');const response=await fetch('/api/collection'+(skip?'?skip='+encodeURIComponent(skip):''),{signal:controller.signal});const value=await response.json() as CollectionStatus & {error?:string};if(!response.ok)throw new Error(value.error||'연결 상태를 확인하지 못했어요.');
   if(controller.signal.aborted)return;setStatus(value);setError('');
   for(const capture of value.captures||[]){if(controller.signal.aborted)break;await handlers.current.onCapture(capture.packet,'server:'+capture.providerId+':'+capture.captureId);}
  }catch(err){if(!controller.signal.aborted)setError((err as Error).message);}finally{polling.current=false;}}
  pollNow.current=poll;void poll();const timer=setInterval(()=>void poll(),5000);return()=>{controller.abort();clearInterval(timer);};
 },[signedIn]);
 async function action(body:Record<string,unknown>){setLoading(true);setError('');try{const response=await fetch('/api/collection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json() as CollectionStatus & {error?:string};if(!response.ok)throw new Error(value.error||'연결하지 못했어요.');const failed=value.connections?.find((item:{error?:string})=>item.error);if(failed)throw new Error(failed.error);setConsent(false);await pollNow.current();}catch(err){setError((err as Error).message);}finally{setLoading(false);}}
 function start(){if(!signedIn){location.href=signInPath('/');return;}if(selected.some(id=>!status?.connections.find(item=>item.providerId===id)?.consentedAt)){setConsent(true);return;}void action({action:'start',providers:selected,requestedDates,consent:false,jobId:crypto.randomUUID()});}
  return <><section className="date-journey" aria-labelledby="date-heading">
    <ol className="journey-steps"><li className={signedIn?'done':''}>01 로그인</li><li className="active">02 출장 날짜 선택</li><li>03 지정 양식으로 저장·공유</li></ol>
    <div className="date-content"><div className="date-copy"><span className="eyebrow">WHEN DID YOU TRAVEL?</span><h2 id="date-heading">출장 다녀온 날만<br/>골라주세요.</h2><p>하루씩 눌러 여러 날짜를 선택하세요.<br/>연결한 서비스에서 해당 이용일의 영수증을 찾습니다.</p>
      <div className="selected-days" aria-live="polite"><strong>{requestedDates.length ? requestedDates.length+'일 선택됨' : '아직 선택한 날짜가 없어요'}</strong><div>{requestedDates.map(day=><button key={day} disabled={running} onClick={()=>onDatesChange(requestedDates.filter(value=>value!==day))} aria-label={day+' 선택 해제'}>{day.slice(5).replace('-', '. ')} <span aria-hidden="true">×</span></button>)}</div></div>
      {!!requestedDates.length && <button className="clear-days" disabled={running} onClick={()=>onDatesChange([])}>날짜 선택 초기화</button>}
    </div><div className="trip-calendar"><Calendar mode="multiple" locale={ko} weekStartsOn={1} selected={requestedDates.map(day=>new Date(day+'T12:00:00'))} onSelect={days=>onDatesChange((days||[]).map(day=>format(day,'yyyy-MM-dd')).sort())} max={62} disabled={running ? true : {after:new Date()}} captionLayout="dropdown" startMonth={new Date(2020,0)} endMonth={new Date()} labels={{labelNext:()=> '다음 달',labelPrevious:()=> '이전 달'}}/><p>최대 62일 · 선택하지 않은 날짜는 제외</p></div></div>


  </section><section className="chrome-collection" aria-label="서버 자동 수집">
  <div className="chrome-collection-heading"><div className="chrome-heading-copy"><span className="chrome-mark"><Link2 size={25}/></span><div><span className="chrome-eyebrow">설치 없이 계정 연결</span><h2>{running?'연결한 서비스에서 모으고 있어요.':'권한을 승인하고, 영수증을 모으세요.'}</h2><p>서비스가 요구하는 최초 로그인·본인 인증을 마치면 이후 연결 상태를 재사용합니다.</p></div></div><Button className="chrome-start" disabled={loading||(!running&&(!requestedDates.length||!selected.length||(signedIn&&!status?.configured)))} onClick={()=>running?void action({action:'stop',providers:status!.connections.filter(item=>live.includes(item.state)).map(item=>item.providerId)}):start()}>{loading||running?<LoaderCircle size={18} className="animate-spin"/>:<Link2 size={18}/>} {running?'수집 중단':signedIn?'선택한 날짜 자동 수집':'로그인하고 연결'}</Button></div>
  <div className="chrome-capabilities"><span><Check size={15}/> 설치할 프로그램 없음</span><span><Check size={15}/> 중복 영수증 자동 제외</span><button onClick={()=>setConsent(true)} disabled={loading||running}><Settings2 size={14}/> 연결 서비스 선택</button></div>
  {signedIn&&status&&!status.configured&&<p className="chrome-error">서버 연결 설정을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.</p>}
  {error&&<p className="chrome-error" role="alert">{error}</p>}
  <div className="connection-grid">{(status?.connections||[]).filter(item=>item.consentedAt||item.state!=='disconnected').map(item=><div className="connection-card" key={item.providerId}><strong>{SOURCES.find(source=>source.id===item.providerId)?.name}</strong><span className={'connection-state state-'+item.state}>{labels[item.state]||item.state}{item.count?' · '+item.count+'건':''}</span><p>{item.note}</p>{item.loginUrl&&<a className="service-login" href={item.loginUrl} target="_blank" rel="noopener noreferrer">공식 화면에서 로그인 <ArrowUpRight size={14}/></a>}{item.consentedAt&&<button className="disconnect-service" disabled={loading} onClick={()=>void action({action:'disconnect',providers:[item.providerId]})}><Unplug size={12}/> 연결 해제</button>}</div>)}</div>
  <div className="chrome-bottom"><p>개인 카카오 T·쏘카와 웹에서 조회할 수 없는 내역은 아직 계정 자동 수집을 지원하지 않습니다.</p><Button variant="ghost" onClick={upload}><Upload size={15}/> 사진·PDF 가져오기</Button></div>
  </section><Dialog open={consent} onOpenChange={value=>!loading&&setConsent(value)}><DialogContent><DialogTitle>서비스 연결 권한</DialogTitle><DialogDescription>선택한 서비스의 이용내역·영수증을 조회하고 로그인 상태를 암호화하여 보관합니다. 연결은 언제든 해제할 수 있습니다.</DialogDescription><div className="consent-sources">{SOURCES.map(source=><label key={source.id}><input type="checkbox" checked={selected.includes(source.id)} disabled={loading} onChange={event=>setSelected(ids=>event.target.checked?[...ids,source.id]:ids.filter(id=>id!==source.id))}/><span>{source.name}{source.id==='socarBiz'&&<small>기업 프로필만 지원</small>}</span></label>)}</div><p className="consent-note">서비스별 공식 로그인 화면에 직접 로그인합니다. 예약·결제·취소는 실행하지 않습니다.</p><Button disabled={loading||!selected.length||!requestedDates.length||!status?.configured} onClick={()=>void action({action:'start',providers:selected,requestedDates,consent:true,jobId:crypto.randomUUID()})}>{loading?<LoaderCircle className="animate-spin" size={17}/>:<Check size={17}/>} 권한 승인하고 수집 시작</Button>{!requestedDates.length&&<p className="consent-note">출장 날짜를 먼저 선택해 주세요.</p>}{error&&<p role="alert" className="consent-note">{error}</p>}</DialogContent></Dialog></>;
}
