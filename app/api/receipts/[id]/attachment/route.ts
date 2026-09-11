import { db,bucket,owner,failure,HttpError } from '@/lib/server';
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){try{
 const user=await owner();const {id}=await params;const row=await db().prepare('SELECT attachment_key,attachment_name,attachment_type FROM receipts WHERE id=? AND user_id=?').bind(id,user).first<{attachment_key:string|null;attachment_name:string;attachment_type:string}>();
 if(!row?.attachment_key)throw new HttpError(404,'첨부한 원본이 없습니다.');const object=await bucket().get(row.attachment_key);if(!object)throw new HttpError(404,'원본 파일을 찾을 수 없습니다.');
 return new Response(object.body,{headers:{'Content-Type':row.attachment_type,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(row.attachment_name),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}catch(e){return failure(e);}}

