import test from 'node:test';
import assert from 'node:assert/strict';
const origin='https://chuljang-receipts.jhleokim.chatgpt.site';
function task(state='scanning',tabId=5){return {providerId:'korail',state,tabId,count:0,visited:[],pendingUrls:[],seen:[],buttons:[],note:'',scans:0};}
async function harness(initial,pages=[]){
 const session=structuredClone(initial),local={},handlers={},tabs=new Map([[5,{id:5,url:'https://www.korail.com/ticket/mypage/ticketInfo/receipt',status:'complete',active:false}],[9,{id:9,url:origin+'/',status:'complete'}]]);let page=0,nextTab=20;
 const store=data=>({get:async keys=>Object.fromEntries(keys.filter(key=>key in data).map(key=>[key,structuredClone(data[key])])),set:async value=>Object.assign(data,structuredClone(value))});
 globalThis.chrome={storage:{session:store(session),local:store(local)},runtime:{id:'test-extension',getURL:path=>'chrome-extension://test-extension/'+path,onMessage:{addListener:fn=>handlers.message=fn},onStartup:{addListener:fn=>handlers.startup=fn}},permissions:{contains:async()=>true},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},alarms:{create:async()=>{},clear:async()=>{},onAlarm:{addListener:fn=>handlers.alarm=fn}},tabs:{get:async id=>{if(!tabs.has(id))throw Error('closed');return tabs.get(id);},query:async()=>[tabs.get(9)],create:async value=>{const tab={id:nextTab++,...value,status:'complete'};tabs.set(tab.id,tab);return tab;},update:async(id,value)=>{Object.assign(tabs.get(id),value);return tabs.get(id);},remove:async id=>tabs.delete(id),sendMessage:async()=>{},onUpdated:{addListener:fn=>handlers.updated=fn},onRemoved:{addListener:fn=>handlers.removed=fn}},scripting:{executeScript:async options=>{if(options.files)return [];if(options.func?.name==='applyReceiptDates')return [{result:{applied:false}}];if(options.args?.[0]?.button){page++;return [{result:{clicked:true}}];}return [{result:pages[page]||{state:'login',blocks:[],links:[],buttons:[],note:'login'}}];}}};
 await import('../collector/background.js?test='+Math.random());
 const sender={id:'test-extension',frameId:0,documentId:'doc-one',tab:{id:9,url:origin+'/'},url:origin+'/'};
 const send=(message,from=sender)=>new Promise(resolve=>{if(handlers.message(message,from,resolve)===false)resolve(undefined);});
 const until=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.fail('State did not settle');};
 return {session,handlers,send,sender,tabs,until};
}
test('worker restart resumes a persisted opening task without a tab',async()=>{
 const h=await harness({queue:[],destinationTabId:9,job:{id:'job',startedAt:Date.now(),requestedDates:['2026-09-11'],tasks:[task('opening',null)]}});
 h.handlers.alarm({name:'collect-watchdog'});await h.until(()=>h.session.job.tasks[0].state==='login');
 assert.ok(h.session.job.tasks[0].tabId);assert.equal(h.tabs.get(h.session.job.tasks[0].tabId).active,false);
});
test('SPA next button can advance repeatedly when receipt content changes',async()=>{
 const pages=[1,2,3].map(n=>({state:'ready',pageLabel:String(n),blocks:['승차일 2026.09.11\n결제금액 '+n+'000원'],links:[],buttons:n<3?[{label:'다음',index:0}]:[]}));
 const h=await harness({queue:[],destinationTabId:9,job:{id:'job',startedAt:Date.now(),requestedDates:['2026-09-11'],tasks:[task()]}},pages);
 for(let n=1;n<=3;n++){h.session.job.tasks[0].lastScan=0;h.handlers.updated(5,{status:'complete'});await h.until(()=>h.session.job.tasks[0].count===n);await h.send({type:'STATUS'});}
 assert.equal(h.session.job.tasks[0].count,3);assert.equal(h.session.job.tasks[0].buttons.length,2);assert.equal(h.session.job.tasks[0].state,'partial');assert.equal(h.session.queue.length,3);
});
test('only bound authenticated-origin tab can consume a queue; deferred captures return after reload',async()=>{
 const capture={captureId:'receipt',packet:{source:'ktx',blocks:['receipt']},expires:Date.now()+60000};
 const h=await harness({queue:[capture],destinationTabId:9,job:null});
 assert.equal((await h.send({type:'GET_CAPTURE'})).captureId,'receipt');
 await h.send({type:'DEFER_CAPTURE',captureId:'receipt'});assert.equal(await h.send({type:'GET_CAPTURE'}),null);
 assert.equal((await h.send({type:'GET_CAPTURE'},{...h.sender,documentId:'doc-two'})).captureId,'receipt');
 await h.send({type:'ACK_CAPTURE',captureId:'receipt'},{...h.sender,tab:{id:77,url:origin+'/'}});assert.equal(h.session.queue.length,1);
 await h.send({type:'ACK_CAPTURE',captureId:'receipt'},{...h.sender,tab:{id:9,url:'https://attacker.invalid/'},url:'https://attacker.invalid/'});assert.equal(h.session.queue.length,1);
 await h.send({type:'ACK_CAPTURE',captureId:'receipt'});assert.equal(h.session.queue.length,0);
});

test('START requires dates and keeps an immutable scope through restart and popup setup',async()=>{
 const h=await harness({queue:[],destinationTabId:9,job:null});
 assert.equal((await h.send({type:'START'})).ok,false);assert.equal(h.session.job,null);
 const dates=['2026-09-09','2026-09-11'];assert.equal((await h.send({type:'START',requestedDates:dates})).ok,true);
 dates.push('2026-09-10');assert.deepEqual(h.session.job.requestedDates,['2026-09-09','2026-09-11']);
 await h.send({type:'START',requestedDates:['2026-08-01']});assert.deepEqual(h.session.job.requestedDates,['2026-09-09','2026-09-11']);
});
test('partial history resumes after opening the official date filter',async()=>{
 const h=await harness({queue:[],destinationTabId:9,job:{id:'job',startedAt:Date.now(),requestedDates:['2026-09-11'],tasks:[task('partial')]}});
 await h.send({type:'OPEN_SOURCE',providerId:'korail'});assert.equal(h.session.job.tasks[0].state,'attention');
});
