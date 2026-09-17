import { createServer } from 'node:http';
import { connect } from 'node:net';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { WebSocketServer, createWebSocketStream } from 'ws';
import next from 'next';
import { HomeAuth, safeReturn, AccountError } from './auth.mjs';
import { runtime } from './env.ts';
import { HomeCollectors } from './collector-manager.ts';
import {handleAccount,removeDeletedFiles,deleteAccountData} from './accounts.mjs';

const escape = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function stripIdentity(headers) {
  for (const key of Object.keys(headers)) if (/^oai-|^x-middleware-|^x-forwarded-|^x-invoke-|^x-now-|^x-matched-path$/.test(key)) delete headers[key];
}
export function loginPage(returnTo, error = '') {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>출장 · 로그인</title><link rel="stylesheet" href="/home-assets/home.css"><main class="card"><span class="eyebrow">CHULJANG</span><h1>나의 출장 정산</h1><p>초대받은 개인 계정으로 로그인하세요. 서버 운영자는 저장 데이터에 접근할 수 있습니다.</p><form method="post" action="/signin-with-chatgpt"><input type="hidden" name="return_to" value="${escape(safeReturn(returnTo))}"><label for="username">아이디</label><input id="username" name="username" autocomplete="username" required autofocus maxlength="40"><label for="password">비밀번호</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="512"><p role="alert">${escape(error)}</p><button type="submit">로그인</button></form><p><a href="/recover">복구 코드로 비밀번호 찾기</a></p></main></html>`;
}
export async function createHomeServer({ auth, collector, handle }) {
  const novncRoot=resolve('node_modules/@novnc/novnc');
  const websocket=new WebSocketServer({noServer:true,maxPayload:1024*1024,perMessageDeflate:false});
  const clients=new Set();
  const ownerLocks=new Map();
  async function ownerLock(owner){
    const previous=ownerLocks.get(owner)||Promise.resolve();let unlock;
    const current=new Promise(resolve=>{unlock=resolve;});ownerLocks.set(owner,current);await previous;
    return ()=>{if(ownerLocks.get(owner)===current)ownerLocks.delete(owner);unlock();};
  }
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Frame-Options','DENY');
    const send=(status,body,type='text/plain; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type});res.end(body);};
    let unlock;
    try{
      const url=new URL(req.url,auth.origin);
      if(req.headers.host!==new URL(auth.origin).host&&url.pathname!=='/healthz')return send(421,'Unknown host');
      stripIdentity(req.headers);
      if(url.pathname==='/healthz')return send(200,'ok');
      if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==auth.origin)return send(403,'Invalid origin');
      let user=auth.user(req.headers.cookie);
      if(user){unlock=await ownerLock(user);user=auth.user(req.headers.cookie);}
      if(url.pathname.startsWith('/home-assets/')){
        const file=url.pathname.slice('/home-assets/'.length);if(!['home.css','remote.js','account.js'].includes(file))return send(404,'Not found');
        return send(200,await readFile(resolve('selfhost/public',file)),file.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');
      }
      if(url.pathname==='/signin-with-chatgpt'){
        res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
        if(req.method==='GET'){if(user){res.writeHead(303,{Location:safeReturn(url.searchParams.get('return_to'))});return res.end();}return send(200,loginPage(url.searchParams.get('return_to')),'text/html; charset=utf-8');}
        if(req.method!=='POST')return send(405,'Method not allowed');
        let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>4096)return send(413,'Request too large');body+=chunk.toString();}
        const form=new URLSearchParams(body),result=await auth.login(form.get('password'),form.get('username')||'admin');
        if(result.status!==200){if(result.status===429)res.setHeader('Retry-After','300');return send(result.status,loginPage(form.get('return_to'),result.status===429?'로그인 시도가 많습니다. 5분 후 다시 시도해 주세요.':'비밀번호를 확인해 주세요.'),'text/html; charset=utf-8');}
        res.writeHead(303,{'Set-Cookie':result.cookie,Location:safeReturn(form.get('return_to'))});return res.end();
      }
      if(url.pathname==='/signout-with-chatgpt'){if(req.method!=='GET'&&req.method!=='POST')return send(405,'Method not allowed');res.writeHead(303,{'Set-Cookie':auth.logout(req.headers.cookie),'Clear-Site-Data':'"cache", "storage"',Location:'/'});return res.end();}
      if(await handleAccount({req,res,url,auth,collector,user,send}))return;
      if(url.pathname.startsWith('/remote-assets/')){
        if(!user)return send(401,'Sign in required');
        const relative=url.pathname.slice('/remote-assets/'.length);if(!/^(core|vendor)\/[a-zA-Z0-9_./-]+\.js$/.test(relative))return send(404,'Not found');
        const path=resolve(novncRoot,relative);if(!path.startsWith(novncRoot+sep))return send(404,'Not found');
        return send(200,await readFile(path),'text/javascript; charset=utf-8');
      }
      if(url.pathname.startsWith('/remote/')){
        if(!user){res.writeHead(303,{Location:'/signin-with-chatgpt?return_to='+encodeURIComponent(url.pathname)});return res.end();}
        const match=url.pathname.match(/^\/remote\/([a-f0-9]{48})\/(status)?$/),session=match&&collector.sessions.get(match[1]);
        if(!session||session.owner!==user)return send(410,'Login window has closed');
        if(match[2])return send(200,JSON.stringify({active:true}),'application/json');
        res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; base-uri 'none'; frame-ancestors 'none'");
        return send(200,`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>공식 서비스 로그인 · 출장</title><link rel="stylesheet" href="/home-assets/home.css"><body class="remote"><header><strong>공식 서비스 로그인</strong><span id="status">로그인하면 나머지는 자동으로 진행됩니다.</span></header><div id="screen"></div><script type="module" src="/home-assets/remote.js"></script></body></html>`,'text/html; charset=utf-8');
      }
      // The Next server has no listening socket. Only this verified identity
      // reaches its existing Sites-compatible authentication helper.
      if(user){const account=auth.account(user);req.headers['oai-authenticated-user-id']=user;req.headers['oai-authenticated-user-email']=account.username+'@home.local';req.headers['oai-authenticated-user-full-name']=encodeURIComponent(account.username);req.headers['oai-authenticated-user-full-name-encoding']='percent-encoded-utf-8';}
      req.headers['x-forwarded-proto']=new URL(auth.origin).protocol.slice(0,-1);
      req.headers['x-forwarded-host']=new URL(auth.origin).host;
      if(!user&&url.pathname.startsWith('/api/'))return send(401,JSON.stringify({error:'로그인 후 이용해 주세요.'}),'application/json');
      return await handle(req,res);
    }catch(error){if(!res.headersSent)send(error instanceof AccountError?error.status:500,error instanceof AccountError?error.message:'요청을 처리하지 못했습니다.');else res.end();}finally{unlock?.();}
  });
  server.headersTimeout=15000;server.requestTimeout=30000;
  server.on('upgrade',(req,socket,head)=>{
    try{
      const match=new URL(req.url,auth.origin).pathname.match(/^\/remote\/([a-f0-9]{48})\/socket$/);
      const session=match&&collector.sessions.get(match[1]),user=auth.user(req.headers.cookie);
      if(req.headers.origin!==auth.origin||req.headers.host!==new URL(auth.origin).host||!user||session?.owner!==user){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
      websocket.handleUpgrade(req,socket,head,ws=>{
        clients.add(ws);const tcp=connect(session.port,'127.0.0.1'),stream=createWebSocketStream(ws,{binary:true});
        tcp.on('error',()=>ws.close());stream.on('error',()=>tcp.destroy());tcp.pipe(stream).pipe(tcp);
        const timer=setInterval(()=>{if(collector.sessions.get(match[1])!==session||!auth.user(req.headers.cookie))ws.close();},1000);timer.unref();
        ws.on('close',()=>{clearInterval(timer);tcp.destroy();clients.delete(ws);});
      });
    }catch{socket.destroy();}
  });
  return {server,close:async()=>{for(const client of clients)client.terminate();await new Promise(resolve=>websocket.close(resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

export async function startHomeServer(){
  process.env.NODE_ENV='production';
  const origin=process.env.HOME_ORIGIN;if(!origin)throw new Error('HOME_ORIGIN is required');
  const parsed=new URL(origin);if(parsed.origin!==origin||!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('Invalid HOME_ORIGIN');
  if(parsed.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))throw new Error('Use HTTPS for remote access');
  const owner=process.env.HOME_OWNER_ID||'home-owner',state=runtime();
  const auth=new HomeAuth(state.storage,origin,process.env.HOME_PASSWORD_HASH,owner);
  const pruneAudit=()=>state.storage.sql.prepare('DELETE FROM home_audit WHERE time<?').run(Date.now()-90*86400000);
  pruneAudit();const housekeeping=setInterval(pruneAudit,60000);housekeeping.unref();
  await removeDeletedFiles(state.storage);
  const collector=new HomeCollectors(state.storage,process.env.HOME_COLLECTOR_KEY||'');state.collector=collector;
  for(const row of state.storage.sql.prepare("SELECT value FROM home_state WHERE key LIKE 'account-delete:%'").all()){const id=JSON.parse(row.value);await collector.revoke(id);await deleteAccountData(auth,id);}
  const app=next({dev:false});await app.prepare();
  const web=await createHomeServer({auth,collector,handle:app.getRequestHandler()});
  await new Promise((resolve,reject)=>{web.server.once('error',reject);web.server.listen(Number(process.env.PORT||3000),process.env.HOME_BIND||'127.0.0.1',resolve);});collector.resume();
  console.log('Chuljang home server ready at '+origin);
  let closing=false;const close=async()=>{if(closing)return;closing=true;clearInterval(housekeeping);await web.close();await collector.close();await app.close();state.storage.close();};
  process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());return {close};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve('selfhost/server.mjs'))await startHomeServer();
