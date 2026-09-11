import { candidateSchema, parseReceipt, type Candidate, type Source } from './receipts.ts';
import { matchTravelDate, normalizeDates } from '../collector/date-scope.js';

export function prepareAutomaticImport(source: Source, blocks: string[], sourceUrl = '', requestedDates?: string[]) {
  const scope = requestedDates ? normalizeDates(requestedDates) : null;
  const ready: Candidate[] = [];
  const review: ReturnType<typeof parseReceipt>[] = [];
  for (const block of blocks) {
    const parsed = { ...parseReceipt(block, source), sourceUrl };
    if (scope) {
      const match = matchTravelDate(block, scope);
      if (match.kind === 'outside') continue;
      parsed.date = match.date;
      if (match.kind === 'review') parsed.issues.push('선택한 출장일 중 실제 이용일 확인 (여러 이용일은 금액 중복 주의)');
    }
    const candidate = candidateSchema.safeParse(parsed);
    if (candidate.success && !parsed.issues.length) ready.push(candidate.data);
    else review.push(parsed);
  }
  return { ready, review };
}

// Multipart keeps Korean text batches under the existing 14 MB import limit.
export function automaticImportBody(rows: Candidate[], requestedDates?: string[]) {
  const body = new FormData(); body.set('receipts', JSON.stringify(rows));
  if (requestedDates) body.set('requestedDates', JSON.stringify(normalizeDates(requestedDates)));
  return body;
}
