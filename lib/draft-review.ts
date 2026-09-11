import { candidateSchema, type Candidate, type Source } from './receipts.ts';

export type Draft = Partial<Candidate> & { source: Source; key: string; issues: string[]; pageNumber?: number; captureId?: string };
export type DraftField = 'date' | 'amount' | 'merchant' | 'reference';
const messages: Record<DraftField, string> = {
  date: '올바른 이용일을 입력해 주세요.',
  amount: '0~100,000,000 사이의 원화 금액을 정수로 입력해 주세요.',
  merchant: '이용내역을 1~150자로 입력해 주세요.',
  reference: '승인·예약번호는 120자까지 입력할 수 있어요.',
};
export function draftErrors(draft: Draft): Partial<Record<DraftField, string>> {
  const result = candidateSchema.safeParse(draft);
  if (result.success) return {};
  const errors: Partial<Record<DraftField, string>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as DraftField;
    if (field in messages) errors[field] = messages[field];
  }
  return errors;
}
export function sourceWarnings(draft: Draft) {
  return draft.issues.filter(issue => issue !== '이용 날짜 확인' && issue !== '결제 금액 확인');
}
