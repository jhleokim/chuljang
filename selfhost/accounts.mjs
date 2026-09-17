import {AccountError} from './auth.mjs';
import {consentNotice,consentVersion} from './consent.mjs';
export const escape=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const current='<label>현재 비밀번호<input name="current" type="password" autocomplete="current-password" required maxlength="512"></label>';
const password='<label>새 비밀번호<input name="password" type="password" autocomplete="new-password" minlength="15" maxlength="128" required></label><p>15~128자의 긴 문장을 사용하세요. 다른 사이트의 비밀번호를 재사용하지 마세요.</p>';
const username='<label>아이디<input name="username" autocomplete="username" pattern="[a-z0-9][a-z0-9._\\-]{2,39}" minlength="3" maxlength="40" required></label>';
const form=(action,body,button)=>`<form method="post" action="/account"><input type="hidden" name="action" value="${action}">${body}<button>${button}</button></form>`;
export function page(title,body,{script=false,wide=false}={}){return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · 출장</title><link rel="stylesheet" href="/home-assets/home.css"><main class="card${wide?' account':''}"><a href="/">출장으로 돌아가기</a><h1>${escape(title)}</h1>${body}</main>${script?'<script src="/home-assets/account.js" defer></script>':''}</html>`;}
export function privacy(){return '<div class="notice"><h2>운영자 접근과 데이터 보관</h2>'+consentNotice.split('\n').map(line=>'<p>'+escape(line)+'</p>').join('')+'<p>안내 버전: '+consentVersion+'</p></div>';}
export function joinPage(error='',token=''){return page('내 계정 만들기',`<p>초대받은 사람만 가입할 수 있습니다. 다른 사용자와 영수증·서비스 연결은 분리됩니다.</p><p role="alert">${escape(error)}</p><form method="post" action="/join"><label>초대 코드<input id="invite" name="invite" value="${/^[a-f0-9]{64}$/.test(token)?token:''}" required pattern="[a-f0-9]{64}" autocomplete="off" maxlength="64"></label>${username}${password}${privacy()}<input type="hidden" name="consent_version" value="${consentVersion}"><label class="check"><input type="checkbox" name="accepted" value="yes" required>운영자가 데이터에 접근할 수 있음을 이해하고, 위 방식의 수집·보관에 동의합니다.</label><button>동의하고 계정 만들기</button></form>`,{script:true});}
export function recoveryPage(error=''){return page('계정 복구',`<p>가입할 때 저장한 일회용 복구 코드가 필요합니다. 복구하면 모든 기기에서 로그아웃됩니다.</p><p role="alert">${escape(error)}</p><form method="post" action="/recover">${username}<label>복구 코드<input name="recovery" autocomplete="off" required maxlength="48"></label>${password}<button>비밀번호 변경</button></form>`);}
export function secretPage(title,code,description){return page(title,`<p>${escape(description)}</p><textarea readonly aria-label="보관할 코드" rows="3">${escape(code)}</textarea><p>이 화면을 떠나면 다시 표시하지 않습니다. 비밀번호 관리 도구에 보관하세요.</p><a class="button" href="/account">보관했습니다</a>`);}
export function accountPage(auth,id,message=''){
 const user=auth.account(id),sessions=auth.storage.sql.prepare('SELECT COUNT(*) AS n FROM home_user_sessions WHERE user_id=? AND expires>? AND seen>?').get(id,Date.now(),Date.now()-86400000).n;
 let admin='';
 if(user.role==='admin'){
  const members=auth.storage.sql.prepare("SELECT id,username,disabled FROM home_users WHERE id<>? AND username NOT LIKE 'deleted-%' ORDER BY created").all(id);
  const invites=auth.storage.sql.prepare('SELECT id,expires FROM home_invites WHERE used=0 AND expires>? ORDER BY expires').all(Date.now());
  admin=`<section><h2>사용자 초대</h2><p>가입 링크는 7일 동안 한 번만 사용할 수 있습니다. 받는 사람에게 직접 전달하세요. 관리자 화면에는 계정 상태만 표시됩니다.</p>${form('invite',current,'초대 링크 만들기')}${invites.map(invite=>form('revoke_invite',`<p>사용 전 초대 · ${escape(new Date(invite.expires).toLocaleDateString('ko-KR'))} 만료</p><input type="hidden" name="invite_id" value="${escape(invite.id)}">${current}`,'이 초대 종료')).join('')}</section><section><h2>가입한 사용자</h2>${members.length?members.map(member=>form(member.disabled?'enable':'disable',`<p><strong>${escape(member.username)}</strong> · ${member.disabled?'중지됨':'사용 중'}</p><input type="hidden" name="target" value="${escape(member.id)}">${current}`,member.disabled?'사용 허용':'계정 사용 중지')).join(''):'<p>아직 초대를 수락한 사용자가 없습니다.</p>'}</section>`;
 }
 const events=auth.storage.sql.prepare('SELECT action,time FROM home_audit WHERE actor=? ORDER BY time DESC LIMIT 15').all(id);
 const labels={login:'로그인',logout_all:'전체 기기 로그아웃',password_changed:'비밀번호 변경',invite_created:'초대 생성',invite_revoked:'초대 종료',account_created:'계정 생성',recovery_created:'복구 코드 변경',account_recovered:'계정 복구',account_disabled:'계정 중지',account_enabled:'계정 재개'};
 return page('계정과 보안',`<p><strong>${escape(user.username)}</strong> · ${user.role==='admin'?'관리자':'개인 계정'} · 로그인된 기기 ${sessions}개</p><p role="status">${escape(message)}</p><section><h2>로그인 관리</h2><p>최대 7일, 24시간 동안 사용하지 않으면 로그인이 만료됩니다.</p>${form('logout','','이 기기 로그아웃')}${form('logout_all','','전체 기기 로그아웃')}</section><section><h2>비밀번호 변경</h2>${form('password',current+password,'변경하고 전체 기기 로그아웃')}</section><section><h2>복구 코드</h2><p>분실에 대비해 일회용 코드를 안전하게 보관하세요. 새로 만들면 기존 코드는 사용할 수 없습니다.</p>${form('recovery',current,'새 복구 코드 만들기')}</section>${admin}<section><h2>최근 보안 기록</h2><ul>${events.map(event=>`<li>${escape(new Date(event.time).toLocaleString('ko-KR'))} · ${escape(labels[event.action]||'계정 변경')}</li>`).join('')}</ul></section><section><h2>데이터 보관</h2>${privacy()}${user.role!=='admin'?form('delete',current+'<label>확인을 위해 아이디를 입력하세요<input name="confirm" required autocomplete="off"></label><p>계정, 영수증, 양식, 공유 링크와 서비스 연결을 삭제합니다. 되돌릴 수 없습니다.</p>','내 계정과 데이터 삭제'):'<p>서버 관리자 계정의 삭제는 서버 이전 후 진행해야 합니다.</p>'}</section>`,{wide:true});
}
export async function handleAccount({req,res,url,auth,collector,user,send,accountChanged=async()=>{},deleteData=deleteAccountData}){
 if(!['/join','/recover','/account'].includes(url.pathname))return false;
 res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
 const html=(status,body)=>send(status,body,'text/html; charset=utf-8');
 const redirect=path=>{res.writeHead(303,{Location:path});res.end();};
 if(url.pathname==='/account'&&!user){redirect('/signin-with-chatgpt?return_to=/account');return true;}
 if(req.method==='GET'){html(200,url.pathname==='/join'?joinPage():url.pathname==='/recover'?recoveryPage():accountPage(auth,user));return true;}
 if(req.method!=='POST'){send(405,'Method not allowed');return true;}
 let invitation='';
 try{
  let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)throw new AccountError(413,'입력 내용이 너무 큽니다.');body+=chunk.toString();}const data=new URLSearchParams(body);
  if(url.pathname==='/join'){
   invitation=data.get('invite')||'';
   if(user)throw new AccountError(409,'먼저 현재 계정에서 로그아웃해 주세요.');
   if(data.get('accepted')!=='yes')throw new AccountError(400,'데이터 보관 방식을 확인해 주세요.');
   const result=await auth.register(data.get('invite'),data.get('username'),data.get('password'),data.get('consent_version'));await accountChanged(result.id);res.setHeader('Set-Cookie',result.cookie);
   html(201,secretPage('계정이 만들어졌습니다',result.recovery,'비밀번호를 잊었을 때 사용할 일회용 복구 코드입니다.'));return true;
  }
  if(url.pathname==='/recover'){await auth.recover(data.get('username'),data.get('recovery'),data.get('password'));res.setHeader('Set-Cookie',auth.cookie('',0));redirect('/signin-with-chatgpt');return true;}
  const action=data.get('action');
  if(action==='logout'||action==='logout_all'){res.setHeader('Set-Cookie',action==='logout_all'?auth.logoutAll(user):auth.logout(req.headers.cookie));res.setHeader('Clear-Site-Data','"cache", "storage"');redirect('/signin-with-chatgpt');return true;}
  if(action==='password'){await auth.changePassword(user,data.get('current'),data.get('password'));res.setHeader('Set-Cookie',auth.cookie('',0));redirect('/signin-with-chatgpt');return true;}
  if(!['invite','revoke_invite','disable','enable','recovery','delete'].includes(action))throw new AccountError(400,'지원하지 않는 요청입니다.');
  await auth.verifyCurrent(user,data.get('current'));
  // Reauthentication must not revive a session concurrently revoked elsewhere.
  if(auth.user(req.headers.cookie)!==user)throw new AccountError(403,'다시 로그인해 주세요.');
  if(action==='invite'){const invite=auth.createInvite(user);html(200,secretPage('초대 링크',auth.origin+'/join#'+invite.token,'7일 이내 한 사람만 가입할 수 있습니다. 받는 사람에게 직접 전달하세요.'));return true;}
  if(action==='revoke_invite')auth.revokeInvite(user,data.get('invite_id'));
  if(action==='disable'||action==='enable'){const target=data.get('target');auth.disable(user,target,action==='disable');await accountChanged(target);if(action==='disable')await collector.revoke(target);}
  if(action==='recovery'){html(200,secretPage('새 복구 코드',auth.newRecovery(user),'기존 복구 코드는 더 이상 사용할 수 없습니다.'));return true;}
  if(action==='delete'){
   if(user===auth.ownerId||auth.account(user).username!==data.get('confirm'))throw new AccountError(400,'삭제할 계정의 아이디를 확인해 주세요.');
   // Disable first, so concurrent requests and collectors cannot restore deleted data.
   auth.storage.sql.prepare('UPDATE home_users SET disabled=1 WHERE id=?').run(user);auth.storage.set('account-delete:'+user,user);auth.logoutAll(user);await accountChanged(user);await collector.revoke(user);
   await deleteData(auth,user);res.setHeader('Set-Cookie',auth.cookie('',0));res.setHeader('Clear-Site-Data','"cache", "storage"');html(200,page('삭제했습니다','<p>계정과 저장 데이터가 삭제됐습니다. 기존 백업에는 보관 기간 동안 남을 수 있습니다.</p>'));return true;
  }
  redirect('/account');return true;
 }catch(error){const status=error instanceof AccountError?error.status:500,message=error instanceof AccountError?error.message:'처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';html(status,url.pathname==='/join'?joinPage(message,invitation):url.pathname==='/recover'?recoveryPage(message):page('처리하지 못했습니다',`<p role="alert">${escape(message)}</p><a href="/account">계정으로 돌아가기</a>`));return true;}
}
export async function deleteAccountData(auth,id){
 const storage=auth.storage;
 const files=storage.sql.prepare('SELECT attachment_key AS key FROM receipts WHERE user_id=? AND attachment_key IS NOT NULL UNION SELECT template_key AS key FROM report_settings WHERE user_id=? AND template_key IS NOT NULL UNION SELECT file_key AS key FROM report_shares WHERE user_id=?').all(id,id,id);
 storage.transaction(()=>{
  for(const table of ['receipts','trips','report_settings','report_shares','home_user_sessions','home_recovery','home_consents'])storage.sql.prepare('DELETE FROM '+table+' WHERE user_id=?').run(id);
  storage.sql.prepare('UPDATE home_users SET username=?,password_hash=?,disabled=1 WHERE id=?').run('deleted-'+id,'deleted',id);
  for(const file of files)storage.set('file-delete:'+file.key,file.key);
  auth.audit(id,'account_deleted');
 });
 await removeDeletedFiles(storage);
 storage.delete('account-delete:'+id);
}
export async function removeDeletedFiles(storage){for(const row of storage.sql.prepare("SELECT key,value FROM home_state WHERE key LIKE 'file-delete:%'").all()){await storage.bucket().delete(JSON.parse(row.value));storage.delete(row.key);}}
