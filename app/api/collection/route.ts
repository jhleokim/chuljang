import { z } from 'zod';
import { owner,failure,jsonBody,HttpError } from '@/lib/server';
import { collectorConfigured,collectorRequest,type CollectionStatus } from '@/lib/server-collector';
import { SOURCES } from '@/collector/providers.js';
import { normalizeDates } from '@/collector/date-scope.js';
const idSchema=z.string().refine(value=>SOURCES.some(source=>source.id===value));
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('start'),providers:z.array(idSchema).min(1).max(5),requestedDates:z.array(z.string()).min(1).max(62),consent:z.boolean(),jobId:z.string().uuid()}),
 z.object({action:z.literal('stop'),providers:z.array(idSchema).min(1).max(5)}),
 z.object({action:z.literal('disconnect'),providers:z.array(idSchema).min(1).max(5)}),
 z.object({action:z.literal('ack'),provider:idSchema,captureId:z.string().uuid()}),
]);
export async function GET(request:Request){try{
 const user=await owner();if(!collectorConfigured())return Response.json({configured:false,connections:[],captures:[]},{headers:{'Cache-Control':'no-store'}});
 const skip=new URL(request.url).searchParams.get('skip')?.split(',').filter(Boolean)||[];if(!z.array(z.string().uuid()).max(200).safeParse(skip).success)throw new HttpError(400,'수집 목록을 다시 불러와 주세요.');
 return Response.json(await collectorRequest<CollectionStatus>(user,{action:'status',skip}),{headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}catch(error){return failure(error);}}
export async function POST(request:Request){try{
 const user=await owner(request);if(!request.headers.get('origin'))throw new HttpError(403,'허용되지 않은 요청입니다.');
 const parsed=schema.safeParse(await jsonBody(request));if(!parsed.success)throw new HttpError(400,'선택한 서비스와 출장 날짜를 확인해 주세요.');
 const data=parsed.data;if(data.action==='start'){data.requestedDates=normalizeDates(data.requestedDates);data.providers=[...new Set(data.providers)];}
 return Response.json(await collectorRequest(user,data),{headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}catch(error){return failure(error);}}
