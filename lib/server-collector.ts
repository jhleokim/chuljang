import { env } from 'cloudflare:workers';
import { signCollector } from './collector-security';
import { HttpError } from './server';

export type ConnectionStatus={providerId:string;connected:boolean;state:string;note:string;count:number;pending:number;requestedDates:string[];completedDates?:string[];inspection?:unknown;loginUrl?:string;consentedAt?:string;error?:string};
export type CollectionStatus={configured:boolean;connections:ConnectionStatus[];captures:{captureId:string;providerId:string;packet:unknown}[]};
function configuration(){const url=Reflect.get(env,'CHULJANG_COLLECTOR_URL') as string|undefined;const secret=Reflect.get(env,'CHULJANG_COLLECTOR_SECRET') as string|undefined;return {url,secret};}
function homeCollector(){return Reflect.get(env,'HOME_COLLECTOR') as {request:(owner:string,values:Record<string,unknown>)=>Promise<unknown>}|undefined;}
export function collectorConfigured(){const {url,secret}=configuration();return !!homeCollector()||!!url&&!!secret;}
export async function collectorRequest<T>(ownerId:string,values:Record<string,unknown>):Promise<T>{
 const local=homeCollector();if(local)return await local.request(ownerId,values) as T;
 const {url,secret}=configuration();if(!url||!secret)throw new HttpError(503,'서버 수집 연결을 준비하고 있습니다.');
 const target=new URL(url);if(target.protocol!=='https:'||target.username||target.password)throw new HttpError(503,'수집 서버 설정을 확인해 주세요.');
 const body=JSON.stringify({...values,owner:ownerId}),timestamp=String(Date.now());
 let response:Response;
 try{response=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json','x-collector-time':timestamp,'x-collector-signature':await signCollector(secret,timestamp,body)},body,signal:AbortSignal.timeout(25000)});}catch{throw new HttpError(502,'수집 서버 응답이 지연되고 있어요. 잠시 후 다시 확인해 주세요.');}
 if(!response.ok)throw new HttpError(response.status===400?400:502,'수집 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
 const reader=response.body?.getReader();if(!reader)throw new HttpError(502,'수집 서버 응답이 없습니다.');let text='',size=0;const decoder=new TextDecoder();
 while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>5*1024*1024){await reader.cancel();throw new HttpError(502,'수집 응답이 너무 큽니다. 나누어 가져와 주세요.');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();return JSON.parse(text) as T;
}
