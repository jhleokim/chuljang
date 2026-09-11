import { db,owner,failure,jsonBody,HttpError } from '@/lib/server';
import { candidateSchema } from '@/lib/receipts';
import { z } from 'zod';
const schema=candidateSchema.pick({date:true,merchant:true,amount:true,reference:true}).extend({tripId:z.string().uuid().nullable(),reviewed:z.boolean()});
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){try{const user=await owner();const {id}=await params;const row=await db().prepare('SELECT raw FROM receipts WHERE id=? AND user_id=?').bind(id,user).first();if(!row)throw new HttpError(404,'영수증을 찾을 수 없습니다.');return Response.json(row,{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){try{
 const user=await owner(req);const {id}=await params;const parsed=schema.safeParse(await jsonBody(req));if(!parsed.success)throw new HttpError(400,'수정할 날짜와 금액을 확인해 주세요.');const r=parsed.data;
 if(r.tripId&&!await db().prepare('SELECT id FROM trips WHERE id=? AND user_id=?').bind(r.tripId,user).first())throw new HttpError(400,'출장을 다시 선택해 주세요.');
 const result=await db().prepare('UPDATE receipts SET date=?,merchant=?,amount=?,reference=?,trip_id=?,reviewed=? WHERE id=? AND user_id=?').bind(r.date,r.merchant,r.amount,r.reference,r.tripId,r.reviewed?1:0,id,user).run();
 if(!result.meta.changes)throw new HttpError(404,'영수증을 찾을 수 없습니다.');return Response.json({ok:true});
}catch(e){return failure(e);}}

