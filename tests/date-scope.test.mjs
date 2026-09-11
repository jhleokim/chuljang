import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDates,matchTravelDate} from '../collector/date-scope.js';
import {prepareAutomaticImport,automaticImportBody} from '../lib/auto-import.ts';
import {draftErrors} from '../lib/draft-review.ts';
import {applyReceiptDates} from '../collector/date-filter.js';
const days=['2026-09-09','2026-09-11'];
test('date sets preserve gaps, deduplicate and reject invalid calendars and empty scope',()=>{
 assert.deepEqual(normalizeDates([days[1],days[0],days[1]]),days);
 assert.deepEqual(normalizeDates(['2024-02-29']),['2024-02-29']);
 for(const value of [[],['2026-02-29'],['2026-09-31'],['2026-9-09'],Array(63).fill(days[0])])assert.throws(()=>normalizeDates(value));
});
test('automatic trip scope uses travel dates, excludes gaps and reviews issuance-only receipts',()=>{
 const result=prepareAutomaticImport('ktx',[
  '발급일 2026.08.20\n승차일 2026.09.09\n결제금액 59,800원',
  '결제일 2026.09.09\n승차일 2026.09.10\n결제금액 59,800원',
  '발급일 2026.09.11\n결제금액 59,800원',
  '대여일 2026.09.09 ~ 2026.09.11\n결제금액 150,000원',
  '탑승일 2026.09.09\n탑승일 2026.09.11\n결제금액 150,000원'
 ],'',days);
 assert.equal(result.ready.length,1);assert.equal(result.ready[0].date,days[0]);
 assert.equal(result.review.length,3);assert.ok(result.review.every(row=>row.date===''));
 assert.deepEqual(JSON.parse(automaticImportBody(result.ready,days).get('requestedDates')),days);
 assert.equal(matchTravelDate('승차일 2026.09.10',days).kind,'outside');
});
test('review corrections stay bound to the original job date set',()=>{
 const draft={key:'one',source:'ktx',date:'2026-09-10',amount:1000,merchant:'KTX',issues:[],requestedDates:days};
 assert.ok(draftErrors(draft).date);assert.deepEqual(draftErrors({...draft,date:days[0]}),{});
});
test('date form adaptation only edits native travel range fields, never login or payment filters',()=>{
 class Input {constructor(label){this.type='date';this.labels=[{innerText:label}];this.disabled=false;this.readOnly=false;this.events=[];}getClientRects(){return [1];}getAttribute(){return '';}closest(){return group;}set value(v){this.current=v;}get value(){return this.current;}dispatchEvent(e){this.events.push(e.type);}checkValidity(){return true;}}
 let clicks=0;const start=new Input('시작일'),end=new Input('종료일');
 const button={innerText:'조회',getClientRects:()=>[1],getAttribute:()=>'',click:()=>clicks++};
 const group={innerText:'승차일 시작일 종료일 조회',querySelectorAll:()=>[button]};
 const old={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle,HTMLInputElement:globalThis.HTMLInputElement};
 globalThis.HTMLInputElement=Input;globalThis.getComputedStyle=()=>({visibility:'visible'});
 let inputs=[start,end];globalThis.document={querySelectorAll:selector=>selector==='input'?inputs:[start,end]};
 try{
  assert.equal(applyReceiptDates(days).applied,true);assert.equal(start.value,days[0]);assert.equal(end.value,days[1]);assert.equal(clicks,1);
  group.innerText='결제일 시작일 종료일 조회';assert.equal(applyReceiptDates(days).applied,false);
  group.innerText='승차일 시작일 종료일 조회';inputs.push(Object.assign(new Input('로그인'),{type:'password'}));assert.equal(applyReceiptDates(days).applied,false);assert.equal(clicks,1);
 }finally{Object.assign(globalThis,old);}
});
