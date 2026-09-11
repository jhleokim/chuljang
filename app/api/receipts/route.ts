import { db,bucket,owner,failure,boundedBody,jsonBody,HttpError } from '@/lib/server';
import { candidateSchema,redact,safeSourceUrl } from '@/lib/receipts';
import { z } from 'zod';
import { normalizeDates } from '../../../collector/date-scope.js';
const rowsSchema=z.array(candidateSchema).min(1).max(100);
export async function GET(){try{const user=await owner();const result=await db().prepare("SELECT id,source,date,merchant,amount,reference,'' AS raw,source_url AS sourceUrl,trip_id AS tripId,reviewed,created_at AS createdAt,attachment_key IS NOT NULL AS hasAttachment FROM receipts WHERE user_id=? ORDER BY date DESC,created_at DESC LIMIT 5000").bind(user).all();return Response.json(result.results,{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
export async function POST(req:Request){
 const uploaded:string[]=[];
 try{
  const user=await owner(req);
  const type=req.headers.get('content-type')||'';
  let data:unknown;let files:File[]=[];let requestedDates:string[]|undefined;
  if(type.startsWith('multipart/form-data')){
   const bytes=await boundedBody(req,14*1024*1024);
   const form=await new Request(req.url,{method:'POST',headers:{'content-type':type},body:bytes}).formData();
   try{data=JSON.parse(String(form.get('receipts')||''));}catch{throw new HttpError(400,'영수증 데이터가 올바르지 않습니다.');}
   if(form.has('requestedDates')){try{requestedDates=normalizeDates(JSON.parse(String(form.get('requestedDates'))));}catch{throw new HttpError(400,'출장 날짜를 확인해 주세요.');}}
   files=form.getAll('files').filter((f):f is File=>typeof f!=='string');
  }else{data=await jsonBody(req);}
  const parsed=rowsSchema.safeParse(data);if(!parsed.success)throw new HttpError(400,'날짜·금액·사용처를 확인해 주세요. 한 번에 100건까지 저장할 수 있습니다.');
  for(const [i,row] of parsed.data.entries()){
   const input=(data as Record<string,unknown>[])[i];let scope=requestedDates;
   if(input.requestedDates!==undefined){try{scope=normalizeDates(input.requestedDates);}catch{throw new HttpError(400,'출장 날짜를 확인해 주세요.');}}
   if((requestedDates&&!requestedDates.includes(row.date))||(scope&&!scope.includes(row.date)))throw new HttpError(400,'선택한 출장 날짜에 해당하지 않는 영수증이 있어요.');
  }
  if(files.length>20||files.reduce((n,f)=>n+f.size,0)>12*1024*1024)throw new HttpError(413,'첨부파일은 합계 12MB, 20개까지 가능합니다.');
  const allowed=['image/jpeg','image/png','image/webp','application/pdf'];
  if(files.some(f=>!allowed.includes(f.type)))throw new HttpError(400,'JPG, PNG, WEBP, PDF 파일만 첨부할 수 있습니다.');
  if(parsed.data.some(r=>r.attachmentIndex!==undefined&&!files[r.attachmentIndex]))throw new HttpError(400,'첨부파일을 다시 선택해 주세요.');
  const trips=await db().prepare('SELECT id,start_date,end_date FROM trips WHERE user_id=?').bind(user).all<{id:string;start_date:string;end_date:string}>();
  const attachments=new Map<number,{key:string;name:string;type:string}>();
  for(const r of parsed.data){const i=r.attachmentIndex;if(i===undefined||attachments.has(i))continue;const file=files[i];const key='receipts/'+crypto.randomUUID();await bucket().put(key,file.stream(),{httpMetadata:{contentType:file.type}});uploaded.push(key);attachments.set(i,{key,name:file.name.slice(0,180),type:file.type});}
  const statements=await Promise.all(parsed.data.map(async r=>{
   const base=JSON.stringify([r.source,r.reference,r.date,r.amount,r.merchant,r.reference?'':r.raw.trim().replace(/\s+/g,' ')]);
   const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(base)))).map(x=>x.toString(16).padStart(2,'0')).join('');
   const matches=trips.results.filter(t=>t.start_date<=r.date&&t.end_date>=r.date);const trip=matches.length===1?matches[0].id:null;const a=r.attachmentIndex===undefined?undefined:attachments.get(r.attachmentIndex);
   return db().prepare('INSERT INTO receipts (id,user_id,source,date,merchant,amount,reference,raw,source_url,fingerprint,trip_id,reviewed,attachment_key,attachment_name,attachment_type,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,fingerprint) DO NOTHING').bind(crypto.randomUUID(),user,r.source,r.date,r.merchant,r.amount,r.reference,redact(r.raw),safeSourceUrl(r.sourceUrl),fingerprint,trip,0,a?.key||null,a?.name||null,a?.type||null,new Date().toISOString());
  }));
  const results=await db().batch(statements);const imported=results.reduce((n,r)=>n+(r.meta.changes||0),0);
  // A retried import must not retain an extra unattached file.
  for(const key of uploaded){const used=await db().prepare('SELECT id FROM receipts WHERE user_id=? AND attachment_key=? LIMIT 1').bind(user,key).first();if(!used)await bucket().delete(key);}
  return Response.json({imported,duplicates:parsed.data.length-imported});
 }catch(e){
  // Keep files already referenced by committed rows; remove only orphans.
  for(const key of uploaded){try{const used=await db().prepare('SELECT id FROM receipts WHERE attachment_key=? LIMIT 1').bind(key).first();if(!used)await bucket().delete(key);}catch{/* Recovery must not remove committed attachments. */}}
  return failure(e);
 }
}

