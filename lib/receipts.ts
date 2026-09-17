import { z } from 'zod';
export const sourceIds = ['ktx','transit','kakaot','tmoney','hipass','airline','socar'] as const;
export type Source = typeof sourceIds[number];
export const sourceNames: Record<Source,string> = {ktx:'KTX · 코레일',transit:'티머니 · 지하철·시내버스',kakaot:'카카오 T',tmoney:'고속버스 · KOBUS',hipass:'하이패스 · 통행료',airline:'항공',socar:'쏘카'};
export function isDate(value:string) { if(!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false; const d=new Date(value+'T00:00:00Z'); return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===value; }
export const candidateSchema=z.object({
  source:z.enum(sourceIds), date:z.string().refine(isDate,'날짜를 확인해 주세요.'),
  merchant:z.string().trim().min(1).max(150), amount:z.number().int().min(0).max(100000000),
  reference:z.string().trim().max(120).default(''), raw:z.string().max(12000).default(''),
  sourceUrl:z.string().max(2000).default(''), attachmentIndex:z.number().int().min(0).max(19).optional(),
});
export type Candidate=z.infer<typeof candidateSchema>;
export type Receipt=Candidate & {id:string;tripId:string|null;reviewed:number;createdAt:string;hasAttachment:number};
export const tripSchema=z.object({name:z.string().trim().min(1).max(100),startDate:z.string().refine(isDate),endDate:z.string().refine(isDate)}).refine(v=>v.startDate<=v.endDate,'종료일은 시작일 이후여야 합니다.');
export type Trip=z.infer<typeof tripSchema>&{id:string};
export function redact(text:string){
 return text.replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g,'[카드번호 숨김]').replace(/\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/g,'[연락처 숨김]').slice(0,12000);
}
export function safeSourceUrl(value:string){
 try{const u=new URL(value); if(u.protocol!=='https:')return '';u.search='';u.hash='';u.username='';u.password='';return u.toString();}catch{return '';}
}
export function parseReceipt(raw:string,source:Source):Partial<Candidate>&{source:Source;issues:string[]} {
 const text=redact(raw.replace(/\r/g,'')); const issues:string[]=[];
 const dates=[...text.matchAll(/(20\d{2})\s*[.년/\-]\s*(\d{1,2})\s*[.월/\-]\s*(\d{1,2})\s*일?/g)];
 const preferred=dates.find(m=>/(이용|승차|출발|탑승|운행|대여)\s*(일|일자|일시|날짜)?\s*[:：]?\s*$/.test(text.slice(Math.max(0,m.index!-24),m.index)));
 const selected=preferred||dates[0]; const date=selected?selected[1]+'-'+selected[2].padStart(2,'0')+'-'+selected[3].padStart(2,'0'):'';
 if(!isDate(date))issues.push('이용 날짜 확인');
 // Foreign currency is never silently interpreted as KRW.
 const foreign=/(?:USD|JPY|EUR|CNY|HKD|SGD|AUD|미국달러|엔화|달러|\$|€|¥)/i.test(text);
 const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
 const candidates:{amount:number;score:number}[]=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  const label=/(최종\s*결제\s*금액|총\s*결제\s*금액|결제\s*금액|승인\s*금액|합계\s*금액|총액|합계|TOTAL|AMOUNT PAID|운임|요금)/i.exec(line);
  if(!label||/취소|환불|할인|부가세|공급가/.test(line))continue;
  let tail=line.slice(label.index+label[0].length).replace(/^[\s:：₩￦]+/,'');
  if(!tail)tail=lines[i+1]||'';
  if(/[−－﹣–—]/.test(tail)||/[(（]\s*(?:₩|￦|KRW)?\s*[\d,]+(?:\s*원)?\s*[)）]/i.test(tail))continue;
  const matches=[...tail.matchAll(/(?:₩|￦|KRW)?\s*(-?\d{1,3}(?:,\d{3})+|-?\d+)\s*(?:원|KRW)?/gi)];
  const values=matches.filter(m=>!/\d[.\/-]\d/.test(tail)&&m[1].replace(/,/g,'').length<=9).map(m=>Number(m[1].replace(/,/g,''))).filter(v=>v>=0);
  if(values.length===1)candidates.push({amount:values[0],score:/최종|총\s*결제|AMOUNT PAID/.test(label[0])?3:/결제|승인|합계|총액|TOTAL/.test(label[0])?2:1});
 }
 let amount:number|undefined;
 if(candidates.length&&!foreign){const top=Math.max(...candidates.map(c=>c.score));const values=[...new Set(candidates.filter(c=>c.score===top).map(c=>c.amount))];if(values.length===1)amount=values[0];}
 if(amount===undefined)issues.push(foreign?'외화 영수증: 원화 실결제 금액 입력':'결제 금액 확인');
 if(/취소\s*(완료|영수증|처리|됨)|환불\s*(완료|금액|처리|됨)|상태\s*[:：]?\s*(취소|환불)|^\s*(취소|환불)\s*$|\b(cancelled|canceled|refunded|voided)\b/im.test(text))issues.push('취소·환불 여부 확인');
 const ref=/(?:승인번호|예약번호|승차권번호|거래번호)\s*[:：]?\s*([A-Z0-9][A-Z0-9\-]{3,50})/i.exec(text)?.[1]||'';
 const route=/(?:출발지?|승차역)\s*[:：]\s*([^\n\t]{1,25})/.exec(text)?.[1];
 const end=/(?:도착지?|하차역)\s*[:：]\s*([^\n\t]{1,25})/.exec(text)?.[1];
 const description=/(?:이용내역|사용처)\s*[:：]\s*([^\n\t]{1,150})/.exec(text)?.[1];
 return {source,date:isDate(date)?date:'',merchant:route&&end?route.trim()+' → '+end.trim():description?.trim()||sourceNames[source],amount,reference:ref,raw:text,sourceUrl:'',issues};
}
export function csvCell(value:unknown){let s=String(value??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
export function exportCsv(rows:Receipt[],trips:Trip[]){
 const header=['이용일','서비스','이용내역','결제금액(KRW)','출장','검토상태','승인/예약번호'];
 return '\uFEFF'+[header,...rows.map(r=>[r.date,sourceNames[r.source],r.merchant,r.amount,trips.find(t=>t.id===r.tripId)?.name||'미분류',r.reviewed?'확인 완료':'검토 필요',r.reference])].map(row=>row.map(csvCell).join(',')).join('\r\n');
}

