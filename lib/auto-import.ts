import { candidateSchema, parseReceipt, type Candidate, type Source } from './receipts.ts';

export function prepareAutomaticImport(source: Source, blocks: string[], sourceUrl = '') {
  const ready: Candidate[] = [];
  const review: ReturnType<typeof parseReceipt>[] = [];
  for (const block of blocks) {
    const parsed = { ...parseReceipt(block, source), sourceUrl };
    const candidate = candidateSchema.safeParse(parsed);
    if (candidate.success && !parsed.issues.length) ready.push(candidate.data);
    else review.push(parsed);
  }
  return { ready, review };
}

// Multipart keeps Korean text batches under the existing 14 MB import limit.
export function automaticImportBody(rows: Candidate[]) {
  const body = new FormData(); body.set('receipts', JSON.stringify(rows)); return body;
}
