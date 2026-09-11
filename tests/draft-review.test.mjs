import test from 'node:test';
import assert from 'node:assert/strict';
import { draftErrors, sourceWarnings } from '../lib/draft-review.ts';
import { parseReceipt } from '../lib/receipts.ts';
import { readReceiptFile } from '../lib/read-file.ts';

test('correcting a draft clears input errors while retaining source cautions', () => {
  const draft = { ...parseReceipt('취소 완료\n결제금액 USD 40', 'airline'), key: 'draft-1' };
  assert.deepEqual(Object.keys(draftErrors(draft)), ['date', 'amount']);
  const corrected = { ...draft, date: '2026-09-11', amount: 52000 };
  assert.deepEqual(draftErrors(corrected), {});
  assert.deepEqual(sourceWarnings(corrected), ['외화 영수증: 원화 실결제 금액 입력', '취소·환불 여부 확인']);
  assert.ok(!sourceWarnings(corrected).includes('이용 날짜 확인'));
});

test('review fields reject impossible dates, blank descriptions, and fractional or negative KRW', () => {
  const draft = { source: 'ktx', date: '2026-02-30', merchant: ' ', amount: -1200, key: 'draft-2', issues: [] };
  assert.deepEqual(Object.keys(draftErrors(draft)), ['date', 'merchant', 'amount']);
  assert.ok(draftErrors({ ...draft, amount: 12.5 }).amount);
  assert.deepEqual(draftErrors({ ...draft, date: '2026-02-28', merchant: '서울 → 부산', amount: 0 }), {});
});

test('cancelled file reads exit before allocating a browser OCR worker', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readReceiptFile(new File(['receipt'], 'receipt.png', { type: 'image/png' }), () => assert.fail('No progress after cancellation'), controller.signal), { name: 'AbortError' });
});
