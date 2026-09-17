import {HomeCollector} from './collector.ts';
import {HomeStorage} from './storage.mjs';
import {openBrowser} from './browser.mjs';
import {collectKorailDay} from '../server-collector/korail.ts';

// One display/port is leased to exactly one browser until its processes exit.
// At most one browser per person; the small global pool bounds home-server load.
export class BrowserPool {
 private free:number[]; private owners=new Set<string>();
 private queue:{owner:string;signal:AbortSignal;resolve:(lease:{slot:number;release:()=>void})=>void;reject:(error:Error)=>void;abort:()=>void}[]=[];
 constructor(size=2){this.free=Array.from({length:size},(_,index)=>index);}
 acquire(owner:string,signal:AbortSignal):Promise<{slot:number;release:()=>void}>{
  if(signal.aborted)return Promise.reject(new Error('Collector closed'));
  return new Promise((resolve,reject)=>{
   const entry={owner,signal,resolve,reject,abort:()=>{this.queue=this.queue.filter(value=>value!==entry);reject(new Error('Collector closed'));}};
   signal.addEventListener('abort',entry.abort,{once:true});this.queue.push(entry);this.drain();
  });
 }
 private drain(){
  while(this.free.length){const index=this.queue.findIndex(entry=>!this.owners.has(entry.owner));if(index<0)return;
   const [entry]=this.queue.splice(index,1);entry.signal.removeEventListener('abort',entry.abort);
   const slot=this.free.shift()!;this.owners.add(entry.owner);let released=false;
   entry.resolve({slot,release:()=>{if(released)return;released=true;this.owners.delete(entry.owner);this.free.push(slot);this.drain();}});
  }
 }
}
export class HomeCollectors {
 private entries=new Map<string,{collector:HomeCollector;abort:AbortController}>();
 private revoking=new Set<string>();
 private pool=new BrowserPool(2);private closing=false;
 private storage:HomeStorage;private secret:string;private launch:typeof openBrowser;private collectDay:typeof collectKorailDay;
 constructor(storage:HomeStorage,secret:string,launch=openBrowser,collectDay=collectKorailDay){this.storage=storage;this.secret=secret;this.launch=launch;this.collectDay=collectDay;}
 get sessions(){const result=new Map();for(const {collector}of this.entries.values())for(const [id,session]of collector.sessions)result.set(id,session);return result;}
 private forOwner(owner:string){
  if(this.closing||this.revoking.has(owner)||!this.storage.sql.prepare('SELECT 1 FROM home_users WHERE id=? AND disabled=0').get(owner))throw new Error('Unknown collector owner');
  let entry=this.entries.get(owner);if(entry)return entry.collector;
  const abort=new AbortController();
  const launch:typeof openBrowser=async(_slot,saved,options)=>{
   const lease=await this.pool.acquire(owner,abort.signal);
   try{
    if(abort.signal.aborted)throw new Error('Collector closed');
    const browser=await this.launch(lease.slot,saved,options);let closing:Promise<void>|undefined;
    return {...browser,close:()=>closing||=(async()=>{try{await browser.close();}finally{lease.release();}})()};
   }catch(error){lease.release();throw error;}
  };
  entry={collector:new HomeCollector(this.storage,this.secret,owner,launch,this.collectDay),abort};this.entries.set(owner,entry);return entry.collector;
 }
 request(owner:string,values:Record<string,unknown>){return this.forOwner(owner).request(owner,values);}
 resume(){for(const row of this.storage.sql.prepare('SELECT id FROM home_users WHERE disabled=0').all())this.forOwner(String(row.id)).resume();}
 async revoke(owner:string){
  this.revoking.add(owner);
  try{
  const entry=this.entries.get(owner);if(entry){entry.abort.abort();await entry.collector.close();this.entries.delete(owner);}
  // Scope by parsed key, never a prefix which could include another account.
  for(const row of this.storage.sql.prepare('SELECT key FROM home_state').all()){
   let key;try{key=JSON.parse(String(row.key));}catch{continue;}
   if(Array.isArray(key)&&key[0]==='collector'&&key[1]===owner)this.storage.delete(String(row.key));
  }
  }finally{this.revoking.delete(owner);}
 }
 async close(){this.closing=true;for(const entry of this.entries.values())entry.abort.abort();await Promise.all([...this.entries.values()].map(entry=>entry.collector.close()));this.entries.clear();}
}
