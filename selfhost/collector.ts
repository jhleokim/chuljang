import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SOURCES, allowedUrl } from '../collector/providers.js';
import { normalizeDates, matchTravelDate } from '../collector/date-scope.js';
import { sealCollector, openCollector } from '../lib/collector-security.ts';
import { serviceLoginState } from '../server-collector/history-dom.ts';
import { inspectMemberControls } from '../server-collector/member-inspection.ts';
import { collectKorailDay, korailDayUrl } from '../server-collector/korail.ts';
import {collectMemberDay,MemberHistoryError,transitAvailability} from '../server-collector/member-history.ts';
import { HomeStorage } from './storage.mjs';
import { openBrowser } from './browser.mjs';

type Meta={providerId:string;state:string;connected:boolean;note:string;count:number;pending:string[];requestedDates:string[];completedDates:string[];generation:number;consentedAt?:string;jobId?:string;inspection?:unknown;loginUrl?:string;unavailableDates?:{date:string;reason:string}[]};
type Session={owner:string;provider:string;generation:number;port:number;close:()=>Promise<void>};
const active=(state:string)=>['queued','opening','login','collecting'].includes(state);
const input=z.object({action:z.enum(['status','start','stop','disconnect','ack']),providers:z.array(z.string()).min(1).max(6).optional(),requestedDates:z.array(z.string()).min(1).max(62).optional(),consent:z.boolean().optional(),jobId:z.string().uuid().optional(),provider:z.string().optional(),captureId:z.string().uuid().optional(),skip:z.array(z.string().uuid()).max(200).optional()});
class Revoked extends Error {}
export class HomeCollector {
  sessions=new Map<string,Session>();
  private running=new Map<string,Promise<void>>();
  private closing=false;
  private requests:Promise<unknown>=Promise.resolve();
  private storage:HomeStorage;
  private secret:string;
  private ownerId:string;
  private launch:typeof openBrowser;
  private collectDay:typeof collectKorailDay;
  constructor(storage:HomeStorage,secret:string,ownerId:string,launch=openBrowser,collectDay=collectKorailDay){
    this.storage=storage;this.secret=secret;this.ownerId=ownerId;this.launch=launch;this.collectDay=collectDay;
    if(secret.length<40)throw new Error('Missing collector encryption key');
    for(const source of SOURCES){const meta=this.meta(source.id);if(active(meta.state)){meta.state='queued';meta.loginUrl=undefined;this.save(meta);}}
  }
  private key(provider:string,suffix='meta'){return JSON.stringify(['collector',this.ownerId,provider,suffix]);}
  private meta(provider:string):Meta{return this.storage.get(this.key(provider))||{providerId:provider,state:'disconnected',connected:false,note:'',count:0,pending:[],requestedDates:[],completedDates:[],generation:0};}
  private save(meta:Meta){this.storage.set(this.key(meta.providerId),meta);}
  private alive(provider:string,generation:number){const meta=this.meta(provider);if(meta.generation!==generation||this.closing)throw new Revoked();return meta;}
  private patch(provider:string,generation:number,values:Partial<Meta>){const meta=this.alive(provider,generation);this.save({...meta,...values});}
  private async putSecret(provider:string,suffix:string,value:unknown,generation:number){const key=this.key(provider,suffix);const sealed=await sealCollector(this.secret,key,value);this.alive(provider,generation);this.storage.set(key,sealed);}
  private async getSecret<T>(provider:string,suffix:string){const key=this.key(provider,suffix),value=this.storage.get(key);return value?await openCollector<T>(this.secret,key,value):undefined;}
  resume(){for(const source of SOURCES){const meta=this.meta(source.id);if(source.id==='tmoneyTransit'&&meta.state==='partial'&&meta.unavailableDates?.some(item=>!transitAvailability(item.date))){this.save({...meta,state:'queued',unavailableDates:meta.unavailableDates.filter(item=>!!transitAvailability(item.date))});}this.schedule(source.id);}}
  private schedule(provider:string){
    if(this.closing||this.running.has(provider)||!active(this.meta(provider).state))return;
    const operation=this.run(provider).finally(()=>{this.running.delete(provider);if(!this.closing&&this.meta(provider).state==='queued')this.schedule(provider);});
    this.running.set(provider,operation);void operation.catch(()=>{});
  }
  request(owner:string,values:Record<string,unknown>):Promise<unknown>{
    const operation=this.requests.then(()=>this.handleRequest(owner,values));
    this.requests=operation.catch(()=>{});return operation;
  }
  private async handleRequest(owner:string,values:Record<string,unknown>){
    if(owner!==this.ownerId)throw new Error('Owner mismatch');
    const data=input.parse(values),ids=data.action==='status'?SOURCES.map(source=>source.id):[...new Set(data.providers||[data.provider||''])];
    if(ids.some(id=>!SOURCES.some(source=>source.id===id)))throw new Error('Unknown provider');
    if(data.action==='status'){
      this.resume();const connections=ids.map(id=>{const meta=this.meta(id);return {...meta,pending:meta.pending.length};});
      const captures=[];
      for(const id of ids){const captureId=this.meta(id).pending.find(value=>!data.skip?.includes(value));if(captureId){captures.push({providerId:id,captureId,packet:await this.getSecret(id,'capture:'+captureId)});break;}}
      return {configured:true,connections,captures};
    }
    if(data.action==='ack'){
      if(!data.captureId)throw new Error('Missing capture');const meta=this.meta(ids[0]);
      this.storage.transaction(()=>{this.storage.delete(this.key(ids[0],'capture:'+data.captureId));meta.pending=meta.pending.filter(id=>id!==data.captureId);this.save(meta);});return {ok:true};
    }
    const dates=data.action==='start'?normalizeDates(data.requestedDates):[];
    for(const id of ids){
      let meta=this.meta(id);
      if(data.action==='start'){
        if(!data.jobId||!meta.consentedAt&&!data.consent)throw new Error('Missing consent or job');
        if(meta.jobId===data.jobId){if(JSON.stringify(meta.requestedDates)!==JSON.stringify(dates))throw new Error('Changed idempotent request');continue;}
        if(meta.pending.length>=100)throw new Error('Pending capture capacity exceeded');
        if(['opening','login','queued'].includes(meta.state)&&!meta.connected){this.save({...meta,requestedDates:dates,completedDates:[],jobId:data.jobId});continue;}
        this.save({...meta,generation:meta.generation+1,state:'stopped'});await this.closeProvider(id);
        meta=this.meta(id);this.save({...meta,state:'queued',requestedDates:dates,completedDates:[],count:0,unavailableDates:[],inspection:undefined,loginUrl:undefined,jobId:data.jobId,consentedAt:meta.consentedAt||new Date().toISOString(),note:'공식 사이트를 준비하고 있어요.'});this.schedule(id);
      }else{
        const revoke=data.action==='disconnect';
        this.storage.transaction(()=>{
          if(revoke){this.storage.delete(this.key(id,'auth'));for(const capture of meta.pending)this.storage.delete(this.key(id,'capture:'+capture));}
          this.save({...meta,generation:meta.generation+1,state:revoke?'disconnected':'stopped',connected:revoke?false:meta.connected,consentedAt:revoke?undefined:meta.consentedAt,pending:revoke?[]:meta.pending,inspection:undefined,loginUrl:undefined,note:revoke?'연결을 해제했습니다.':'수집을 멈췄습니다.'});
        });await this.closeProvider(id);
      }
    }
    return {connections:ids.map(id=>{const meta=this.meta(id);return {...meta,pending:meta.pending.length};})};
  }
  private async closeProvider(provider:string){for(const [id,session]of this.sessions){if(session.provider===provider){this.sessions.delete(id);await session.close();}}}
  private async run(provider:string){
    const generation=this.meta(provider).generation,source=SOURCES.find(value=>value.id===provider)!,slot=SOURCES.indexOf(source);
    let browser:Awaited<ReturnType<typeof openBrowser>>|undefined;const id=randomBytes(24).toString('hex');
    try{
      this.patch(provider,generation,{state:'opening',loginUrl:undefined});
      browser=await this.launch(slot,await this.getSecret(provider,'auth'));this.alive(provider,generation);
      this.sessions.set(id,{owner:this.ownerId,provider,generation,port:browser.port,close:browser.close});
      const {page,context}=browser;
      await page.goto(source.startUrl,{waitUntil:'domcontentloaded',timeout:30000});
      const verified=async()=>{try{return allowedUrl(page.url(),source)&&await page.evaluate(serviceLoginState,provider);}catch(error){if(/Execution context was destroyed|Cannot find context/i.test(String(error)))return false;throw error;}};
      if(!await verified()){
        this.patch(provider,generation,{state:'login',connected:false,loginUrl:'/remote/'+id+'/',note:'공식 사이트에 로그인하면 날짜 조회를 자동으로 이어갑니다.'});
        const deadline=Date.now()+300000;
        while(!await verified()){
          this.alive(provider,generation);if(Date.now()>deadline)throw new Error('Login expired');
          await new Promise(resolve=>setTimeout(resolve,1500));
        }
        await page.goto(source.startUrl,{waitUntil:'domcontentloaded',timeout:30000});
        if(!await verified())throw new Error('Login could not be verified');
      }
      this.sessions.delete(id);
      await this.putSecret(provider,'auth',await context.storageState({indexedDB:true}),generation);
      this.patch(provider,generation,{connected:true,state:'collecting',loginUrl:undefined,note:'선택한 출장 날짜를 조회하고 있어요.'});
      if(!['korail','tmoneyTransit','kobus'].includes(provider)){
        this.patch(provider,generation,{state:'adapter_pending',inspection:await page.evaluate(inspectMemberControls),note:'로그인은 연결됐습니다. 회원 조회 화면에 맞춘 자동 수집 검증이 아직 필요합니다.'});return;
      }
      for(;;){
        const meta=this.alive(provider,generation),day=meta.requestedDates.find(date=>!meta.completedDates.includes(date)&&!meta.unavailableDates?.some(item=>item.date===date));
        if(!day){const deferred=meta.unavailableDates||[];this.patch(provider,generation,{state:deferred.length?'partial':'complete',note:meta.completedDates.length+'일 조회 완료 · '+meta.count+'건'+(deferred.length?' · '+deferred.length+'일 조회 불가: '+deferred[0].reason:'')});break;}
        if(provider==='tmoneyTransit'){const reason=transitAvailability(day);if(reason){this.patch(provider,generation,{unavailableDates:[...(meta.unavailableDates||[]),{date:day,reason}]});continue;}}
        this.patch(provider,generation,{note:day+' 이용내역과 영수증을 조회하고 있어요.'});
        const result=provider==='korail'?await this.collectDay(page as unknown as import('@cloudflare/playwright').Page,day,async()=>this.alive(provider,generation)):await collectMemberDay(page,provider,day,async()=>this.alive(provider,generation));
        if(result.blocks.some(block=>matchTravelDate(block,[day]).kind!=='match'))throw new Error('Receipt date mismatch');
        const captureId=randomUUID();let sealed:string|undefined;
        if(result.blocks.length){sealed=await sealCollector(this.secret,this.key(provider,'capture:'+captureId),{version:3,automatic:true,source:source.source,requestedDates:meta.requestedDates,blocks:result.blocks,sourceUrl:provider==='korail'?korailDayUrl(day):source.startUrl,attachment:result.attachment});}
        this.storage.transaction(()=>{
          const current=this.alive(provider,generation);
          if(sealed)this.storage.set(this.key(provider,'capture:'+captureId),sealed);
          this.save({...current,pending:sealed?[...current.pending,captureId]:current.pending,completedDates:[...current.completedDates,day],count:current.count+result.blocks.length});
        });
        await this.putSecret(provider,'auth',await context.storageState({indexedDB:true}),generation);
      }
    }catch(error){
      if(!(error instanceof Revoked)&&this.meta(provider).generation===generation&&!this.closing){
        console.error('home_collector_failed',{provider,kind:error instanceof Error?error.name:'Error'});
        const inspection=browser?await browser.page.evaluate(inspectMemberControls).catch(()=>undefined):undefined;
        this.patch(provider,generation,{state:'error',inspection,loginUrl:undefined,note:error instanceof MemberHistoryError?error.message:error instanceof Error&&error.message==='Login expired'?'로그인 시간이 만료됐어요. 다시 연결해 주세요.':'서비스 연결 또는 날짜 조회를 마치지 못했습니다. 다시 연결해 주세요.'});
      }
    }finally{this.sessions.delete(id);await browser?.close().catch(()=>{});}
  }
  async close(){this.closing=true;await Promise.all([...this.sessions.values()].map(value=>value.close()));this.sessions.clear();await Promise.allSettled(this.running.values());}
}
