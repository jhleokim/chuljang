'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, BriefcaseBusiness, BusFront, CarFront, Check, CircleHelp, CreditCard, FileText, Plane, Plus, TrainFront, Wallet, Upload, Puzzle, X, LoaderCircle, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { candidateSchema, exportCsv, parseReceipt, sourceIds, sourceNames, tripSchema, type Receipt, type Source, type Trip } from '@/lib/receipts';
import { providers } from '@/lib/providers';
import { readReceiptFile } from '@/lib/read-file';
import { draftErrors, type Draft } from '@/lib/draft-review';
import { ReceiptOriginal, ReceiptReview } from '@/components/receipt-review';
const icons={ktx:TrainFront,kakaot:CarFront,tmoney:BusFront,airline:Plane,socar:CarFront};

type Packet={source:Source;blocks:string[];sourceUrl?:string};
const format=(n:number)=>new Intl.NumberFormat('ko-KR').format(n);
async function api<T>(path:string,init?:RequestInit):Promise<T>{
 const r=await fetch(path,init);const body:unknown=await r.json();if(!r.ok)throw new Error(body&&typeof body==='object'&&'error' in body?String(body.error):'처리하지 못했습니다.');return body as T;
}
function packetValue(value:unknown):Packet{
 if(!value||typeof value!=='object')throw new Error('수집 파일 형식이 올바르지 않습니다.');
 const p=value as Record<string,unknown>;
 if(!sourceIds.includes(p.source as Source)||!Array.isArray(p.blocks)||!p.blocks.length||p.blocks.length>100||p.blocks.some(x=>typeof x!=='string'||x.length>12000))throw new Error('유효한 수집 데이터가 아닙니다. 한 번에 100건까지 가져올 수 있어요.');
 if(typeof p.sourceUrl==='string'&&p.sourceUrl.length>2000)throw new Error('원본 주소가 너무 깁니다. 주소 없이 다시 가져와 주세요.');
 return {source:p.source as Source,blocks:p.blocks as string[],sourceUrl:typeof p.sourceUrl==='string'?p.sourceUrl:''};
}
export default function Workspace({signedIn}:{signedIn:boolean}) {
 const [receipts,setReceipts]=useState<Receipt[]>([]),[trips,setTrips]=useState<Trip[]>([]);
 const [loading,setLoading]=useState(signedIn),[loadError,setLoadError]=useState('');
 const [modal,setModal]=useState<'collect'|'trip'|'edit'|'signin'|null>(null),[source,setSource]=useState<Source>('ktx');
 const [method,setMethod]=useState('file'),[text,setText]=useState(''),[drafts,setDrafts]=useState<Draft[]>([]),[files,setFiles]=useState<File[]>([]);
 const [busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[importErrors,setImportErrors]=useState<string[]>([]);
 const [filter,setFilter]=useState('all'),[tripFilter,setTripFilter]=useState('all'),[statusFilter,setStatusFilter]=useState('all');
 const [tripName,setTripName]=useState(''),[startDate,setStartDate]=useState(''),[endDate,setEndDate]=useState('');
 const [editing,setEditing]=useState<Receipt|null>(null);
 const [draftIndex,setDraftIndex]=useState(0),[discard,setDiscard]=useState<'all'|string|null>(null);
 const [original,setOriginal]=useState<Blob|undefined>(),[originalLoading,setOriginalLoading]=useState(false);
 const [fileProgress,setFileProgress]=useState({current:0,total:0,name:''});
 const importController=useRef<AbortController|null>(null);
 const workflow=useRef({busy,draftCount:drafts.length,text});workflow.current={busy:busy||modal==='edit'||modal==='trip',draftCount:drafts.length,text};
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};if(drafts.length||text.trim()||busy)window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[drafts.length,text,busy]);
 useEffect(()=>()=>importController.current?.abort(),[]);
 useEffect(()=>{
  if(modal!=='edit'||!editing)return;
  const controller=new AbortController();setOriginal(undefined);setOriginalLoading(true);
  void Promise.all([
   api<{raw:string}>('/api/receipts/'+editing.id,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setEditing(value=>value?{...value,raw:data.raw}:null);}),
   editing.hasAttachment?fetch('/api/receipts/'+editing.id+'/attachment',{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error('원본을 불러오지 못했습니다.');const blob=await response.blob();if(!controller.signal.aborted)setOriginal(blob);}):Promise.resolve()
  ]).catch(()=>{if(!controller.signal.aborted)toast.error('원본을 불러오지 못했습니다. 다시 열어 주세요.');}).finally(()=>{if(!controller.signal.aborted)setOriginalLoading(false);});
  return()=>controller.abort();
 },[modal,editing?.id]);
 const inputRef=useRef<HTMLInputElement>(null),packetRef=useRef<HTMLInputElement>(null);
 const pageState=useRef({receipts,trips});pageState.current={receipts,trips};
 const refresh=useCallback(async()=>{if(!signedIn)return;setLoading(true);setLoadError('');try{const [rs,ts]=await Promise.all([api<Receipt[]>('/api/receipts'),api<Trip[]>('/api/trips')]);setReceipts(rs);setTrips(ts);}catch(e){setLoadError((e as Error).message);}finally{setLoading(false);}},[signedIn]);
 useEffect(()=>{void refresh();},[refresh]);
 const stage=useCallback((p:Packet)=>{
  if(!signedIn)throw new Error('먼저 로그인한 뒤 가져와 주세요.');
  if(workflow.current.busy||workflow.current.draftCount||workflow.current.text.trim())throw new Error('검토 중인 내역이 있어요. 저장하거나 비운 뒤 다시 가져와 주세요.');
  workflow.current.draftCount=p.blocks.length;setDraftIndex(0);
  const rows=p.blocks.map(block=>({...parseReceipt(block,p.source),sourceUrl:p.sourceUrl||'',key:crypto.randomUUID()}));
  setSource(p.source);setDrafts(rows);setFiles([]);setImportErrors([]);setModal('collect');setMethod('text');
  return rows.length;
 },[signedIn]);
 useEffect(()=>{
  const receive=(event:MessageEvent)=>{
   if(event.source===window&&event.origin===location.origin&&event.data?.type==='CHULJANG_BRIDGE_READY'){if(signedIn)window.postMessage({type:'CHULJANG_READY'},location.origin);return;}
   if(event.source!==window||event.origin!==location.origin||event.data?.type!=='CHULJANG_COLLECTED')return;
   if(!signedIn)return;
   try{const p=packetValue(event.data.packet);stage(p);window.postMessage({type:'CHULJANG_STAGED',captureId:event.data.captureId},location.origin);toast.success('수집한 내역을 확인해 주세요. 아직 저장되지 않았습니다.');}catch(e){toast.error((e as Error).message);}
  };
  window.addEventListener('message',receive);if(signedIn)window.postMessage({type:'CHULJANG_READY'},location.origin);
  return ()=>window.removeEventListener('message',receive);
 },[stage,signedIn]);
 useEffect(()=>{
  type Tool={name:string;title:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean;untrustedContentHint:boolean};execute:(input:unknown)=>unknown|Promise<unknown>};
  const context=(document as Document&{modelContext?:{registerTool:(tool:Tool,options:{signal:AbortSignal})=>void|Promise<void>}}).modelContext;
  if(!context?.registerTool)return;const lifecycle=new AbortController();
  const tools:Tool[]=[
   {name:'list_receipts',title:'영수증 목록 조회',description:'현재 로그인한 사용자의 화면에 불러온 영수증과 출장 목록을 반환합니다. 원본 파일은 반환하지 않습니다.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){if(!input||typeof input!=='object'||Object.keys(input).length)throw new Error('빈 객체를 입력하세요.');return pageState.current;}},
   {name:'stage_receipt_text',title:'수집 내역 검토 준비',description:'서비스 영수증 텍스트를 인식해 검토 창을 엽니다. 저장하지 않습니다. 사용자가 검토 후 저장합니다.',inputSchema:{type:'object',properties:{source:{type:'string',enum:sourceIds},blocks:{type:'array',items:{type:'string'},minItems:1,maxItems:100}},required:['source','blocks'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},async execute(input){const p=packetValue(input);const count=stage(p);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));return {staged:count,saved:false};}},
  ];
  for(const tool of tools){try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{/* Browsers without WebMCP still use the same interface. */}}
  return ()=>lifecycle.abort();
 },[stage]);
 function openCollect(id:Source=source,selectedMethod='file'){
  if(busy)return;if(!signedIn){setModal('signin');return;}
  if(!drafts.length&&!text.trim()){setSource(id);setMethod(selectedMethod);}
  setModal('collect');
 }
 function clearDrafts(){
  const next=discard==='all'?[]:drafts.filter(row=>row.key!==discard);
  workflow.current.draftCount=next.length;setDrafts(next);setDraftIndex(i=>Math.min(i,Math.max(0,next.length-1)));
  if(!next.length){setFiles([]);setText('');workflow.current.text='';setImportErrors([]);}
  setDiscard(null);
 }
 function parseText(){if(busy)return;setDraftIndex(0);if(!text.trim()){toast.error('영수증 텍스트를 붙여넣어 주세요.');return;}setDrafts(text.split(/\n\s*---+\s*\n/).slice(0,100).map(block=>({...parseReceipt(block,source),key:crypto.randomUUID()})));setFiles([]);setImportErrors([]);}
 async function readFiles(chosen:FileList|null){
  if(!chosen?.length||workflow.current.busy)return;const selected=Array.from(chosen).map(file=>!file.type&&/\.pdf$/i.test(file.name)?new File([file],file.name,{type:'application/pdf',lastModified:file.lastModified}):file);
  if(selected.length>20||selected.reduce((n,f)=>n+f.size,0)>12*1024*1024){toast.error('합계 12MB, 20개 이하로 선택해 주세요.');return;}
  setBusy(true);workflow.current.busy=true;setDraftIndex(0);setImportErrors([]);const rows:Draft[]=[];const errors:string[]=[];const accepted:File[]=[];const controller=new AbortController();importController.current=controller;
  try{for(let i=0;i<selected.length;i++){try{
   if(controller.signal.aborted)break;
   setFileProgress({current:i+1,total:selected.length,name:selected[i].name});setProgress('파일을 준비하는 중…');
   const pages=await readReceiptFile(selected[i],setProgress,controller.signal);
   if(controller.signal.aborted)break;
   const attachmentIndex=accepted.length;accepted.push(selected[i]);
   const remaining=100-rows.length;
   for(const page of pages.slice(0,remaining)){const parsed=parseReceipt(page.text,source);rows.push({...parsed,key:crypto.randomUUID(),attachmentIndex,pageNumber:page.pageNumber,issues:[...parsed.issues,...(page.warning?[page.warning]:[])]});}
   if(pages.length>remaining||(rows.length===100&&i<selected.length-1)){errors.push('먼저 읽은 100건을 가져왔어요. 남은 페이지·파일은 다음에 나누어 가져와 주세요.');break;}
  }catch(e){if(controller.signal.aborted)break;errors.push(selected[i].name+': '+(e as Error).message);}}
  setFiles(accepted);setDrafts(rows);workflow.current.draftCount=rows.length;setImportErrors(errors);if(controller.signal.aborted)toast.info(rows.length?'인식을 중단했어요. 완료된 '+rows.length+'건은 검토할 수 있어요.':'인식을 취소했어요. 파일을 다시 선택할 수 있어요.');
  if(!controller.signal.aborted&&!rows.length&&!errors.length)toast.error('읽을 수 있는 영수증이 없습니다.');
  }catch(e){toast.error((e as Error).message);}finally{importController.current=null;workflow.current.busy=false;setBusy(false);setProgress('');if(inputRef.current)inputRef.current.value='';}
 }
 async function readPacket(chosen:File|null){if(!chosen)return;try{if(chosen.size>1500000)throw new Error('수집 파일이 너무 큽니다.');stage(packetValue(JSON.parse(await chosen.text())));}catch(e){toast.error((e as Error).message);}finally{if(packetRef.current)packetRef.current.value='';}}
 function updateDraft(key:string,patch:Partial<Draft>){setDrafts(rows=>rows.map(r=>r.key===key?{...r,...patch}:r));}
 async function saveDrafts(){
  if(busy||!drafts.length)return;
  if(!signedIn){toast.error('로그인 후 저장할 수 있습니다.');return;}
  const parsed=drafts.map(r=>candidateSchema.safeParse(r));const invalid=parsed.findIndex(r=>!r.success);if(invalid!==-1){setDraftIndex(invalid);const field=Object.keys(draftErrors(drafts[invalid]))[0];requestAnimationFrame(()=>document.getElementById('draft-'+field)?.focus());toast.error((invalid+1)+'번째 영수증의 표시된 항목을 입력해 주세요.');return;}
  setBusy(true);workflow.current.busy=true;try{const body=new FormData();body.set('receipts',JSON.stringify(parsed.map(r=>r.data)));files.forEach(file=>body.append('files',file));const result=await api<{imported:number;duplicates:number}>('/api/receipts',{method:'POST',body});toast.success(result.imported+'건 저장'+(result.duplicates?' · 동일 내역 '+result.duplicates+'건 제외':''));setDrafts([]);setFiles([]);setText('');workflow.current={busy:true,draftCount:0,text:''};setModal(null);await refresh();}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}
 }
 async function createTrip(event:React.FormEvent){
  event.preventDefault();if(!signedIn){toast.error('로그인 후 저장할 수 있습니다.');return;}
  const parsed=tripSchema.safeParse({name:tripName,startDate,endDate});if(!parsed.success){toast.error('출장명과 기간을 확인해 주세요.');return;}
  setBusy(true);try{await api('/api/trips',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(parsed.data)});setModal(null);setTripName('');setStartDate('');setEndDate('');await refresh();toast.success('출장이 등록되었습니다. 기존 내역은 영수증 수정에서 연결하세요.');}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}
 }
 async function saveEdit(event:React.FormEvent){
  event.preventDefault();if(!editing)return;setBusy(true);
  try{await api('/api/receipts/'+editing.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...editing,reviewed:!!editing.reviewed})});setModal(null);await refresh();toast.success('영수증이 수정되었습니다.');}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}
 }
 const displayed=receipts.filter(r=>(filter==='all'||r.source===filter)&&(tripFilter==='all'||(tripFilter==='none'?!r.tripId:r.tripId===tripFilter))&&(statusFilter==='all'||!r.reviewed));
 const total=receipts.reduce((n,r)=>n+r.amount,0),review=receipts.filter(r=>!r.reviewed).length;
 const hasFilters=filter!=='all'||tripFilter!=='all'||statusFilter!=='all';
 function resetFilters(){setFilter('all');setTripFilter('all');setStatusFilter('all');}
 const provider=providers.find(p=>p.id===source)!;
 function download(){const blob=new Blob([exportCsv(displayed,trips)],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='출장_정산내역_'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <div className="app-shell">
  <Toaster theme="light" richColors position="top-center"/>
  <header className="topbar"><a className="brand" href="/"><span className="brand-icon"><BriefcaseBusiness size={21}/></span>출장<span className="brand-en">CHULJANG</span></a><div className="topbar-right"><span className="private-label">나의 정산 공간</span>{signedIn?<span className="avatar">나</span>:<a className="signin-link" href="/signin-with-chatgpt?return_to=/" target="_top">로그인</a>}</div></header>
  <main className="workspace"><div className="page-heading"><div><p className="eyebrow">TRAVEL EXPENSES</p><h1>출장 영수증</h1><p className="subheading">이동은 가볍게. 영수증은 한곳에.</p></div><Button className="primary-button" onClick={()=>openCollect()}><Plus size={18}/> 영수증 가져오기</Button></div>
  {!signedIn&&<div className="notice">가져온 영수증을 내 공간에 보관할 수 있도록 먼저 <a href="/signin-with-chatgpt?return_to=/" target="_top">로그인해 주세요.</a></div>}
  {loadError&&<div className="notice error" role="alert"><span>{loadError}</span><Button variant="outline" size="sm" onClick={()=>void refresh()}>다시 불러오기</Button></div>}
  {(drafts.length>0||text.trim())&&<div className="resume-banner"><div><FileText size={21}/><span><strong>{drafts.length?drafts.length+'건 검토 중':'작성 중인 영수증이 있어요'}</strong><small>이 화면에서 잠시 보관 중 · 새로고침하면 사라져요</small></span></div><Button variant="outline" onClick={()=>openCollect()}>이어서 검토 <ArrowUpRight size={16}/></Button></div>}
  <div className="summary-grid"><div className="summary-card"><span>모은 영수증</span><strong>{loading?<Skeleton className="h-9 w-20"/>:format(receipts.length)}<small>건</small></strong><FileText/></div><div className="summary-card"><span>총 지출 · KRW</span><strong>{loading?<Skeleton className="h-9 w-28"/>:format(total)}<small>원</small></strong><Wallet/></div><button className="summary-card review-summary" onClick={()=>{setStatusFilter('review');document.getElementById('receipt-ledger')?.scrollIntoView({behavior:'smooth',block:'start'});}}><span>검토할 내역 <ArrowUpRight size={13}/></span><strong>{loading?<Skeleton className="h-9 w-20"/>:format(review)}<small>건</small></strong><CreditCard/></button></div>
  <section className="collection-bar"><div className="collection-intro"><span className="collection-mark"><ArrowDownToLine size={22}/></span><div><h2>가져오기 → 확인하기 → 출장별 정리</h2><p>영수증 사진이나 PDF만 있으면 날짜와 금액을 읽어드려요.</p></div></div><Button variant="outline" onClick={()=>openCollect(source,'web')}>웹 수집 안내 <ArrowUpRight size={16}/></Button></section>
  <section className="source-grid" aria-label="수집 서비스">{providers.map(p=>{const Icon=icons[p.id];const count=receipts.filter(r=>r.source===p.id).length;return <button key={p.id} className="source-card" onClick={()=>openCollect(p.id,p.id==='kakaot'||p.id==='socar'?'file':'web')}><div className="source-top"><Icon size={23} style={{color:p.color}}/><span>{p.mode}</span></div><strong>{p.name}</strong><p>{count?count+'건 보관 중':'수집 방법 보기'} <ArrowUpRight size={14}/></p></button>;})}</section>
  <div className="content-grid"><section className="ledger" id="receipt-ledger"><Tabs value={statusFilter} onValueChange={setStatusFilter}><div className="ledger-heading"><TabsList variant="line"><TabsTrigger value="all">전체 영수증 <span className="count">{receipts.length}</span></TabsTrigger><TabsTrigger value="review">검토 필요 <span className="count">{review}</span></TabsTrigger></TabsList><Button variant="ghost" disabled={!displayed.length} onClick={download}><ArrowDownToLine size={16}/> CSV 내보내기</Button></div>
  <div className="filterbar"><Select value={filter} onValueChange={setFilter}><SelectTrigger aria-label="서비스 필터"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">전체 서비스</SelectItem>{providers.map(p=><SelectItem value={p.id} key={p.id}>{p.name}</SelectItem>)}</SelectContent></Select><Select value={tripFilter} onValueChange={setTripFilter}><SelectTrigger aria-label="출장 필터"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">모든 출장</SelectItem><SelectItem value="none">미분류</SelectItem>{trips.map(t=><SelectItem value={t.id} key={t.id}>{t.name}</SelectItem>)}</SelectContent></Select>{hasFilters&&<Button variant="ghost" size="sm" onClick={resetFilters}><X size={14}/> 초기화</Button>}{displayed.length>0&&<span className="filtered-total">{displayed.length}건 · {format(displayed.reduce((n,r)=>n+r.amount,0))}원</span>}</div>
  {loading?<div className="loading-rows">{[1,2,3].map(n=><Skeleton key={n} className="h-12 w-full"/>)}</div>:displayed.length?<><div className="mobile-receipts">{displayed.map(r=>{const Icon=icons[r.source];return <button className="mobile-receipt" key={r.id} onClick={()=>{setEditing({...r});setModal('edit');}}><span className="mobile-receipt-top"><span className={'service-icon '+r.source}><Icon size={18}/></span><span className="mobile-receipt-title"><strong>{r.merchant}</strong><small>{sourceNames[r.source]} · {r.date}</small></span><ArrowUpRight size={17}/></span><span className="mobile-receipt-bottom"><span className={r.reviewed?'badge verified':'badge pending'}>{r.reviewed?'확인 완료':'검토 필요'}</span><strong>{format(r.amount)}<small> 원</small></strong><span className="mobile-review-label">{r.reviewed?'보기':'검토'} →</span></span>{r.tripId&&<span className="mobile-trip">{trips.find(t=>t.id===r.tripId)?.name}</span>}</button>;})}</div><div className="desktop-receipts"><Table className="receipt-table"><TableHeader><TableRow><TableHead>이용내역</TableHead><TableHead>이용일</TableHead><TableHead>금액</TableHead><TableHead>상태</TableHead><TableHead><span className="sr-only">수정</span></TableHead></TableRow></TableHeader><TableBody>{displayed.map(r=>{const Icon=icons[r.source];return <TableRow key={r.id}><TableCell><div className="merchant-cell"><span className={'service-icon '+r.source}><Icon size={18}/></span><div><strong>{r.merchant}</strong><span>{sourceNames[r.source]}{r.tripId?' · '+(trips.find(t=>t.id===r.tripId)?.name||''):''}</span></div></div></TableCell><TableCell className="date-cell">{r.date}</TableCell><TableCell className="amount-cell">{format(r.amount)}<small> 원</small></TableCell><TableCell><span className={r.reviewed?'badge verified':'badge pending'}>{r.reviewed?'확인 완료':'검토 필요'}</span></TableCell><TableCell><button aria-label={r.merchant+' 영수증 수정'} className="edit-button" onClick={()=>{setEditing({...r});setModal('edit');}}><Pencil size={15}/><span>{r.reviewed?'보기':'검토'}</span></button></TableCell></TableRow>;})}</TableBody></Table></div></>:<Empty className="receipt-empty"><EmptyHeader><EmptyMedia variant="icon"><FileText/></EmptyMedia><EmptyTitle>{receipts.length?'조건에 맞는 영수증이 없어요':'첫 영수증을 모아볼까요?'}</EmptyTitle><EmptyDescription>{receipts.length?'서비스·출장·검토 필터를 변경해 보세요.':<>승차권부터 택시비까지, 가져온 내역을<br/>출장별로 정리할 수 있어요.</>}</EmptyDescription></EmptyHeader><Button onClick={()=>receipts.length?resetFilters():openCollect()}>{receipts.length?'필터 초기화':'영수증 가져오기'} {receipts.length?<X size={16}/>:<Plus size={16}/>}</Button></Empty>}</Tabs></section>
  <aside className="trip-panel"><div className="section-heading"><h2>나의 출장</h2><button aria-label="출장 등록" onClick={()=>setModal('trip')}><Plus size={20}/></button></div><p>출장 기간을 등록하면 새로 가져오는 영수증을 이용 날짜에 맞춰 모아줍니다.</p>{trips.length?<div className="trip-list">{trips.map(t=><button className={tripFilter===t.id?'trip-card selected':'trip-card'} onClick={()=>setTripFilter(tripFilter===t.id?'all':t.id)} key={t.id}><span><BriefcaseBusiness size={16}/>{t.name}</span><small>{t.startDate} ~ {t.endDate}</small><strong>{format(receipts.filter(r=>r.tripId===t.id).reduce((n,r)=>n+r.amount,0))}<em>원</em></strong></button>)}<Button variant="outline" onClick={()=>setModal('trip')}><Plus size={16}/> 출장 등록</Button></div>:<div className="trip-placeholder"><span>아직 등록한 출장이 없어요</span><Button variant="outline" onClick={()=>setModal('trip')}><Plus size={16}/> 출장 등록</Button></div>}<div className="tip"><Check size={17}/><span>겹치는 출장 기간은 자동 분류하지 않아요.<br/>검토 후 직접 선택해 주세요.</span></div></aside></div>
  <footer><span>CHULJANG · 출장의 마지막을 가볍게</span><button onClick={()=>openCollect(source,'web')}><CircleHelp size={15}/> 수집 안내</button></footer></main>
  <Dialog open={modal==='collect'} onOpenChange={open=>{if(!busy)setModal(open?'collect':null);}}><DialogContent className={'collect-dialog '+(drafts.length?'has-review':'')} onInteractOutside={event=>event.preventDefault()}><DialogTitle>{drafts.length?'가져온 영수증 확인':'영수증 가져오기'}</DialogTitle><DialogDescription>{drafts.length?'원본을 보며 내용을 확인하세요. 저장 전까지는 이 화면에서만 보관합니다.':'사진·PDF를 올리거나, 서비스에서 수집한 이용내역을 가져오세요.'}</DialogDescription>
   <ol className="import-steps" aria-label="수집 단계"><li className={!drafts.length?'active':'complete'}>{drafts.length?<Check size={14}/>:<b>1</b>} 가져오기</li><li className={drafts.length?'active':''}><b>2</b> 확인하고 저장</li></ol>
   {!drafts.length&&<label className="source-field">어느 서비스의 영수증인가요?<Select value={source} disabled={busy} onValueChange={v=>setSource(v as Source)}><SelectTrigger aria-label="수집 서비스" className="w-full"><SelectValue/></SelectTrigger><SelectContent>{providers.map(p=><SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></label>}
   {!drafts.length&&<Tabs value={method} onValueChange={v=>{if(!busy)setMethod(v);}}><TabsList className="method-tabs"><TabsTrigger value="file" disabled={busy}><Upload size={15}/> 사진 · PDF</TabsTrigger><TabsTrigger value="web" disabled={busy}><Puzzle size={15}/> 웹 수집</TabsTrigger><TabsTrigger value="text" disabled={busy}><FileText size={15}/> 텍스트</TabsTrigger></TabsList>
   <TabsContent value="web"><div className="guide-card"><h3>{provider.name} 수집 방법</h3><ol>{provider.steps.map((s,i)=><li key={s}><b>{i+1}</b><span>{s}</span></li>)}</ol><p>{provider.note}</p><a href={provider.url} target="_blank" rel="noreferrer" className="official-link">공식 사이트·안내 열기 <ArrowUpRight size={15}/></a></div>
   <div className="extension-box"><div><Puzzle size={20}/><strong>브라우저 수집 도구</strong><span className="badge">실험 기능</span></div><p>Chrome에서 열린 영수증 페이지를 읽어 이곳의 검토 목록으로 보냅니다. 로그인·페이지 이동은 직접 진행해 주세요.</p><a className="download-extension" href="/chuljang-collector.zip" download><ArrowDownToLine size={16}/> 수집 도구 다운로드</a><details><summary>설치 방법</summary><ol><li>압축파일을 풀어 주세요.</li><li>Chrome 확장 프로그램 관리에서 개발자 모드를 켜고 ‘압축해제된 확장 프로그램을 로드합니다’를 선택하세요.</li><li>압축을 푼 폴더를 선택한 후, 영수증 페이지에서 확장 아이콘을 누르세요.</li></ol><p>현재 탭만 읽습니다. 로그인 정보·카드번호를 보관하지 않습니다. 웹 페이지 구조에 따라 인식이 안 될 수 있어요.</p></details></div><button className="text-button" onClick={()=>packetRef.current?.click()}>이미 받은 수집 파일(.json) 가져오기</button></TabsContent>
   <TabsContent value="file"><label className={'upload-zone '+(busy?'is-busy':'')} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)void readFiles(e.dataTransfer.files);}}><Upload size={28}/><strong>사진·PDF를 선택해 주세요</strong><span>여기로 파일을 끌어놓아도 돼요</span><small>JPG · PNG · WEBP · PDF / 최대 20개 · 합계 12MB</small><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple disabled={busy} onChange={e=>void readFiles(e.target.files)}/></label><p className="muted upload-note">인식은 이 기기에서 처리됩니다. 저장할 때 원본과 추출 내역을 내 공간에 보관합니다. PDF는 파일당 12페이지까지 읽습니다.</p></TabsContent>
   <TabsContent value="text"><label className="field-label" htmlFor="receipt-text">영수증·거래확인증 텍스트</label><textarea id="receipt-text" className="receipt-text" rows={8} value={text} onChange={e=>setText(e.target.value)} maxLength={120000} placeholder={'예: 승차일 2026.09.11\n출발: 서울\n도착: 부산\n결제금액: 59,800원\n\n여러 영수증은 --- 줄로 나누어 주세요.'}/><Button onClick={parseText} className="w-full">날짜·금액 자동 인식</Button></TabsContent></Tabs>}
   <input ref={packetRef} className="sr-only" type="file" accept=".json,application/json" onChange={e=>void readPacket(e.target.files?.[0]||null)}/>
   {busy&&<div className="processing" role="status"><LoaderCircle className="animate-spin" size={19}/><div><strong>{importController.current?fileProgress.current+' / '+fileProgress.total+'개 파일 인식 중':'저장하는 중…'}</strong>{importController.current&&<><span>{fileProgress.name}</span><small>{progress}</small></>}</div>{importController.current&&<Button variant="outline" size="sm" onClick={()=>{importController.current?.abort();setProgress('인식을 중단하는 중…');}}>취소</Button>}</div>}
   {importErrors.length>0&&<div className="notice error" role="alert"><ul>{importErrors.map(s=><li key={s}>{s}</li>)}</ul></div>}
   {drafts.length>0&&<ReceiptReview drafts={drafts} files={files} index={draftIndex} setIndex={setDraftIndex} busy={busy} update={updateDraft} remove={key=>setDiscard(key)} clear={()=>setDiscard('all')} save={()=>void saveDrafts()}/>}
   {drafts.length>0&&<Button variant="ghost" disabled={busy} onClick={()=>setModal(null)}>나중에 이어서 검토</Button>}
  </DialogContent></Dialog>
  <Dialog open={discard!==null} onOpenChange={open=>{if(!open)setDiscard(null);}}><DialogContent><DialogTitle>{discard==='all'?'가져온 내역을 비울까요?':'이 영수증을 제외할까요?'}</DialogTitle><DialogDescription>{discard==='all'?'아직 저장하지 않은 내역과 수정사항이 사라집니다. 이미 저장한 영수증은 그대로 보관됩니다.':'이 내역은 이번 가져오기 목록에서 빠집니다. 필요하면 원본을 다시 가져올 수 있어요.'}</DialogDescription><div className="confirm-actions"><Button variant="outline" onClick={()=>setDiscard(null)}>계속 검토</Button><Button variant="destructive" onClick={clearDrafts}>{discard==='all'?'비우고 새로 가져오기':'제외하기'}</Button></div></DialogContent></Dialog>
  <Dialog open={modal==='signin'} onOpenChange={open=>setModal(open?'signin':null)}><DialogContent><DialogTitle>로그인하고 영수증을 모아보세요</DialogTitle><DialogDescription>먼저 로그인하면 가져온 영수증을 내 공간에 저장하고, 다음에도 이어서 정리할 수 있어요.</DialogDescription><Button asChild><a href="/signin-with-chatgpt?return_to=/" target="_top">로그인하고 시작하기 <ArrowUpRight size={16}/></a></Button></DialogContent></Dialog>
  <Dialog open={modal==='trip'} onOpenChange={open=>{if(!busy)setModal(open?'trip':null);}}><DialogContent><DialogTitle>출장 등록</DialogTitle><DialogDescription>기간을 등록하면 새 영수증을 자동으로 분류합니다.</DialogDescription><form onSubmit={createTrip} className="dialog-form"><label>출장명<input required maxLength={100} value={tripName} onChange={e=>setTripName(e.target.value)} placeholder="예: 부산 고객사 미팅"/></label><div className="form-grid"><label>시작일<input required type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></label><label>종료일<input required type="date" min={startDate} value={endDate} onChange={e=>setEndDate(e.target.value)}/></label></div><Button type="submit" disabled={busy||!signedIn}>출장 등록</Button>{!signedIn&&<a className="signin-link" href="/signin-with-chatgpt?return_to=/" target="_top">로그인 후 등록하기</a>}</form></DialogContent></Dialog>
  <Dialog open={modal==='edit'} onOpenChange={open=>{if(!busy)setModal(open?'edit':null);}}><DialogContent className="edit-dialog" onInteractOutside={event=>event.preventDefault()}><DialogTitle>영수증 검토</DialogTitle><DialogDescription>원본과 대조한 뒤 확인 완료로 표시해 주세요.</DialogDescription>{editing&&<div className="review-columns"><ReceiptOriginal file={original} raw={editing.raw} loading={originalLoading}/><form onSubmit={saveEdit} className="dialog-form"><div className="form-grid"><label>이용일<input required type="date" value={editing.date} onChange={e=>setEditing({...editing,date:e.target.value})}/></label><label>결제 금액 (원)<input required type="number" min={0} step="1" max={100000000} value={editing.amount} onChange={e=>setEditing({...editing,amount:Number(e.target.value)})}/></label></div><label>이용내역<input required maxLength={150} value={editing.merchant} onChange={e=>setEditing({...editing,merchant:e.target.value})}/></label><label>승인·예약번호<input maxLength={120} value={editing.reference} onChange={e=>setEditing({...editing,reference:e.target.value})}/></label><label>출장<Select value={editing.tripId||'none'} onValueChange={v=>setEditing({...editing,tripId:v==='none'?null:v})}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="none">미분류</SelectItem>{trips.map(t=><SelectItem value={t.id} key={t.id}>{t.name}</SelectItem>)}</SelectContent></Select></label><label className="check-label"><Checkbox checked={!!editing.reviewed} onCheckedChange={v=>setEditing({...editing,reviewed:v===true?1:0})}/> 원본과 대조했어요 · 확인 완료</label>{!!editing.hasAttachment&&<a className="official-link" href={'/api/receipts/'+editing.id+'/attachment'}><ArrowDownToLine size={16}/> 영수증 원본 다운로드</a>}<Button type="submit" disabled={busy}>수정 내용 저장</Button></form></div>}</DialogContent></Dialog>
 </div>;
}

