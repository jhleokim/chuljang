'use client';
import {useEffect,useState} from 'react';
import {Download,FileText,Mail,Settings2,LoaderCircle,Link2,Copy} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Checkbox} from '@/components/ui/checkbox';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {defaultReport,reportFields,fieldLabels,reportRows,reportFilename,mailComposeUrl,type ReportConfig} from '@/lib/report';
import type {Receipt,Trip} from '@/lib/receipts';
type Settings={config:ReportConfig;templateName:string|null};
type Share={id:string;filename:string;expiresAt:string};
async function json<T>(path:string,init?:RequestInit){const response=await fetch(path,init),value=await response.json() as {error?:string};if(!response.ok)throw new Error(value.error||'설정을 불러오지 못했습니다.');return value as T;}
function download(blob:Blob,name:string){const href=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=href;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(href),60000);}
export function ReportExport({signedIn,testMode=false,receipts,trips,dates,collecting,needsReview}:{signedIn:boolean;testMode?:boolean;receipts:Receipt[];trips:Trip[];dates:string[];collecting:boolean;needsReview:boolean}){
 const [settings,setSettings]=useState<Settings|null>(null),[config,setConfig]=useState<ReportConfig>(defaultReport),[template,setTemplate]=useState<File|null>(null),[reset,setReset]=useState(false),[sheets,setSheets]=useState<string[]>([]);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[link,setLink]=useState(''),[expiresAt,setExpiresAt]=useState(''),[shares,setShares]=useState<Share[]>([]);
 const rows=receipts.filter(row=>dates.includes(row.date)),canExport=signedIn&&!!settings&&rows.length>0&&!collecting&&!needsReview&&!busy;
 useEffect(()=>{if(!signedIn)return;const controller=new AbortController();void json<Settings>('/api/report-settings',{signal:controller.signal}).then(value=>{setSettings(value);setConfig(value.config);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[signedIn]);
 async function edit(){setError('');try{const saved=await json<Settings>('/api/report-settings');setSettings(saved);setConfig(saved.config);setTemplate(null);setReset(false);setSheets(saved.config.sheet?[saved.config.sheet]:[]);setOpen(true);setShares(await json<Share[]>('/api/report-shares'));}catch(e){setError((e as Error).message);}}
 async function upload(file?:File){if(!file)return;setBusy('양식 읽는 중');setError('');try{if(!/\.xlsx$/i.test(file.name))throw new Error('XLSX 파일을 선택해 주세요.');const {inspectReportTemplate}=await import('@/lib/report-workbook');const detected=await inspectReportTemplate(new Uint8Array(await file.arrayBuffer()));setTemplate(file);setReset(false);setSheets(detected.sheets);setConfig(value=>({...value,...(detected.columns?{columns:detected.columns,firstRow:detected.firstRow!,lastRow:detected.lastRow!}:{}),sheet:detected.sheet}));}catch(e){setError((e as Error).message);}finally{setBusy('');}}
 async function save(){setBusy('양식 저장 중');setError('');try{const form=new FormData();form.set('config',JSON.stringify(config));if(template)form.set('template',template);if(reset)form.set('reset','true');setSettings(await json<Settings>('/api/report-settings',{method:'POST',body:form}));setOpen(false);setNotice('양식과 공유 설정을 저장했습니다. 다음 정산부터 그대로 적용합니다.');}catch(e){setError((e as Error).message);}finally{setBusy('');}}
 async function createFile(bundle:boolean){
  if(!settings)throw new Error('양식을 먼저 불러와 주세요.');const selected=reportRows(receipts,dates),{buildReportWorkbook}=await import('@/lib/report-workbook');let bytes:Uint8Array|undefined;
  if(settings.templateName){const response=await fetch('/api/report-settings/template');if(!response.ok)throw new Error('저장한 양식을 다시 불러오지 못했습니다.');bytes=new Uint8Array(await response.arrayBuffer());}
  const workbook=await buildReportWorkbook(selected,trips,dates,settings.config,bytes),name=reportFilename(settings.config.title,dates);
  if(!bundle)return {blob:new Blob([workbook as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),name:name+'.xlsx'};
  const {zipSync,strToU8}=await import('fflate'),files:Record<string,Uint8Array>={[name+'.xlsx']:workbook};let size=workbook.length,attached=0;const hashes=new Set<string>();
  if(settings.config.includeOriginals)for(const row of selected.filter(row=>row.hasAttachment)){
   const response=await fetch('/api/receipts/'+row.id+'/attachment');if(!response.ok)throw new Error('영수증 원본을 불러오지 못했습니다. 파일을 빠뜨린 채 저장하지 않았습니다.');
   const data=new Uint8Array(await response.arrayBuffer());const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).join(',');if(hashes.has(hash))continue;hashes.add(hash);size+=data.length;if(size>12*1024*1024)throw new Error('원본을 포함한 묶음이 12MB를 넘습니다. 날짜를 나누거나 양식 설정에서 원본 포함을 해제해 주세요.');
   const mime=(response.headers.get('content-type')||'').split(';')[0],ext:Record<string,string>={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','image/webp':'webp'};if(!ext[mime])throw new Error('원본 파일 형식을 확인하지 못했습니다.');
   files['영수증/'+String(++attached).padStart(3,'0')+'-'+row.date+'-'+row.source+'.'+ext[mime]]=data;
  }
  files['정산안내.txt']=strToU8(`${settings.config.title}\n출장일: ${dates.join(', ')}\n영수증 ${selected.length}건 · ${selected.reduce((sum,row)=>sum+row.amount,0).toLocaleString('ko-KR')}원\n원본 파일 ${attached}개 (동일 파일 중복 제외)\n원본 없는 내역 ${selected.filter(row=>!row.hasAttachment).length}건\n`);
  const zip=zipSync(files,{level:1});if(zip.length>12*1024*1024)throw new Error('공유 파일은 12MB까지 가능합니다.');return {blob:new Blob([zip as BlobPart],{type:'application/zip'}),name:name+'.zip'};
 }
 async function run(mode:'xlsx'|'zip'|'mail'){
  const popup=mode==='mail'&&settings?.config.mail==='gmail'?window.open('about:blank','chuljang-report-mail'):null;
  if(popup){popup.document.title='정산 파일 준비';popup.document.body.textContent='정산 파일과 공유 링크를 준비하고 있습니다…';}
  setBusy(mode==='mail'?'공유 파일 준비 중':'정산 파일 만드는 중');setError('');setNotice('');setLink('');
  try{const file=await createFile(mode!=='xlsx');if(mode!=='mail'){download(file.blob,file.name);setNotice(file.name+' 파일을 저장했습니다.');return;}
   const form=new FormData();form.set('file',file.blob,file.name);const share=await json<Share&{path:string}>('/api/report-shares',{method:'POST',body:form});const url=new URL(share.path,location.origin).href;setLink(url);setExpiresAt(share.expiresAt);setShares(value=>[share,...value]);setNotice('공유 링크가 준비됐습니다. 웹메일에서 받는 사람과 내용을 확인하고 보내세요.');
   if(popup&&!popup.closed){popup.opener=null;popup.location.href=mailComposeUrl(settings!.config,url,share.expiresAt);}
  }catch(e){popup?.close();setError((e as Error).message);}finally{setBusy('');}
 }
 async function revoke(id:string){setError('');try{await json('/api/report-shares',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});setShares(value=>value.filter(row=>row.id!==id));setLink('');}catch(e){setError((e as Error).message);}}
 return <><section className="report-output" aria-labelledby="report-title"><div className="report-heading"><FileText size={25}/><div><span className="eyebrow">03 · 저장·공유</span><h2 id="report-title">선택한 출장일의 정산 파일</h2><p>{settings?.templateName||'기본 엑셀 양식'} · {rows.length}건 · {rows.reduce((sum,row)=>sum+row.amount,0).toLocaleString('ko-KR')}원</p></div><Button variant="outline" disabled={!signedIn||!!busy} onClick={()=>void edit()}><Settings2 size={16}/> 양식 설정</Button></div>
 <div className="report-actions"><Button disabled={!canExport} onClick={()=>void run('xlsx')}><Download size={17}/> 엑셀 저장</Button><Button variant="outline" disabled={!canExport} onClick={()=>void run('zip')}><Download size={17}/> 원본과 묶어 저장</Button><Button variant="outline" disabled={!canExport} onClick={()=>void run('mail')}><Mail size={17}/> 웹메일로 공유</Button></div>
 {busy?<p role="status"><LoaderCircle className="animate-spin inline" size={16}/> {busy}</p>:collecting?<p role="status">선택한 날짜를 수집·저장하고 있어요. 완료되면 파일을 만들 수 있습니다.</p>:needsReview?<p role="status">날짜·금액이 불명확한 내역을 검토하면 파일을 만들 수 있습니다.</p>:<p className="report-hint">{testMode?'테스트 공간과 공유 링크는 테스트 시작 후 24시간까지 유지됩니다. 필요한 파일은 내려받으세요.':'양식과 받는 사람은 한 번만 설정하세요. 웹메일에는 7일간 유효한 다운로드 링크를 넣습니다.'}</p>}
 {notice&&<p role="status">{notice}</p>}{error&&!open&&<p className="chrome-error" role="alert">{error}</p>}
 {link&&<div className="report-share"><a href={mailComposeUrl(settings!.config,link,expiresAt)} target="_blank" rel="noopener noreferrer" className="official-link"><Mail size={17}/> {settings?.config.mail==='gmail'?'Gmail 작성 화면 열기':'메일 작성 화면 열기'}</a><Button variant="outline" onClick={()=>void navigator.clipboard.writeText(link).then(()=>setNotice('공유 링크를 복사했습니다.')).catch(()=>setError('링크 복사를 허용해 주세요.'))}><Copy size={16}/> 링크 복사</Button><a href={link}>공유 파일 확인</a></div>}
 </section><Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent className="report-dialog"><DialogTitle>정산 양식 설정</DialogTitle><DialogDescription>회사 엑셀 양식을 한 번 등록하면 다음 출장에도 그대로 사용합니다. 입력할 빈 행과 열만 지정하세요.</DialogDescription>
 <div className="dialog-form"><label>정산서 제목<input value={config.title} maxLength={80} onChange={e=>setConfig({...config,title:e.target.value})}/></label>
 <label className="report-template-upload">{template?.name||(!reset&&settings?.templateName)||'기본 엑셀 양식 사용'}<input type="file" accept=".xlsx" disabled={!!busy} onChange={e=>void upload(e.target.files?.[0])}/></label>
 {(template||(!reset&&settings?.templateName))&&<><Button variant="ghost" size="sm" onClick={()=>{setReset(true);setTemplate(null);setConfig({...config,sheet:''});}}>기본 양식으로 되돌리기</Button><label>시트<Select value={config.sheet} onValueChange={sheet=>setConfig({...config,sheet})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{sheets.map(sheet=><SelectItem key={sheet} value={sheet}>{sheet}</SelectItem>)}</SelectContent></Select></label>
 <div className="form-grid"><label>첫 입력 행<input type="number" min={1} max={2000} value={config.firstRow} onChange={e=>setConfig({...config,firstRow:Number(e.target.value)})}/></label><label>마지막 입력 행<input type="number" min={config.firstRow} max={5000} value={config.lastRow} onChange={e=>setConfig({...config,lastRow:Number(e.target.value)})}/></label></div>
 <div className="report-column-grid">{reportFields.map(field=><label key={field}>{fieldLabels[field]} 열<input placeholder="생략" value={config.columns[field]} maxLength={2} onChange={e=>setConfig({...config,columns:{...config.columns,[field]:e.target.value.toUpperCase().replace(/[^A-Z]/g,'')}})}/></label>)}</div><p className="report-hint">합계 행은 입력 범위에서 제외하세요. 이용일·금액 열은 필수입니다. 양식에 {'{{title}}, {{dates}}, {{total}}, {{count}}'}를 넣으면 제목·출장일·합계·건수가 채워집니다.</p></>}
 <label>받는 사람 이메일<input type="email" value={config.recipient} maxLength={254} placeholder="한 번만 입력 · 생략 가능" onChange={e=>setConfig({...config,recipient:e.target.value})}/></label><label>메일 작성<Select value={config.mail} onValueChange={value=>setConfig({...config,mail:value as ReportConfig['mail']})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="gmail">Gmail 웹메일</SelectItem><SelectItem value="default">기본 메일 앱</SelectItem></SelectContent></Select></label>
 <label className="check-label"><Checkbox checked={config.includeOriginals} onCheckedChange={value=>setConfig({...config,includeOriginals:value===true})}/> 묶음·공유 파일에 영수증 원본 포함</label>
 {error&&<p className="chrome-error" role="alert">{error}</p>}<Button disabled={!!busy} onClick={()=>void save()}>{busy||'저장하고 계속하기'}</Button>
 {!!shares.length&&<div className="report-links"><h3><Link2 size={16}/> 공유 중인 파일</h3>{shares.map(share=><div key={share.id}><span>{share.filename}<small>{new Date(share.expiresAt).toLocaleDateString('ko-KR')}까지</small></span><Button size="sm" variant="ghost" onClick={()=>void revoke(share.id)}>공유 종료</Button></div>)}</div>}
 </div></DialogContent></Dialog></>;
}
