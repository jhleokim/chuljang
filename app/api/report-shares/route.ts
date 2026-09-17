import {owner,db,bucket,failure,boundedBody,jsonBody,HttpError} from '@/lib/server';
import {shareHash,shareToken} from '@/lib/report-share';
import {z} from 'zod';
import {env} from 'cloudflare:workers';
export async function GET(){try{const user=await owner();const rows=await db().prepare('SELECT id,filename,expires_at AS expiresAt FROM report_shares WHERE user_id=? AND expires_at>? ORDER BY created_at DESC').bind(user,new Date().toISOString()).all();return Response.json(rows.results,{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
export async function DELETE(request:Request){try{const user=await owner(request),input=z.object({id:z.string().uuid()}).parse(await jsonBody(request));const row=await db().prepare('SELECT file_key AS key FROM report_shares WHERE id=? AND user_id=?').bind(input.id,user).first<{key:string}>();if(row){await db().prepare('DELETE FROM report_shares WHERE id=? AND user_id=?').bind(input.id,user).run();await bucket().delete(row.key);}return Response.json({ok:true});}catch(error){return failure(error);}}
export async function POST(request:Request){
 let uploaded:string|undefined,committed=false;
 try{
  const user=await owner(request),now=new Date().toISOString();
  const old=await db().prepare('SELECT id,file_key AS key FROM report_shares WHERE user_id=? AND expires_at<=?').bind(user,now).all<{id:string;key:string}>();
  for(const row of old.results){await bucket().delete(row.key);await db().prepare('DELETE FROM report_shares WHERE id=? AND user_id=?').bind(row.id,user).run();}
  const total=await db().prepare('SELECT COUNT(*) AS count FROM report_shares WHERE user_id=?').bind(user).first<{count:number}>();if((total?.count||0)>=20)throw new HttpError(409,'기존 공유를 종료한 뒤 새 링크를 만들어 주세요.');
  const type=request.headers.get('content-type')||'';if(!type.startsWith('multipart/form-data'))throw new HttpError(400,'공유할 파일을 확인해 주세요.');
  const bytes=await boundedBody(request,13*1024*1024),form=await new Request(request.url,{method:'POST',headers:{'Content-Type':type},body:bytes}).formData(),file=form.get('file');
  if(!file||typeof file==='string'||!file.size||file.size>12*1024*1024||!file.name.endsWith('.zip'))throw new HttpError(400,'공유할 정산 묶음은 12MB 이하의 ZIP 파일이어야 합니다.');
  const signature=new Uint8Array(await file.slice(0,4).arrayBuffer());if(signature[0]!==80||signature[1]!==75||signature[2]!==3||signature[3]!==4)throw new HttpError(400,'정산 파일 형식이 올바르지 않습니다.');
  let expires=Date.now()+7*86400000;
  if(Reflect.get(env,'TEST_MODE')==='1'){
    const directory=Reflect.get(env,'ACCOUNTS') as {getByName:(name:string)=>{retentionUntil:(id:string)=>Promise<number>}};
    const until=await directory.getByName('invitation-directory').retentionUntil(user);if(until<=Date.now())throw new HttpError(401,'테스트 공간이 만료됐습니다.');expires=Math.min(expires,until);
  }
  const id=crypto.randomUUID(),token=shareToken(),hash=await shareHash(token),key='receipts/'+crypto.randomUUID(),expiresAt=new Date(expires).toISOString();uploaded=key;
  const filename=file.name.replace(/[\x00-\x1f\\/]/g,'_').slice(0,180);await bucket().put(key,file.stream(),{httpMetadata:{contentType:'application/zip'}});
  await db().prepare('INSERT INTO report_shares (id,user_id,token_hash,file_key,filename,expires_at,created_at) VALUES (?,?,?,?,?,?,?)').bind(id,user,hash,key,filename,expiresAt,now).run();committed=true;
  return Response.json({id,path:'/share/'+token,expiresAt,filename},{headers:{'Cache-Control':'no-store'}});
 }catch(error){if(uploaded&&!committed)await bucket().delete(uploaded).catch(()=>{});return failure(error);}
}
