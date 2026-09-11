import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAutomaticImport,automaticImportBody} from '../lib/auto-import.ts';
test('automatic import saves only unambiguous records and retains foreign/cancelled/incomplete receipts for review',()=>{
 const result=prepareAutomaticImport('ktx',['승차일 2026.09.11\n결제금액 59,800원','결제금액 USD 40','승차일 2026.09.11\n결제금액 20,000원\n취소 완료','승차일 2026.09.11\n결제금액 12,000원\n결제금액 15,000원']);
 assert.equal(result.ready.length,1);assert.equal(result.ready[0].amount,59800);assert.equal(result.review.length,3);
});
test('large Korean text uses multipart without exceeding the API JSON body cap',()=>{
 const rows=Array.from({length:100},()=>({source:'ktx',date:'2026-09-11',merchant:'서울',amount:59800,reference:'',sourceUrl:'',raw:'가'.repeat(12000)}));
 const body=automaticImportBody(rows);assert.ok(body instanceof FormData);assert.deepEqual(JSON.parse(body.get('receipts')),rows);assert.ok(new TextEncoder().encode(body.get('receipts')).byteLength>300000);
});
test('ordinary cancelled and refunded history statuses never auto-save as spend',()=>{
 for(const status of ['예약상태: 취소','결제 상태: 환불','취소','Status: cancelled','Status: refunded']){
  const result=prepareAutomaticImport('ktx',['이용일: 2026.09.11\n결제금액: 59,800원\n'+status]);
  assert.equal(result.ready.length,0,status);assert.equal(result.review.length,1,status);
 }
});
