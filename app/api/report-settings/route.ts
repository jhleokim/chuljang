import {owner,db,bucket,failure,boundedBody,HttpError} from '@/lib/server';
import {defaultReport,reportConfigSchema} from '@/lib/report';
import {checkWorkbook} from '@/lib/report-zip';
export async function GET(){try{const user=await owner();const row=await db().prepare('SELECT config,template_name AS templateName FROM report_settings WHERE user_id=?').bind(user).first<{config:string;templateName:string|null}>();return Response.json({config:row?reportConfigSchema.parse(JSON.parse(row.config)):defaultReport,templateName:row?.templateName||null},{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
export async function POST(request:Request){
 let uploaded:string|undefined,committed=false;
 try{
  const user=await owner(request);const type=request.headers.get('content-type')||'';if(!type.startsWith('multipart/form-data'))throw new HttpError(400,'양식 설정을 확인해 주세요.');
  const bytes=await boundedBody(request,6*1024*1024),form=await new Request(request.url,{method:'POST',headers:{'Content-Type':type},body:bytes}).formData();
  let config;try{config=reportConfigSchema.parse(JSON.parse(String(form.get('config'))));}catch{throw new HttpError(400,'양식의 입력 행·열과 이메일 주소를 확인해 주세요.');}
  const old=await db().prepare('SELECT template_key AS key,template_name AS name FROM report_settings WHERE user_id=?').bind(user).first<{key:string|null;name:string|null}>();
  let key=old?.key||null,name=old?.name||null;const file=form.get('template');
  if(file&&typeof file!=='string'&&file.size){if(!/\.xlsx$/i.test(file.name))throw new HttpError(400,'XLSX 양식만 지원합니다.');const data=new Uint8Array(await file.arrayBuffer());try{checkWorkbook(data);}catch(e){throw new HttpError(400,(e as Error).message);}key='receipts/'+crypto.randomUUID();uploaded=key;name=file.name.slice(0,180);await bucket().put(key,data,{httpMetadata:{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});}
  else if(form.get('reset')==='true'){key=null;name=null;}
  if(key&&!config.sheet)throw new HttpError(400,'입력할 시트를 선택해 주세요.');
  await db().prepare('INSERT INTO report_settings (user_id,config,template_key,template_name) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET config=excluded.config,template_key=excluded.template_key,template_name=excluded.template_name').bind(user,JSON.stringify(config),key,name).run();committed=true;
  if(old?.key&&old.key!==key)await bucket().delete(old.key).catch(()=>{});
  return Response.json({config,templateName:name});
 }catch(error){if(uploaded&&!committed)await bucket().delete(uploaded).catch(()=>{});return failure(error);}
}
