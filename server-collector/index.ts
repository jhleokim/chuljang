import { DurableObject } from 'cloudflare:workers';
import { acquire, connect, endpointURLString, type Browser, type BrowserContext, type Page } from '@cloudflare/playwright';
import { z } from 'zod';
import { SOURCES, allowedUrl, safeReadLink } from '../collector/providers.js';
import { scanReceiptPage } from '../collector/scan.js';
import { applyReceiptDates } from '../collector/date-filter.js';
import { normalizeDates, matchTravelDate } from '../collector/date-scope.js';
import { sealCollector, openCollector, verifyCollector } from '../lib/collector-security.ts';
import { collectKorailDay,korailDayUrl } from './korail.ts';
import { serviceLoginState } from './history-dom.ts';
import { inspectMemberControls } from './member-inspection.ts';

type Settings = CollectorEnv & { COLLECTOR_SECRET:string };
type Provider = typeof SOURCES[number];
type SavedAuth = Awaited<ReturnType<BrowserContext['storageState']>>;
type Packet = {version:3;automatic:true;source:string;requestedDates:string[];blocks:string[];sourceUrl:string;attachment?:{name:string;mimeType:'application/pdf';base64:string}};
type Meta = { provider?:string; consentedAt?:string; generation:number; connected:boolean; state:string; note:string; dates:string[]; completedDates?:string[]; inspection?:ReturnType<typeof inspectMemberControls>; jobId?:string; sessionId?:string; loginUrl?:string; loginExpires?:number; loginTarget?:string; count:number; pending:string[]; seen:string[]; runToken?:string; leaseUntil:number; startedAt:number; retry:number };
const empty = ():Meta => ({generation:0,connected:false,state:'disconnected',note:'',dates:[],count:0,pending:[],seen:[],leaseUntil:0,startedAt:0,retry:0});
const active = (state:string) => ['queued','opening','login','collecting'].includes(state);
const reply = (body:unknown,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
const providerFor = (id:string) => SOURCES.find(provider=>provider.id===id)!;
const hash = async (value:string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
class Revoked extends Error {}

export class ReceiptConnection extends DurableObject<Settings> {
 private getMeta(){return this.ctx.storage.get<Meta>('meta').then(value=>value||empty());}
 private async update(change:(meta:Meta)=>Meta){return this.ctx.storage.transaction(async tx=>{const next=change((await tx.get<Meta>('meta'))||empty());await tx.put('meta',next);return next;});}
 private async patch(generation:number,values:Partial<Meta>){return this.update(meta=>{if(meta.generation!==generation)throw new Revoked();return {...meta,...values};});}
 private async alive(generation:number){const meta=await this.getMeta();if(meta.generation!==generation)throw new Revoked();return meta;}
 private async putSecret(key:string,value:unknown,generation:number,captureId?:string){
  const sealed=await sealCollector(this.env.COLLECTOR_SECRET,this.ctx.id.toString()+':'+key,value),parts=sealed.match(/.{1,60000}/g)||[];
  await this.ctx.storage.transaction(async tx=>{const meta=(await tx.get<Meta>('meta'))||empty();if(meta.generation!==generation)throw new Revoked();const old=(await tx.get<number>(key+':length'))||0;await tx.put(key+':length',parts.length);for(let i=0;i<parts.length;i++)await tx.put(key+':'+i,parts[i]);for(let i=parts.length;i<old;i++)await tx.delete(key+':'+i);if(captureId)await tx.put('meta',{...meta,pending:[...meta.pending,captureId]});});
 }
 private async getSecret<T>(key:string):Promise<T|undefined>{const count=await this.ctx.storage.get<number>(key+':length');if(!count)return;let value='';for(let i=0;i<count;i++)value+=await this.ctx.storage.get<string>(key+':'+i)||'';return openCollector<T>(this.env.COLLECTOR_SECRET,this.ctx.id.toString()+':'+key,value);}
 private async deleteSecret(key:string){await this.ctx.storage.transaction(async tx=>{const count=await tx.get<number>(key+':length')||0;await tx.delete([key+':length',...Array.from({length:count},(_,i)=>key+':'+i)]);});}
 async status(){const meta=await this.getMeta();return {providerId:meta.provider,connected:meta.connected,consentedAt:meta.consentedAt,state:meta.state,note:meta.note,count:meta.count,pending:meta.pending.length,requestedDates:meta.dates,completedDates:meta.completedDates||[],inspection:meta.inspection,loginUrl:meta.state==='login'&&(meta.loginExpires||0)>Date.now()?meta.loginUrl:undefined};}
 async start(provider:string,dates:string[],consent:boolean,jobId:string,delay:number){
  const requestedDates=normalizeDates(dates);
  const error=await this.ctx.storage.transaction(async tx=>{
   const meta=await tx.get<Meta>('meta')||empty();
   if(meta.jobId===jobId)return JSON.stringify(meta.dates)!==JSON.stringify(requestedDates)||meta.provider!==provider?'같은 수집 요청의 날짜를 변경할 수 없습니다.':undefined;
   if(['login','opening','queued'].includes(meta.state)&&!meta.connected){await tx.put('meta',{...meta,dates:requestedDates,jobId,completedDates:[]});return;}
   if(active(meta.state))return;
   if(meta.pending.length>=100)return '저장 대기 내역을 처리하고 있습니다.';
   if(!meta.consentedAt&&!consent)return '서비스 연결 권한을 승인해 주세요.';
   await tx.put('meta',{...meta,provider,dates:requestedDates,completedDates:[],inspection:undefined,consentedAt:meta.consentedAt||new Date().toISOString(),generation:meta.generation+1,jobId,state:'queued',note:'선택한 날짜를 조회하고 있어요.',count:0,seen:[],retry:0,leaseUntil:0,startedAt:Date.now(),loginUrl:undefined});await tx.setAlarm(Date.now()+delay+1000);
  });return {...await this.status(),...(error?{error}:{})};
 }
 async stop(revoke=false){
  const previous=await this.ctx.storage.transaction(async tx=>{
   const meta=await tx.get<Meta>('meta')||empty();
   if(revoke){const entries=await tx.list();const keys=[...entries.keys()].filter(key=>key.startsWith('auth:')||key.startsWith('capture:'));if(keys.length)await tx.delete(keys);}
   await tx.put('meta',{...meta,generation:meta.generation+1,state:revoke?'disconnected':'stopped',connected:revoke?false:meta.connected,consentedAt:revoke?undefined:meta.consentedAt,inspection:undefined,loginUrl:undefined,sessionId:undefined,leaseUntil:0,note:revoke?'연결을 해제했습니다.':'날짜 변경을 반영하고 있어요.',pending:revoke?[]:meta.pending});await tx.deleteAlarm();return meta;
  });
  if(previous.sessionId)await this.closeSession(previous.sessionId).catch(()=>{});
  return this.status();
 }
 async captures(skip:string[]){const meta=await this.getMeta();const rows=[];for(const id of meta.pending.filter(id=>!skip.includes(id)).slice(0,2)){const packet=await this.getSecret<Packet>('capture:'+id);if(packet)rows.push({captureId:id,packet,providerId:meta.provider});}return rows;}
 async acknowledge(id:string){await this.ctx.storage.transaction(async tx=>{const meta=await tx.get<Meta>('meta')||empty();if(!meta.pending.includes(id))return;const key='capture:'+id,count=await tx.get<number>(key+':length')||0;await tx.delete([key+':length',...Array.from({length:count},(_,i)=>key+':'+i)]);await tx.put('meta',{...meta,pending:meta.pending.filter(item=>item!==id)});});}
 private async attach(sessionId:string){const endpoint=new URL(endpointURLString('BROWSER',{sessionId}));endpoint.searchParams.set('persistent','true');for(let attempt=0;;attempt++){try{return await connect(endpoint);}catch(error){if(attempt>=2||!/50[234]|temporar|not ready|already.*connect|connect.*progress/i.test(String(error)))throw error;await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}}}
 private async closeSession(sessionId:string){const browser=await this.attach(sessionId);try{const cdp=await browser.newBrowserCDPSession();await cdp.send('Browser.close');}finally{await browser.close().catch(()=>{});}}
 private async verified(page:Page,provider:Provider){if(!allowedUrl(page.url(),provider))return false;return page.evaluate(serviceLoginState,provider.id);}
 private async login(browser:Browser,context:BrowserContext,page:Page,provider:Provider,generation:number){
  const cdp=await context.newCDPSession(page);const view=await cdp.send('Cloudflare.getLiveView',{mode:'tab',expiresInMs:300000});
  await this.patch(generation,{state:'login',connected:false,loginUrl:view.devtoolsFrontendUrl,loginTarget:view.id,loginExpires:Date.now()+300000,note:'공식 사이트 로그인이 필요합니다. 로그인하면 수집을 이어갑니다.',leaseUntil:0});
  await this.ctx.storage.setAlarm(Date.now()+10000);
 }
 async alarm(){
  const first=await this.getMeta();if(!active(first.state))return;
  if(first.leaseUntil>Date.now()){await this.ctx.storage.setAlarm(first.leaseUntil+1000);return;}
  const generation=first.generation,runToken=crypto.randomUUID();
  await this.patch(generation,{runToken,leaseUntil:Date.now()+90000});
  await this.ctx.storage.setAlarm(Date.now()+95000);
  let browser:Browser|undefined;let terminate=true;let ownedSession:string|undefined;let stage='acquire';
  try{
   const meta=await this.alive(generation),provider=providerFor(meta.provider!);
   if(meta.state==='login'&&(meta.loginExpires||0)<Date.now()){await this.patch(generation,{state:'error',loginUrl:undefined,note:'로그인 시간이 만료됐어요. 다시 연결해 주세요.'});if(meta.sessionId)await this.closeSession(meta.sessionId).catch(()=>{});return;}
   let sessionId=meta.sessionId;
   if(!sessionId){await this.patch(generation,{state:'opening',note:'공식 사이트를 여는 중입니다.'});const session=await acquire(this.env.BROWSER,{keep_alive:60000,recording:false});sessionId=session.sessionId;ownedSession=sessionId;await this.patch(generation,{sessionId});}
   else ownedSession=sessionId;
   stage='attach';let replaced=false;
   try{browser=await this.attach(sessionId);}catch(error){if(!meta.sessionId||meta.retry>=1)throw error;const replacement=await acquire(this.env.BROWSER,{keep_alive:60000,recording:false});ownedSession=replacement.sessionId;replaced=true;await this.patch(generation,{sessionId:ownedSession,retry:meta.retry+1,loginTarget:undefined,loginUrl:undefined});browser=await this.attach(ownedSession);}
   const persistent=browser.contexts()[0];if(!persistent)throw new Error('context');
   const saved=meta.state!=='login'?await this.getSecret<SavedAuth>('auth'):undefined;
   let context=saved?await browser.newContext({storageState:saved}):persistent;
   let page=context.pages()[0]||await context.newPage();
   page.setDefaultTimeout(8000);
   if(meta.state==='login'&&!replaced){
    if(!await this.verified(page,provider)){await this.patch(generation,{leaseUntil:0});await this.ctx.storage.setAlarm(Date.now()+5000);terminate=false;return;}
   }
   stage='navigate';await page.goto(provider.startUrl,{waitUntil:saved||meta.state==='login'&&!replaced?'domcontentloaded':'commit',timeout:25000});
   if(!saved&&(meta.state!=='login'||replaced)){if(!allowedUrl(page.url(),provider))throw new Error('Unexpected service origin');stage='handoff';await this.login(browser,context,page,provider,generation);terminate=false;return;}
   await page.waitForTimeout(1200);
   stage='read';const scan=await page.evaluate(scanReceiptPage,{});
   const verified=await this.verified(page,provider);
   if(!verified||scan.state==='login'){
    if(context!==persistent){await context.close();context=persistent;page=context.pages()[0]||await context.newPage();await page.goto(provider.startUrl,{waitUntil:'domcontentloaded',timeout:25000});}
    stage='handoff';await this.login(browser,context,page,provider,generation);terminate=false;return;
   }
   await this.putSecret('auth',await context.storageState({indexedDB:true}),generation);
   await this.patch(generation,{connected:true,state:'collecting',loginUrl:undefined,note:'선택한 출장 날짜의 영수증을 찾고 있어요.'});
   if(provider.id==='korail')await this.collectKorail(page,context,generation);
   else if(['tmoneyTransit','kobus'].includes(provider.id)){
    const inspection=await page.evaluate(inspectMemberControls);
    await this.patch(generation,{state:'adapter_pending',inspection,note:'로그인은 연결됐습니다. 회원 조회 화면에 맞춘 자동 수집 검증이 아직 필요합니다.'});
   }else await this.collect(page,context,provider,generation);
  }catch(error){
   if(error instanceof Revoked){terminate=true;}else{
    const text=String(error);console.error('collector_failed',{stage,state:(await this.getMeta()).state,message:text.replace(/(?:https?|wss?):[^\s]+/g,'[url]').replace(/[A-Za-z0-9_-]{32,}/g,'[token]').slice(0,240)});const limited=/429|rate.limit|too many/i.test(text),transient=/ERR_ABORTED|ERR_TIMED_OUT|TimeoutError|Execution context was destroyed|50[234]|temporarily unavailable/i.test(text);const meta=await this.getMeta();
    if(meta.generation===generation){
     if((limited||transient)&&meta.retry<2&&!/time limit|hours|today/i.test(text)){await this.patch(generation,{state:'queued',retry:meta.retry+1,sessionId:undefined,leaseUntil:0,note:'연결이 지연되어 잠시 후 자동으로 다시 연결합니다.'});await this.ctx.storage.setAlarm(Date.now()+25000);}
     else await this.patch(generation,{state:'error',sessionId:undefined,loginUrl:undefined,note:limited?'현재 서버 수집 한도에 도달했어요. 잠시 후 다시 시도해 주세요.':'서비스에 연결하지 못했어요. 다시 연결하거나 공식 사이트 상태를 확인해 주세요.'});
    }
   }
  }finally{
   if(terminate&&ownedSession){try{if(browser){const cdp=await browser.newBrowserCDPSession();await cdp.send('Browser.close');}else await this.closeSession(ownedSession);}catch{}const meta=await this.getMeta();if(meta.generation===generation)await this.patch(generation,{sessionId:undefined,loginUrl:undefined,leaseUntil:0});}
   await browser?.close().catch(()=>{});
  }
 }
 private async collectKorail(page:Page,context:BrowserContext,generation:number){
  const meta=await this.alive(generation),day=meta.dates.find(value=>!meta.completedDates?.includes(value));
  if(!day){await this.patch(generation,{state:'complete',note:'선택한 모든 날짜의 조회를 마쳤어요.'});return;}
  await this.patch(generation,{note:day+' 이용내역과 영수증을 조회하고 있어요.'});
  const result=await collectKorailDay(page,day,()=>this.alive(generation));
  const blocks=result.blocks.filter(block=>matchTravelDate(block,[day]).kind==='match');
  if(result.blocks.length!==blocks.length)throw new Error('코레일 조회 날짜와 영수증 이용일이 달라 저장하지 않았습니다.');
  if(blocks.length){const id=crypto.randomUUID();await this.putSecret('capture:'+id,{version:3,automatic:true,source:'ktx',requestedDates:meta.dates,blocks,sourceUrl:korailDayUrl(day),attachment:result.attachment} satisfies Packet,generation,id);}
  await this.putSecret('auth',await context.storageState({indexedDB:true}),generation);
  const completedDates=[...meta.completedDates||[],day],done=completedDates.length===meta.dates.length;
  await this.patch(generation,{completedDates,count:meta.count+blocks.length,state:done?'complete':'queued',retry:0,leaseUntil:0,note:done?'선택한 '+completedDates.length+'일 조회 완료 · '+(meta.count+blocks.length)+'건':'다음 출장 날짜를 자동으로 조회합니다.'});
  if(!done)await this.ctx.storage.setAlarm(Date.now()+25000);
 }
 private async collect(page:Page,context:BrowserContext,provider:Provider,generation:number){
  const visited=new Set<string>(),buttons=new Set<string>(),datePages=new Set<string>();let pending:string[]=[];let hitLimit=false;
  for(let index=0;index<15;index++){
   const meta=await this.alive(generation);await this.patch(generation,{leaseUntil:Date.now()+90000});
   if(!allowedUrl(page.url(),provider))break;
   if(!datePages.has(page.url())){datePages.add(page.url());const filtered=await page.evaluate(applyReceiptDates,meta.dates);if(filtered.applied)await page.waitForTimeout(1400);}
   const result=await page.evaluate(scanReceiptPage,{});
   if(result.state==='login'){await this.patch(generation,{connected:false,note:'서비스 인증이 만료됐어요. 다시 연결해 주세요.'});break;}
   const fresh:string[]=[];const seen=new Set(meta.seen);
   for(const block of result.blocks||[]){const fingerprint=await hash(block.replace(/\s+/g,' ').trim());if(seen.has(fingerprint))continue;seen.add(fingerprint);if(matchTravelDate(block,meta.dates).kind!=='outside'&&meta.count+fresh.length<100)fresh.push(block);}
   for(let offset=0;offset<fresh.length;offset+=10){const id=crypto.randomUUID();const url=new URL(page.url());url.search='';url.hash='';await this.putSecret('capture:'+id,{version:3,automatic:true,source:provider.source,requestedDates:meta.dates,blocks:fresh.slice(offset,offset+10),sourceUrl:url.toString()} satisfies Packet,generation,id);}
   await this.patch(generation,{seen:[...seen].slice(-2000),count:meta.count+fresh.length});
   if(meta.count+fresh.length>=100||seen.size>=2000){hitLimit=true;break;}
   visited.add(page.url());for(const link of result.links||[]){if(safeReadLink(link.url,link.label,provider)&&!visited.has(link.url)&&!pending.includes(link.url)&&pending.length<40)pending.push(link.url);}
   if(pending.length){await page.goto(pending.shift()!,{waitUntil:'domcontentloaded',timeout:25000});await page.waitForTimeout(900);continue;}
   const generationKey=await hash(JSON.stringify([page.url(),result.pageLabel,result.blocks]));
   const choice=(result.buttons||[]).find(button=>!buttons.has(generationKey+':'+button.index+':'+button.label));
   if(!choice)break;buttons.add(generationKey+':'+choice.index+':'+choice.label);
   const moved=await page.evaluate(scanReceiptPage,{button:choice});if(!('clicked' in moved)||!moved.clicked)break;
   await page.waitForTimeout(1200);if(index===14)hitLimit=true;
  }
  await this.alive(generation);await this.putSecret('auth',await context.storageState({indexedDB:true}),generation);
  const meta=await this.getMeta();await this.patch(generation,{state:'partial',note:hitLimit?'이번 조회 한도까지 수집했어요. 추가 내역은 확인이 필요합니다.':meta.count?'확인한 화면의 해당 날짜 내역을 가져왔어요. 전체 조회 범위는 서비스별 확인이 필요합니다.':'확인한 화면에서 해당 날짜 내역을 찾지 못했어요. 조회 범위 확인이 필요합니다.'});
 }
}

const inputSchema=z.object({owner:z.string().min(1).max(128),action:z.enum(['status','start','stop','disconnect','ack']),providers:z.array(z.string()).max(6).optional(),requestedDates:z.array(z.string()).max(62).optional(),consent:z.boolean().optional(),jobId:z.string().uuid().optional(),provider:z.string().optional(),captureId:z.string().uuid().optional(),skip:z.array(z.string().uuid()).max(200).optional()});
export default {async fetch(request:Request,env:Settings){
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 if(!env.COLLECTOR_SECRET)return reply({error:'Collector not configured'},503);
 if(Number(request.headers.get('content-length'))>16000)return reply({error:'Request too large'},413);
 const reader=request.body?.getReader();let body='';if(reader){const decoder=new TextDecoder();let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16000){await reader.cancel();return reply({error:'Request too large'},413);}body+=decoder.decode(part.value,{stream:true});}body+=decoder.decode();}
 if(!await verifyCollector(env.COLLECTOR_SECRET,request.headers.get('x-collector-time'),request.headers.get('x-collector-signature'),body))return reply({error:'Unauthorized'},401);
 let parsed;try{parsed=inputSchema.safeParse(JSON.parse(body));}catch{return reply({error:'Invalid request'},400);}if(!parsed.success)return reply({error:'Invalid request'},400);
 const data=parsed.data;const ids=data.action==='status'?SOURCES.map(source=>source.id):data.providers||[data.provider||''];
 if(ids.some(id=>!SOURCES.some(source=>source.id===id)))return reply({error:'Unknown provider'},400);
 const connection=(id:string)=>env.CONNECTIONS.getByName(JSON.stringify([data.owner,id]));
 try{
  if(data.action==='status'){const connections=await Promise.all(ids.map(async id=>({...await connection(id).status(),providerId:id})));const captures=(await Promise.all(ids.map(id=>connection(id).captures(data.skip||[])))).flat().slice(0,1);return reply({configured:true,connections,captures});}
  if(data.action==='start'){const dates=normalizeDates(data.requestedDates);if(!data.jobId)return reply({error:'Missing job id'},400);return reply({connections:await Promise.all(ids.map((id,index)=>connection(id).start(id,dates,!!data.consent,data.jobId!,index*25000)))});}
  if(data.action==='ack'){if(!data.captureId)return reply({error:'Missing capture'},400);await connection(ids[0]).acknowledge(data.captureId);return reply({ok:true});}
  return reply({connections:await Promise.all(ids.map(id=>connection(id).stop(data.action==='disconnect')))});
 }catch{return reply({error:'수집 요청을 처리하지 못했습니다. 다시 시도해 주세요.'},502);}
}} satisfies ExportedHandler<Settings>;
