'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Check,LogIn,LoaderCircle,TrainFront,BusFront,CarFront,Unplug} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Calendar} from '@/components/ui/calendar';
import {ko} from 'date-fns/locale';
import {format} from 'date-fns';
import {SOURCES} from '@/collector/providers.js';
import {collectionPlan,primaryServices} from '@/lib/collection-plan';
import type {CollectionStatus} from '@/lib/server-collector';
const labels:Record<string,string>={disconnected:'로그인 전',queued:'자동 조회 대기',opening:'로그인 준비 중',login:'로그인해 주세요',collecting:'자동 수집 중',complete:'선택 날짜 조회 완료',partial:'일부 수집',adapter_pending:'회원 조회 연동 검증 필요',error:'자동 조회 실패',stopped:'날짜 변경 반영 중'};
type Props={signedIn:boolean;upload:()=>void;requestedDates:string[];onDatesChange:(days:string[])=>void;skipCaptures:()=>string[];onCapture:(packet:unknown,id:string)=>Promise<void>;onProgress?:(working:boolean)=>void};
export function TripCollection({signedIn,requestedDates,onDatesChange,skipCaptures,onCapture,onProgress}:Props){
 const [status,setStatus]=useState<CollectionStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[settledDates,setSettledDates]=useState<string[]>(requestedDates);
 const [statusUpdatedAt,setStatusUpdatedAt]=useState<string|null>(null),[pollError,setPollError]=useState('');
 const latest=useRef({status,skipCaptures,onCapture,statusUpdatedAt,pollError,onProgress});latest.current={status,skipCaptures,onCapture,statusUpdatedAt,pollError,onProgress};
 const windows=useRef(new Map<string,Window>()),polling=useRef(false),acting=useRef(false),requests=useRef(new Map<string,string>());
 const selectedKey=requestedDates.join(',');
 useEffect(()=>{requests.current.clear();const timer=setTimeout(()=>setSettledDates(requestedDates),1800);return()=>clearTimeout(timer);},[selectedKey]);
 useEffect(()=>{if(!signedIn)return;const controller=new AbortController();
  async function poll(){if(polling.current)return;polling.current=true;try{
   const skip=latest.current.skipCaptures().slice(-200).join(',');const response=await fetch('/api/collection'+(skip?'?skip='+encodeURIComponent(skip):''),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
   const value=await response.json() as CollectionStatus&{error?:string};if(!response.ok)throw new Error(value.error||'연결 상태를 불러오지 못했습니다.');
   if(controller.signal.aborted)return;setStatus(value);setStatusUpdatedAt(new Date().toISOString());setPollError('');
   latest.current.onProgress?.(value.connections.some(item=>['queued','opening','login','collecting'].includes(item.state)||item.pending>0));
   for(const item of value.connections){const popup=windows.current.get(item.providerId);if(popup&&item.connected){popup.close();windows.current.delete(item.providerId);}}
   for(const capture of value.captures||[]){if(controller.signal.aborted)break;await latest.current.onCapture(capture.packet,'server:'+capture.providerId+':'+capture.captureId);}
  }catch{if(!controller.signal.aborted)setPollError('연결 상태 확인이 지연되고 있습니다. 자동으로 다시 확인합니다.');}finally{polling.current=false;}}
  void poll();const timer=setInterval(()=>void poll(),3000);return()=>{controller.abort();clearInterval(timer);};
 },[signedIn]);
 async function action(body:Record<string,unknown>){
  const response=await fetch('/api/collection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
  const value=await response.json() as Partial<CollectionStatus>&{error?:string};if(!response.ok)throw new Error(value.error||'연결 요청을 처리하지 못했습니다.');
  const failed=value.connections?.find(item=>item.error);if(failed)throw new Error(failed.error);
  if(value.connections)setStatus(current=>current?{...current,connections:current.connections.map(item=>value.connections!.find(next=>next.providerId===item.providerId)||item)}:current);
 }
 useEffect(()=>{
  if(!signedIn||!status?.configured||acting.current)return;const plan=collectionPlan(status.connections,settledDates);if(!plan.start.length&&!plan.stop.length)return;
  const key=settledDates.join(',')+'|'+plan.start.join(',')+'|'+plan.stop.join(',');const jobId=requests.current.get(key)||crypto.randomUUID();requests.current.set(key,jobId);
  acting.current=true;setBusy(true);setError('');
  void(async()=>{try{if(plan.stop.length)await action({action:'stop',providers:plan.stop});if(plan.start.length)await action({action:'start',providers:plan.start,requestedDates:settledDates,consent:false,jobId});}catch(err){setError((err as Error).message);}finally{acting.current=false;setBusy(false);}})();
 },[signedIn,status,settledDates]);
 async function login(providerId:string){
  if(!signedIn){location.href='/signin-with-chatgpt?return_to=/';return;}if(!requestedDates.length)return;
  const connection=status?.connections.find(item=>item.providerId===providerId);
  const popup=window.open('/service-login?provider='+encodeURIComponent(providerId),'chuljang-login-'+providerId,'popup,width=1120,height=850');if(popup)windows.current.set(providerId,popup);
  if(connection&&['login','opening','queued'].includes(connection.state))return;
  setBusy(true);setError('');try{await action({action:'start',providers:[providerId],requestedDates,consent:true,jobId:crypto.randomUUID()});}catch(err){popup?.close();setError((err as Error).message);}finally{setBusy(false);}
 }
 async function retry(providerId:string){
  if(acting.current)return;acting.current=true;setBusy(true);setError('');
  try{await action({action:'start',providers:[providerId],requestedDates,consent:false,jobId:crypto.randomUUID()});}catch(err){setError((err as Error).message);}finally{acting.current=false;setBusy(false);}
 }
 useEffect(()=>{
  type Tool={name:string;title:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean;untrustedContentHint:boolean};execute:(input:unknown)=>unknown};
  const context=(document as Document&{modelContext?:{registerTool:(tool:Tool,options:{signal:AbortSignal})=>void|Promise<void>}}).modelContext;if(!context?.registerTool)return;const lifecycle=new AbortController();
  try{void Promise.resolve(context.registerTool({name:'collection_status',title:'자동 수집 진행 상태',description:'서비스 연결과 날짜별 수집 상태를 읽습니다. 마지막 확인 시각과 연결 오류를 포함하며 로그인 링크·비밀번호·영수증 원문은 반환하지 않습니다.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('빈 객체를 입력하세요.');return {configured:latest.current.status?.configured||false,statusUpdatedAt:latest.current.statusUpdatedAt,pollError:latest.current.pollError,connections:(latest.current.status?.connections||[]).map(({loginUrl,...item})=>item)};}},{signal:lifecycle.signal})).catch(()=>{});}catch{}return()=>lifecycle.abort();
 },[]);
return <><section className="date-journey" aria-labelledby="date-heading">
    <ol className="journey-steps"><li className={signedIn?'done':''}>01 로그인</li><li className="active">02 출장 날짜 선택</li><li>03 자동 조회·저장</li></ol>
    <div className="date-content"><div className="date-copy"><span className="eyebrow">WHEN DID YOU TRAVEL?</span><h2 id="date-heading">출장 다녀온 날만<br/>골라주세요.</h2><p>하루씩 눌러 여러 날짜를 선택하세요.<br/>날짜가 바뀌면 연결된 서비스에서 자동으로 조회합니다.</p>
      <div className="selected-days" aria-live="polite"><strong>{requestedDates.length ? requestedDates.length+'일 선택됨' : '아직 선택한 날짜가 없어요'}</strong><div>{requestedDates.map(day=><button key={day}  onClick={()=>onDatesChange(requestedDates.filter(value=>value!==day))} aria-label={day+' 선택 해제'}>{day.slice(5).replace('-', '. ')} <span aria-hidden="true">×</span></button>)}</div></div>
      {!!requestedDates.length && <button className="clear-days"  onClick={()=>onDatesChange([])}>날짜 선택 초기화</button>}
    </div><div className="trip-calendar"><Calendar mode="multiple" locale={ko} weekStartsOn={1} selected={requestedDates.map(day=>new Date(day+'T12:00:00'))} onSelect={days=>onDatesChange((days||[]).map(day=>format(day,'yyyy-MM-dd')).sort())} max={62} disabled={{after:new Date()}} captionLayout="dropdown" startMonth={new Date(2020,0)} endMonth={new Date()} labels={{labelNext:()=> '다음 달',labelPrevious:()=> '이전 달'}}/><p>최대 62일 · 선택하지 않은 날짜는 제외</p></div></div>


  </section><section className="connected-transit" aria-label="교통 서비스 로그인"><div className="transit-heading"><div><span className="eyebrow">CONNECT ONCE</span><h2>사용한 서비스에 로그인하세요.</h2><p>로그인 성공을 자동 감지합니다. 다음 방문에는 연결 상태를 재사용해요.</p></div>{busy&&<span className="auto-indicator"><LoaderCircle size={16} className="animate-spin"/> 날짜 반영 중</span>}</div>
 <div className="transit-connections">{SOURCES.filter(source=>primaryServices.includes(source.id)).map(provider=>{const item=status?.connections.find(connection=>connection.providerId===provider.id),state=item?.state||'disconnected',Icon=provider.id==='korail'?TrainFront:provider.id==='hipass'?CarFront:BusFront;
 return <article className={'transit-card provider-'+provider.id} key={provider.id}><div className="transit-card-title"><span className="transit-symbol"><Icon size={25}/></span><div><h3>{provider.name}</h3><span className={'connection-state state-'+state}>{labels[state]||state}</span></div></div><p>{item?.note||(provider.id==='tmoneyTransit'?'등록된 티머니 카드의 지하철·시내버스 이용내역':'로그인 후 선택한 날짜를 자동으로 조회합니다.')}</p>
 {!item?.connected?<Button disabled={busy||!requestedDates.length||(signedIn&&!status?.configured)} onClick={()=>void login(provider.id)}><LogIn size={16}/> 로그인</Button>:<div className="connected-label"><Check size={17}/> 로그인 연결됨{item.count?' · '+item.count+'건':''}</div>}
 {item?.loginUrl&&<a className="login-fallback" href={item.loginUrl} target="_blank" rel="noopener noreferrer">로그인 창 다시 열기 <ArrowUpRight size={13}/></a>}
 {item?.connected&&['error','partial'].includes(state)&&<Button disabled={busy||!requestedDates.length} onClick={()=>void retry(provider.id)}>조회 다시 시도</Button>}
 {item?.consentedAt&&<button className="disconnect-service" disabled={busy} onClick={()=>void action({action:'disconnect',providers:[provider.id]}).catch(err=>setError(err.message))}><Unplug size={12}/> 연결 해제</button>}</article>;})}</div>
 <p className="consent-note">서비스 로그인은 선택한 출장일 내역 조회와 로그인 상태 암호화 보관에 동의하는 과정입니다. 연결은 언제든 해제할 수 있어요.</p>
 <p className="transit-availability">티머니는 등록된 카드만 조회됩니다. 오늘·어제 내역은 아직 제공되지 않을 수 있으며, 신용·체크카드 후불교통은 카드사 내역이 필요합니다.</p>
 {pollError&&<p className="chrome-error" role="status">{pollError}</p>}{error&&<p className="chrome-error" role="alert">{error}</p>}</section></>;
}
