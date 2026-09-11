import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, isDate, candidateSchema, csvCell, safeSourceUrl } from '../lib/receipts.ts';
test('KTX travel date takes priority over issuance date',()=>{
 const r=parseReceipt('발급일: 2026.09.09\n승차일: 2026.09.11\n출발: 서울\n도착: 부산\n운임 62,000원\n총 결제금액 59,800원\n예약번호 ABCD1234','ktx');
 assert.equal(r.date,'2026-09-11');assert.equal(r.amount,59800);assert.equal(r.merchant,'서울 → 부산');assert.equal(r.reference,'ABCD1234');
});
test('amount next line and zero are preserved',()=>{
 assert.equal(parseReceipt('이용일 2026년 9월 11일\n결제금액\n12,000원','kakaot').amount,12000);
 assert.equal(parseReceipt('이용일 2026-09-11\n결제금액 0원','socar').amount,0);
});
test('ambiguous totals require review',()=>{assert.equal(parseReceipt('결제금액 12,000원\n결제금액 15,000원','tmoney').amount,undefined);});
test('negative and foreign amounts never become positive KRW',()=>{
 for(const total of ['-12,000원','−12,000원','(12,000원)','－12,000원','USD 120.00','$120.00','120.50원']){
  assert.equal(parseReceipt('이용일 2026-09-11\n결제금액 '+total,'airline').amount,undefined,total);
 }
});
test('card numbers, dates, tax amounts are not expenses',()=>{
 for(const text of ['카드번호 1234-5678-1234-5678','결제금액 2026-09-11','부가세 금액 10,000원','총액 -2000']){
  assert.equal(parseReceipt(text,'ktx').amount,undefined,text);
 }
});
test('calendar and import validation reject impossible dates',()=>{
 assert.equal(isDate('2026-02-30'),false);assert.equal(isDate('2024-02-29'),true);
 assert.equal(candidateSchema.safeParse({source:'ktx',date:'2026-09-11',merchant:'서울',amount:-1}).success,false);
});
test('CSV formula injection is escaped, URL queries removed',()=>{
 assert.equal(csvCell('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"');
 assert.equal(safeSourceUrl('https://example.com/receipt?token=secret#anchor'),'https://example.com/receipt');
 assert.equal(safeSourceUrl('javascript:alert(1)'),'');
});

