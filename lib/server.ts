import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {fileBucket} from '../cloud/file-bucket.mjs';
export function db(){if(!env.DB)throw new Error('저장소를 사용할 수 없습니다.');return env.DB;}
export function bucket(){const files=Reflect.get(env,'PRIVATE_FILES');if(files)return fileBucket(files) as unknown as R2Bucket;if(!env.BUCKET)throw new Error('파일 저장소를 사용할 수 없습니다.');return env.BUCKET;}
export async function owner(request?:Request){
 const user=await getChatGPTUser();if(!user)throw new HttpError(401,'로그인 후 이용해 주세요.');
 if(request&&request.method!=='GET'){
  const origin=request.headers.get('origin');
  const homeOrigin=Reflect.get(env,'HOME_ORIGIN') as string|undefined;
  const expected=homeOrigin||new URL(request.url).origin;
  if(origin&&origin!==expected&&(homeOrigin||origin!=='https://chuljang-receipts.jhleokim.chatgpt.site'))throw new HttpError(403,'허용되지 않은 요청입니다.');
 }
 return user.userId;
}
export class HttpError extends Error{constructor(public status:number,message:string){super(message);}}
export function failure(e:unknown){
 if(e instanceof HttpError)return Response.json({error:e.message},{status:e.status});
 console.error('receipt operation failed', e instanceof Error?e.message:'unknown');
 return Response.json({error:'처리하지 못했습니다. 입력한 내용은 유지됩니다. 잠시 후 다시 시도해 주세요.'},{status:500});
}
export async function boundedBody(request:Request,limit=300000){
 if(Number(request.headers.get('content-length'))>limit)throw new HttpError(413,'가져올 데이터가 너무 큽니다.');
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'빈 요청입니다.');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new HttpError(413,'한 번에 12MB 이하로 가져와 주세요.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export async function jsonBody(request:Request){try{return JSON.parse(new TextDecoder().decode(await boundedBody(request)));}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'입력 형식을 확인해 주세요.');}}

