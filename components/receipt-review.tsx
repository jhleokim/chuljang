'use client';
import { useEffect, useState } from 'react';
import { AlertCircle, ArrowUpRight, Check, CheckCheck, ChevronLeft, ChevronRight, FileText, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sourceNames } from '@/lib/receipts';
import { draftErrors, sourceWarnings, type Draft } from '@/lib/draft-review';

export function ReceiptOriginal({ file, raw, pageNumber, loading = false }: { file?: Blob; raw?: string; pageNumber?: number; loading?: boolean }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file) { setUrl(''); return; }
    const value = URL.createObjectURL(file); setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [file]);
  const previewUrl = url && file?.type === 'application/pdf' && pageNumber ? url + '#page=' + pageNumber : url;
  return <aside className="original-panel">
    <div className="original-heading"><strong><FileText size={16}/> 영수증 원본{pageNumber ? ` · ${pageNumber}쪽` : ''}</strong>{url && <a href={previewUrl} target="_blank" rel="noreferrer">크게 보기 <ArrowUpRight size={14}/></a>}</div>
    {loading ? <p className="original-placeholder" role="status">원본을 불러오는 중…</p> : url ? <>
      {file?.type === 'application/pdf' ? <object className="original-document" data={previewUrl} type="application/pdf"><p>이 기기에서는 PDF 미리보기를 지원하지 않아요. <a href={previewUrl} target="_blank" rel="noreferrer">PDF 열기</a></p></object> : <img className="original-image" src={url} alt="검토 중인 영수증 원본"/>}
      <details className="raw-details"><summary>인식한 텍스트 보기</summary><pre>{raw || '인식한 텍스트가 없어요.'}</pre></details>
    </> : <pre className="original-text">{raw || '첨부된 원본이 없어요. 이용내역을 직접 확인해 주세요.'}</pre>}
  </aside>;
}

export function ReceiptReview({ drafts, files, index, setIndex, busy, update, remove, clear, save }: {
  drafts: Draft[]; files: File[]; index: number; setIndex: (value: number) => void; busy: boolean;
  update: (key: string, patch: Partial<Draft>) => void; remove: (key: string) => void; clear: () => void; save: () => void;
}) {
  const currentIndex = Math.min(index, drafts.length - 1);
  const draft = drafts[currentIndex];
  if (!draft) return null;
  const errors = draftErrors(draft), warnings = sourceWarnings(draft);
  const incomplete = drafts.filter(row => Object.keys(draftErrors(row)).length).length;
  const inputProps = (field: keyof typeof errors) => ({ id: 'draft-' + field, 'aria-invalid': !!errors[field], 'aria-describedby': errors[field] ? 'error-' + field : undefined });
  const error = (field: keyof typeof errors) => errors[field] && <small id={'error-' + field} className="field-error">{errors[field]}</small>;
  return <div className="review-workspace">
    <div className="review-overview"><div><h3>원본과 나란히 확인하세요</h3><p>자동 인식한 날짜와 금액을 확인한 뒤 저장해 주세요.</p></div><Button variant="ghost" size="sm" disabled={busy} onClick={clear}><Trash2 size={15}/> 전체 비우기</Button></div>
    <nav className="review-pagination" aria-label="가져온 영수증 탐색">
      <Button variant="outline" size="icon" aria-label="이전 영수증" disabled={busy || currentIndex === 0} onClick={() => setIndex(currentIndex - 1)}><ChevronLeft/></Button>
      <label className="review-picker"><span>영수증</span><select aria-label="검토할 영수증 선택" value={currentIndex} disabled={busy} onChange={event => setIndex(Number(event.target.value))}>{drafts.map((row, i) => <option key={row.key} value={i}>{i + 1} / {drafts.length} · {row.merchant || sourceNames[row.source]}{Object.keys(draftErrors(row)).length ? ' · 입력 필요' : ''}</option>)}</select></label>
      <Button variant="outline" size="icon" aria-label="다음 영수증" disabled={busy || currentIndex === drafts.length - 1} onClick={() => setIndex(currentIndex + 1)}><ChevronRight/></Button>
    </nav>
    <div className="review-columns" key={draft.key}>
      <ReceiptOriginal file={draft.attachmentIndex === undefined ? undefined : files[draft.attachmentIndex]} raw={draft.raw} pageNumber={draft.pageNumber}/>
      <div className="review-fields">
        <div className="review-field-heading"><span className="badge">{sourceNames[draft.source]}</span><Button variant="ghost" size="sm" disabled={busy} onClick={() => remove(draft.key)}><Trash2 size={14}/> 제외</Button></div>
        <div className="form-grid">
          <label htmlFor="draft-date">이용일<input {...inputProps('date')} type="date" value={draft.date || ''} disabled={busy} onChange={event => update(draft.key, { date: event.target.value })}/>{error('date')}</label>
          <label htmlFor="draft-amount">결제 금액 (원)<input {...inputProps('amount')} type="number" inputMode="numeric" min={0} max={100000000} step="1" placeholder="원화 금액 입력" value={draft.amount ?? ''} disabled={busy} onChange={event => update(draft.key, { amount: event.target.value === '' ? undefined : Number(event.target.value) })}/>{error('amount')}</label>
          <label className="full" htmlFor="draft-merchant">이용내역<input {...inputProps('merchant')} value={draft.merchant || ''} maxLength={150} disabled={busy} onChange={event => update(draft.key, { merchant: event.target.value })}/>{error('merchant')}</label>
          <label className="full" htmlFor="draft-reference">승인·예약번호 <span className="optional-label">선택</span><input {...inputProps('reference')} value={draft.reference || ''} maxLength={120} disabled={busy} placeholder="영수증에 있는 경우 입력" onChange={event => update(draft.key, { reference: event.target.value })}/>{error('reference')}</label>
        </div>
        {warnings.length > 0 && <div className="source-warning"><AlertCircle size={17}/><div><strong>원문에서 확인해 주세요</strong>{warnings.map(warning => <p key={warning}>{warning}</p>)}</div></div>}
        {!Object.keys(errors).length && <p className="fields-complete"><Check size={16}/> 필수 항목을 모두 입력했어요.</p>}
      </div>
    </div>
    <div className="review-footer"><div><strong>{drafts.length}건 · {new Intl.NumberFormat('ko-KR').format(drafts.reduce((sum, row) => sum + (Number.isFinite(row.amount) ? row.amount! : 0), 0))}원</strong><span>{incomplete ? `${incomplete}건에 입력이 필요해요` : '저장 후에도 언제든 수정할 수 있어요'}</span></div><Button disabled={busy} onClick={save}><CheckCheck size={18}/>{incomplete ? '입력 확인하고 저장' : `${drafts.length}건 저장하기`}</Button></div>
  </div>;
}
