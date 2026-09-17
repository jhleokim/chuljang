import {createServer} from 'node:http';
import {connect} from 'node:net';
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {WebSocketServer,createWebSocketStream} from 'ws';
import {HomeStorage} from './storage.mjs';
import {HomeCollectors} from './collector-manager.ts';
import {signCollector,verifyCollector} from '../lib/collector-security.ts';

export async function startCollectorService() {
  const origin=process.env.CLOUD_ORIGIN,secret=process.env.CHULJANG_COLLECTOR_SECRET;
  if(!origin?.startsWith('https://')||!secret||secret.length<40)throw new Error('Missing cloud collector configuration');
  const storage=new HomeStorage(process.env.CHULJANG_DATA_DIR||'/data',process.env.HOME_COLLECTOR_KEY);
  // Existing home identities are retained for rollback; new identities are only
  // accepted after a signed request and a fresh check with the cloud directory.
  storage.sql.exec('CREATE TABLE IF NOT EXISTS collector_nonces(nonce TEXT PRIMARY KEY,time INTEGER NOT NULL)');
  const collector=new HomeCollectors(storage,process.env.HOME_COLLECTOR_KEY);
  const websockets=new WebSocketServer({noServer:true,maxPayload:1024*1024,perMessageDeflate:false});
  const clients=new Set(),novncRoot=resolve('node_modules/@novnc/novnc');
  const fresh=nonce=>{if(!/^[a-f0-9-]{36}$/.test(nonce||''))return false;storage.sql.prepare('DELETE FROM collector_nonces WHERE time<?').run(Date.now()-120000);try{storage.sql.prepare('INSERT INTO collector_nonces VALUES (?,?)').run(nonce,Date.now());return true;}catch{return false;}};
  async function cloudActive(owner,cookie) {
    const body=JSON.stringify({owner,...(cookie?{cookie}:{})}),timestamp=String(Date.now());
    try {const response=await fetch(origin+'/internal/collector-check',{method:'POST',headers:{'Content-Type':'application/json','x-collector-time':timestamp,'x-collector-signature':await signCollector(secret,timestamp,body)},body,signal:AbortSignal.timeout(8000),redirect:'error'});return response.ok&&(await response.json()).active===true;}catch{return false;}
  }
  async function remoteProof(req) {
    const encoded=req.headers['x-collector-proof'];if(typeof encoded!=='string'||encoded.length>8192)return null;
    let text,proof;try{text=Buffer.from(encoded,'base64url').toString();proof=JSON.parse(text);}catch{return null;}
    if(proof.path!==req.url||proof.method!==req.method||req.headers.origin&&req.headers.origin!==origin||!await verifyCollector(secret,req.headers['x-collector-time'],req.headers['x-collector-signature'],text)||!fresh(proof.nonce)||!await cloudActive(proof.owner,proof.cookie))return null;
    return proof;
  }
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
    const send=(status,body,type='text/plain; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type});res.end(body);};
    try {
      const url=new URL(req.url,origin);
      if(url.pathname==='/healthz')return send(200,'home-collector-ready');
      if(url.pathname==='/collector'){
        if(req.method!=='POST')return send(405,'Method not allowed');
        let text='';for await(const chunk of req){text+=chunk.toString();if(Buffer.byteLength(text)>32768)return send(413,'Too large');}
        if(!await verifyCollector(secret,req.headers['x-collector-time'],req.headers['x-collector-signature'],text))return send(403,'Invalid signature');
        const values=JSON.parse(text),owner=values.owner;if(typeof owner!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(owner)||!fresh(values.nonce))return send(403,'Invalid request');
        if(values.action==='revoke'){storage.sql.prepare('UPDATE home_users SET disabled=1 WHERE id=?').run(owner);await collector.revoke(owner);return send(200,'{"ok":true}','application/json');}
        if(!await cloudActive(owner))return send(403,'Inactive account');
        storage.sql.prepare('INSERT INTO home_users(id,username,password_hash,role,disabled,created) VALUES (?,?,?, ?,0,?) ON CONFLICT(id) DO UPDATE SET disabled=0').run(owner,'cloud-'+owner,'cloud-managed','member',Date.now());
        return send(200,JSON.stringify(await collector.request(owner,values)),'application/json');
      }
      const isRemote=url.pathname.startsWith('/remote/')||url.pathname.startsWith('/remote-assets/')||url.pathname==='/home-assets/remote.js';
      if(!isRemote){res.writeHead(307,{Location:origin+url.pathname+url.search});return res.end();}
      const proof=await remoteProof(req);if(!proof)return send(403,'Invalid collector access');
      if(url.pathname==='/home-assets/remote.js')return send(200,await readFile(resolve('selfhost/public/remote.js')),'text/javascript');
      if(url.pathname.startsWith('/remote-assets/')){
        const relative=url.pathname.slice('/remote-assets/'.length);if(!/^(core|vendor)\/[a-zA-Z0-9_./-]+\.js$/.test(relative))return send(404,'Not found');
        const path=resolve(novncRoot,relative);if(!path.startsWith(novncRoot+sep))return send(404,'Not found');return send(200,await readFile(path),'text/javascript');
      }
      const match=url.pathname.match(/^\/remote\/([a-f0-9]{48})\/(status)?$/),session=match&&collector.sessions.get(match[1]);
      if(!session||session.owner!==proof.owner)return send(410,'Login window has closed');
      if(match[2])return send(200,'{"active":true}','application/json');
      res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; base-uri 'none'; frame-ancestors 'none'");
      return send(200,'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>공식 서비스 로그인 · 출장</title><link rel="stylesheet" href="/home-assets/home.css"><body class="remote"><header><strong>공식 서비스 로그인</strong><span id="status">로그인하면 나머지는 자동으로 진행됩니다.</span></header><div id="screen"></div><script type="module" src="/home-assets/remote.js"></script></body></html>','text/html; charset=utf-8');
    } catch {if(!res.headersSent)send(500,'Collector request failed');else res.end();}
  });
  server.on('upgrade',async(req,socket,head)=>{
    try {
      const proof=await remoteProof(req),match=req.url.match(/^\/remote\/([a-f0-9]{48})\/socket$/),session=match&&collector.sessions.get(match[1]);
      if(req.headers.origin!==origin||!proof||!session||session.owner!==proof.owner){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
      websockets.handleUpgrade(req,socket,head,ws=>{
        clients.add(ws);const tcp=connect(session.port,'127.0.0.1'),stream=createWebSocketStream(ws,{binary:true});tcp.on('error',()=>ws.close());stream.on('error',()=>tcp.destroy());tcp.pipe(stream).pipe(tcp);
        let checking=false;const timer=setInterval(async()=>{if(checking)return;checking=true;try{if(collector.sessions.get(match[1])!==session||!await cloudActive(proof.owner,proof.cookie))ws.close();}finally{checking=false;}},10000);timer.unref();
        ws.on('close',()=>{clearInterval(timer);tcp.destroy();clients.delete(ws);});
      });
    }catch{socket.destroy();}
  });
  server.headersTimeout=15000;server.requestTimeout=30000;
  await new Promise(resolve=>server.listen(Number(process.env.PORT||3000),process.env.HOME_BIND||'127.0.0.1',resolve));
  console.log('Home collector service ready');
  const close=async()=>{for(const client of clients)client.terminate();await collector.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));storage.close();};
  process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());return{close,server};
}
