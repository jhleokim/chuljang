import {DurableObject} from 'cloudflare:workers';
import {HomeAuth,safeReturn,AccountError} from '../selfhost/auth.mjs';
import {handleAccount,deleteAccountData,escape} from '../selfhost/accounts.mjs';
import {AuthStorage} from './sql-storage.mjs';
import {fileBucket} from './file-bucket.mjs';
import {sendCollector} from './collector-client.mjs';
import {installTestWorkspaces,testIdentity,createTestWorkspace} from './test-workspace.mjs';

function loginPage(returnTo,error='') {return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>출장 · 로그인</title><link rel="stylesheet" href="/home-assets/home.css"><main class="card"><span class="eyebrow">CHULJANG</span><h1>나의 출장 정산</h1><p>초대받은 개인 계정으로 로그인하세요. 운영자는 저장 데이터에 접근할 수 있습니다.</p><form method="post" action="/signin-with-chatgpt"><input type="hidden" name="return_to" value="${escape(safeReturn(returnTo))}"><label>아이디<input name="username" autocomplete="username" required autofocus maxlength="40"></label><label>비밀번호<input name="password" type="password" autocomplete="current-password" required maxlength="512"></label><p role="alert">${escape(error)}</p><button>로그인</button></form><a href="/recover">복구 코드로 비밀번호 찾기</a></main></html>`;}

// The invitation directory coordinates unique usernames, single-use invitations,
// and revocation. Receipt queries and private files do not run in this object.
export class AccountDirectory extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);this.storage=new AuthStorage(ctx);
    this.auth=new HomeAuth(this.storage,env.HOME_ORIGIN,env.HOME_PASSWORD_HASH,'home-owner');
    installTestWorkspaces(this.storage);
    ctx.blockConcurrencyWhile(async()=>{await ctx.storage.setAlarm(Date.now()+60000);});
  }
  async syncAccount(id) {
    const account=this.auth.account(id);if(!account)return;
    this.storage.set('mirror-account:'+id,id);
    await this.env.DB.prepare('INSERT INTO home_users(id,username,role,disabled,created) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,role=excluded.role,disabled=excluded.disabled').bind(account.id,account.username,account.role,account.disabled,account.created).run();
    this.storage.delete('mirror-account:'+id);
  }
  identity(cookie) {if(this.env.TEST_MODE==='1')return testIdentity(this.storage,this.auth,cookie);const id=this.auth.user(cookie);return id?this.auth.account(id):null;}
  async beginTest(cookie,scope) {
    if(this.env.TEST_MODE!=='1')throw new Error('Test mode disabled');
    const current=this.identity(cookie);if(current)return {user:current};
    const created=createTestWorkspace(this.storage,this.auth,scope);await this.syncAccount(created.id);
    return {user:this.auth.account(created.id),cookie:created.cookie};
  }
  async endTest(cookie) {
    const user=this.env.TEST_MODE==='1'&&this.identity(cookie);if(!user||user.role!=='test')return false;
    this.storage.sql.prepare('UPDATE home_users SET disabled=1 WHERE id=?').run(user.id);
    this.storage.set('account-delete:'+user.id,user.id);await this.syncAccount(user.id);await this.queueRevoke(user.id);
    await this.deleteData(this.auth,user.id);this.storage.sql.prepare('DELETE FROM test_workspaces WHERE user_id=?').run(user.id);return true;
  }
  active(id) {const user=this.auth.account(id);return !!user&&!user.disabled&&(user.role!=='test'||this.retentionUntil(id)>Date.now());}
  retentionUntil(id) {const row=this.storage.sql.prepare('SELECT expires FROM test_workspaces WHERE user_id=?').get(id);return row?.expires||0;}
  migrationStatus() {return this.storage.get('migration-complete')===true;}
  async migrate(action,payload) {
    if(action==='status')return {complete:this.migrationStatus()};
    if(this.migrationStatus())throw new Error('Migration closed');
    if(action==='accounts'){
      const tables=['home_users','home_invites','home_recovery','home_audit','home_consents'];
      this.storage.transaction(()=>{
        this.storage.sql.prepare('DELETE FROM home_user_sessions').run();
        for(const table of tables){
          if(!Array.isArray(payload[table])||payload[table].length>10000)throw new Error('Invalid migration');
          const columns=this.storage.sql.prepare('PRAGMA table_info('+table+')').all().map(row=>row.name);
          this.storage.sql.prepare('DELETE FROM '+table).run();
          for(const row of payload[table])this.storage.sql.prepare('INSERT INTO '+table+' ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').run(...columns.map(column=>row[column]??null));
        }
      });
      for(const row of payload.home_users)await this.syncAccount(row.id);
      // Import retained records of disabled accounts while the app is locked;
      // restore directory status before opening the application.
      await this.env.DB.prepare('UPDATE home_users SET disabled=0').run();
    }else if(action==='rows'){
      const {table,rows}=payload;if(!['trips','receipts','report_settings','report_shares'].includes(table)||!Array.isArray(rows)||rows.length>100)throw new Error('Invalid migration');
      const columns=(await this.env.DB.prepare('PRAGMA table_info('+table+')').all()).results.map(row=>row.name);
      if(rows.length)await this.env.DB.batch(rows.map(row=>this.env.DB.prepare('INSERT OR REPLACE INTO '+table+' ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').bind(...columns.map(column=>row[column]??null))));
    }else if(action==='file'){
      if(typeof payload.base64!=='string'||payload.base64.length>17*1024*1024)throw new Error('Invalid file');
      await fileBucket(this.env.PRIVATE_FILES).put(payload.key,Buffer.from(payload.base64,'base64'));
    }else if(action==='finish'){
      for(const table of ['trips','receipts','report_settings','report_shares']){
        const count=await this.env.DB.prepare('SELECT COUNT(*) AS n FROM '+table).first();if(count.n!==payload.counts[table])throw new Error('Migration count mismatch');
      }
      for(const row of this.storage.sql.prepare('SELECT id FROM home_users').all())await this.syncAccount(row.id);
      this.storage.set('migration-complete',true);
    }else throw new Error('Unknown migration');
    return {ok:true};
  }
  async queueRevoke(id) {this.storage.set('collector-revoke:'+id,id);await this.ctx.storage.setAlarm(Date.now()+1000);}
  async deleteData(auth,id) {
    await this.syncAccount(id);
    const files=await this.env.DB.prepare('SELECT attachment_key AS key FROM receipts WHERE user_id=? AND attachment_key IS NOT NULL UNION SELECT template_key AS key FROM report_settings WHERE user_id=? AND template_key IS NOT NULL UNION SELECT file_key AS key FROM report_shares WHERE user_id=?').bind(id,id,id).all();
    for(const row of files.results)this.storage.set('cloud-file-delete:'+row.key,row.key);
    await this.env.DB.batch(['receipts','trips','report_settings','report_shares'].map(table=>this.env.DB.prepare('DELETE FROM '+table+' WHERE user_id=?').bind(id)));
    for(const row of this.storage.sql.prepare("SELECT key,value FROM home_state WHERE key LIKE 'cloud-file-delete:%'").all()){await fileBucket(this.env.PRIVATE_FILES).delete(JSON.parse(row.value));this.storage.delete(row.key);}
    await deleteAccountData(auth,id);await this.syncAccount(id);
  }
  async alarm() {
    try {
      for(const row of this.storage.sql.prepare('SELECT user_id FROM test_workspaces WHERE expires<=?').all(Date.now())){
        this.storage.sql.prepare('UPDATE home_users SET disabled=1 WHERE id=?').run(row.user_id);
        this.storage.set('account-delete:'+row.user_id,row.user_id);await this.queueRevoke(row.user_id);
        this.storage.sql.prepare('DELETE FROM test_workspaces WHERE user_id=?').run(row.user_id);
      }
      for(const row of this.storage.sql.prepare("SELECT value FROM home_state WHERE key LIKE 'mirror-account:%'").all())await this.syncAccount(JSON.parse(row.value));
      for(const row of this.storage.sql.prepare("SELECT value FROM home_state WHERE key LIKE 'account-delete:%'").all())await this.deleteData(this.auth,JSON.parse(row.value));
      for(const row of this.storage.sql.prepare("SELECT key,value FROM home_state WHERE key LIKE 'collector-revoke:%'").all()){
        const response=await sendCollector(this.env,JSON.parse(row.value),{action:'revoke'});if(response.ok)this.storage.delete(row.key);await response.body?.cancel();
      }
      this.storage.sql.prepare('DELETE FROM home_audit WHERE time<?').run(Date.now()-90*86400000);
    } finally {await this.ctx.storage.setAlarm(Date.now()+60000);}
  }
  async accountRequest(request) {
    const url=new URL(request.url),headers=new Headers({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});
    if(url.origin!==this.auth.origin||!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==this.auth.origin)return new Response('Invalid origin',{status:403});
    const user=this.auth.user(request.headers.get('cookie'));let output,status=200;
    const send=(code,body,type='text/plain; charset=utf-8')=>{status=code;headers.set('Content-Type',type);output=body;};
    const res={setHeader:(key,value)=>headers.set(key,value),writeHead:(code,values)=>{status=code;for(const [key,value]of Object.entries(values||{}))headers.set(key,value);},end:body=>{output=body||null;}};
    const req={method:request.method,headers:Object.fromEntries(request.headers),async *[Symbol.asyncIterator](){if(!request.body)return;const reader=request.body.getReader();try{for(;;){const part=await reader.read();if(part.done)break;yield Buffer.from(part.value);}}finally{reader.releaseLock();}}};
    try {
      if(url.pathname==='/signin-with-chatgpt'){
        if(request.method==='GET'){if(user){status=303;headers.set('Location',safeReturn(url.searchParams.get('return_to')));}else send(200,loginPage(url.searchParams.get('return_to')),'text/html; charset=utf-8');}
        else if(request.method==='POST'){
          let text='';for await(const chunk of req){text+=chunk.toString();if(text.length>4096)throw new AccountError(413,'입력 내용이 너무 큽니다.');}
          const form=new URLSearchParams(text),result=await this.auth.login(form.get('password'),form.get('username'));
          if(result.status===200){await this.syncAccount(this.auth.user(result.cookie));status=303;headers.set('Set-Cookie',result.cookie);headers.set('Location',safeReturn(form.get('return_to')));}
          else send(result.status,loginPage(form.get('return_to'),result.status===429?'로그인 시도가 많습니다. 5분 후 다시 시도해 주세요.':'아이디와 비밀번호를 확인해 주세요.'),'text/html; charset=utf-8');
        }else status=405;
      }else if(url.pathname==='/signout-with-chatgpt'){headers.set('Set-Cookie',this.auth.logout(request.headers.get('cookie')));headers.set('Clear-Site-Data','"cache", "storage"');headers.set('Location','/');status=303;}
      else await handleAccount({req,res,url,auth:this.auth,user,send,collector:{revoke:id=>this.queueRevoke(id)},accountChanged:id=>this.syncAccount(id),deleteData:(auth,id)=>this.deleteData(auth,id)});
      return new Response(output,{status,headers});
    }catch(error){return new Response(error instanceof AccountError?error.message:'요청을 처리하지 못했습니다.',{status:error instanceof AccountError?error.status:500,headers});}
  }
}
