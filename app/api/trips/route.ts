import { db,owner,failure,jsonBody,HttpError } from '@/lib/server';
import { tripSchema } from '@/lib/receipts';
export async function GET(){try{const id=await owner();const result=await db().prepare('SELECT id,name,start_date AS startDate,end_date AS endDate FROM trips WHERE user_id=? ORDER BY start_date DESC').bind(id).all();return Response.json(result.results,{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
export async function POST(req:Request){try{const user=await owner(req);const parsed=tripSchema.safeParse(await jsonBody(req));if(!parsed.success)throw new HttpError(400,'출장명과 시작·종료일을 확인해 주세요.');const trip={id:crypto.randomUUID(),...parsed.data};await db().prepare('INSERT INTO trips (id,user_id,name,start_date,end_date) VALUES (?,?,?,?,?)').bind(trip.id,user,trip.name,trip.startDate,trip.endDate).run();return Response.json(trip,{status:201});}catch(e){return failure(e);}}

