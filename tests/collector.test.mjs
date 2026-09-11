import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {SOURCES,originsFor,safeReadLink} from '../collector/providers.js';
import {enqueue,acknowledge,freshQueue} from '../collector/queue.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('queue retains both sources, ignores unrelated ACKs, and expires unsaved captures',()=>{
 const now=Date.now(),first={source:'ktx',blocks:['ktx']},second={source:'socar',blocks:['socar']};
 const queue=enqueue(enqueue([],first,'one',now),second,'two',now);
 assert.deepEqual(queue.map(item=>item.captureId),['one','two']);
 assert.equal(acknowledge(queue,'wrong').length,2);
 assert.deepEqual(acknowledge(queue,'one').map(item=>item.captureId),['two']);
 assert.equal(freshQueue(queue,now+31*60*1000).length,0);
});
test('automatic navigation stays on allowed HTTPS read-only service pages',()=>{
 const source=SOURCES[0];
 assert.ok(safeReadLink('https://www.korail.com/ticket/mypage/ticketInfo/receipt','이용내역/영수증 조회',source));
 for(const [url,label] of [['https://attacker.invalid/receipt','영수증'],['https://www.korail.com.attacker.invalid/','영수증'],['javascript:pay()','영수증'],['https://www.korail.com/cancel','예약 취소'],['https://www.korail.com/action?mode=pay','상세 보기'],['https://www.korail.com/book','예매하기']])assert.equal(safeReadLink(url,label,source),false);
 assert.ok(originsFor(['korail']).every(value=>!value.includes('*://')&&!value.includes('https://*')));
});
test('bridge waits for login and actual save, defers review, then drains other sources',async()=>{
 const calls=[],posted=[],held=new Set(),queue=[{captureId:'first',packet:{source:'ktx',blocks:['one']}},{captureId:'second',packet:{source:'socar',blocks:['two']}}];let listener;
 const context={location:{origin:'https://chuljang-receipts.jhleokim.chatgpt.site'},setInterval:()=>0,chrome:{runtime:{onMessage:{addListener(){}},sendMessage:async message=>{calls.push(message);if(message.type==='GET_CAPTURE')return queue.find(item=>!held.has(item.captureId))||null;if(message.type==='DEFER_CAPTURE')held.add(message.captureId);if(message.type==='ACK_CAPTURE'){const index=queue.findIndex(item=>item.captureId===message.captureId);if(index>=0)queue.splice(index,1);}return {ok:true};}}}};
 context.window={addEventListener:(_name,fn)=>{listener=fn;},postMessage:message=>posted.push(message)};
 vm.runInNewContext(readFileSync(new URL('../collector/bridge.js',import.meta.url),'utf8'),context);
 const emit=data=>listener({source:context.window,origin:context.location.origin,data});
 assert.equal(calls.length,0);
 listener({source:context.window,origin:'https://attacker.invalid',data:{type:'CHULJANG_READY'}});assert.equal(calls.length,0);
 emit({type:'CHULJANG_READY'});await tick();assert.equal(posted.at(-1).captureId,'first');
 emit({type:'CHULJANG_STAGED',captureId:'first'});await tick();assert.equal(queue.length,2);
 emit({type:'CHULJANG_REVIEW_PENDING',captureId:'first'});await tick();assert.equal(posted.at(-1).captureId,'second');assert.equal(queue.length,2);
 emit({type:'CHULJANG_SAVED',captureId:'wrong'});await tick();assert.equal(queue.length,2);
 emit({type:'CHULJANG_SAVED',captureId:'second'});await tick();assert.equal(queue.length,1);
 emit({type:'CHULJANG_SAVED',captureId:'first'});await tick();assert.equal(queue.length,0);
});
