import {db,bucket} from '@/lib/server';
import {shareHash,downloadHeaders} from '@/lib/report-share';
import {env} from 'cloudflare:workers';
export async function GET(_request:Request,context:{params:Promise<{token:string}>}){
 const {token}=await context.params;const unavailable=()=>new Response('공유가 종료되었거나 링크가 올바르지 않습니다.',{status:404,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex'}});
 if(!/^[a-f0-9]{64}$/.test(token))return unavailable();
 try{const row=await db().prepare('SELECT file_key AS key,filename,user_id AS owner FROM report_shares WHERE token_hash=? AND expires_at>?').bind(await shareHash(token),new Date().toISOString()).first<{key:string;filename:string;owner:string}>();if(!row)return unavailable();const directory=Reflect.get(env,'ACCOUNTS');if(directory&&!await directory.getByName('invitation-directory').active(row.owner))return unavailable();if(Reflect.get(env,'HOME_ORIGIN')&&!await db().prepare('SELECT id FROM home_users WHERE id=? AND disabled=0').bind(row.owner).first())return unavailable();const file=await bucket().get(row.key);if(!file)return unavailable();return new Response(file.body,{headers:downloadHeaders(row.filename)});}catch{return new Response('파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',{status:503,headers:{'Cache-Control':'no-store'}});}
}
