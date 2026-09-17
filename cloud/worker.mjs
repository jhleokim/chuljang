import handler from 'vinext/server/fetch-handler';
import {signCollector,verifyCollector,base64url} from '../lib/collector-security.ts';
import css from '../selfhost/public/home.css?raw';
import accountScript from '../selfhost/public/account.js?raw';
export {AccountDirectory} from './accounts.mjs';
export {PrivateFile} from './files.mjs';
const authPaths=new Set(['/signin-with-chatgpt','/signout-with-chatgpt','/account','/join','/recover']);

export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url),origin=env.HOME_ORIGIN;
    if(url.origin!==origin)return new Response('Unknown host',{status:421});
    const directory=env.ACCOUNTS.getByName('invitation-directory');
    if(url.pathname==='/internal/migrate'){
      if(request.method!=='POST'||!env.CLOUD_MIGRATION_KEY)return new Response(null,{status:403});
      const reader=request.body?.getReader();if(!reader)return new Response(null,{status:400});let size=0;const parts=[];
      try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>18*1024*1024){await reader.cancel();return new Response(null,{status:413});}parts.push(part.value);}}finally{reader.releaseLock();}
      const body=Buffer.concat(parts).toString();
      if(!await verifyCollector(env.CLOUD_MIGRATION_KEY,request.headers.get('x-collector-time'),request.headers.get('x-collector-signature'),body))return new Response(null,{status:403});
      try{const {action,payload}=JSON.parse(body);return Response.json(await directory.migrate(action,payload));}catch{return new Response('Migration rejected',{status:409});}
    }
    if(url.pathname==='/internal/collector-check'){
      if(request.method!=='POST')return new Response(null,{status:405});
      const reader=request.body?.getReader();if(!reader)return new Response(null,{status:400});let size=0;const parts=[];
      try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4096){await reader.cancel();return new Response(null,{status:413});}parts.push(part.value);}}finally{reader.releaseLock();}
      const body=Buffer.concat(parts).toString();if(!await verifyCollector(env.CHULJANG_COLLECTOR_SECRET,request.headers.get('x-collector-time'),request.headers.get('x-collector-signature'),body))return new Response(null,{status:403});
      let data;try{data=JSON.parse(body);}catch{return new Response(null,{status:400});}
      const valid=data.cookie?(await directory.identity(data.cookie))?.id===data.owner:await directory.active(data.owner);
      return Response.json({active:valid},{headers:{'Cache-Control':'no-store'}});
    }
    if(url.pathname==='/healthz')return new Response('cloud-app-ready',{headers:{'Cache-Control':'no-store'}});
    if(env.MIGRATION_LOCK==='1'&&!await directory.migrationStatus())return new Response('기존 자료를 옮기고 있습니다. 잠시 후 다시 접속해 주세요.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
    const upgrade=request.headers.get('upgrade')?.toLowerCase()==='websocket';
    if((!['GET','HEAD'].includes(request.method)||upgrade)&&request.headers.get('origin')!==origin)return new Response('Invalid origin',{status:403});
    if(url.pathname==='/api/test-session/end'){
      if(request.method!=='POST'||env.TEST_MODE!=='1')return new Response(null,{status:405});
      if(!await directory.endTest(request.headers.get('cookie')||''))return new Response(null,{status:401});
      return Response.json({ok:true},{headers:{'Cache-Control':'no-store','Set-Cookie':'chuljang_test_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'}});
    }
    if(authPaths.has(url.pathname)){if(env.TEST_MODE==='1')return new Response(null,{status:303,headers:{Location:'/', 'Cache-Control':'no-store'}});return directory.accountRequest(request);}
    if(url.pathname==='/home-assets/home.css'||url.pathname==='/home-assets/account.js')return new Response(url.pathname.endsWith('.css')?css:accountScript,{headers:{'Content-Type':url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store'}});
    const headers=new Headers(request.headers);
    for(const key of [...headers.keys()])if(/^(oai-|x-middleware-|x-forwarded-|x-invoke-|x-now-|x-chuljang-)|^(forwarded|x-matched-path)$/.test(key))headers.delete(key);
    let user=await directory.identity(request.headers.get('cookie')||''),testCookie;
    if(!user&&env.TEST_MODE==='1'&&request.method==='GET'&&url.pathname==='/'){
      try{const started=await directory.beginTest(request.headers.get('cookie')||'',request.headers.get('cf-connecting-ip')||'local');user=started.user;testCookie=started.cookie;}
      catch{return new Response('테스트 공간을 준비하지 못했습니다. 잠시 후 새로고침해 주세요.',{status:429,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});}
    }
    const remote=url.pathname.startsWith('/remote/')||url.pathname.startsWith('/remote-assets/')||url.pathname==='/home-assets/remote.js';
    if(remote){
      if(!user)return new Response('Sign in required',{status:401});
      const proof=JSON.stringify({owner:user.id,cookie:request.headers.get('cookie')||'',method:request.method,path:url.pathname+url.search,nonce:crypto.randomUUID()}),time=String(Date.now());
      headers.set('x-collector-proof',base64url(new TextEncoder().encode(proof)));headers.set('x-collector-time',time);headers.set('x-collector-signature',await signCollector(env.CHULJANG_COLLECTOR_SECRET,time,proof));
      headers.delete('cookie');
      try {return await fetch(new Request(new URL(env.CHULJANG_COLLECTOR_URL).origin+url.pathname+url.search,{method:request.method,headers,redirect:'manual'}));}
      catch {return new Response('수집 서버에 연결하지 못했습니다.',{status:502,headers:{'Cache-Control':'no-store'}});}
    }
    if(user){headers.set('oai-authenticated-user-id',user.id);headers.set('oai-authenticated-user-email',user.username+'@home.local');headers.set('oai-authenticated-user-full-name',encodeURIComponent(user.username));headers.set('oai-authenticated-user-full-name-encoding','percent-encoded-utf-8');}
    if(!user&&url.pathname.startsWith('/api/'))return Response.json({error:'로그인 후 이용해 주세요.'},{status:401});
    const response=await handler.fetch(new Request(request,{headers}),env,ctx);
    if(response.status===101)return response;
    const output=new Response(response.body,response);if(testCookie)output.headers.append('Set-Cookie',testCookie);output.headers.set('Cache-Control','private, no-store');output.headers.set('Referrer-Policy','no-referrer');output.headers.set('X-Content-Type-Options','nosniff');return output;
  },
};
