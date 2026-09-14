import {z} from 'zod';
import {sourceNames,type Receipt,type Trip} from './receipts.ts';

export const reportFields=['date','service','merchant','amount','reference','trip'] as const;
export const fieldLabels={date:'이용일',service:'서비스',merchant:'이용내역',amount:'결제금액',reference:'승인·예약번호',trip:'출장명'};
const column=z.string().regex(/^(?:[A-Z]{1,2})?$/);
export const reportConfigSchema=z.object({
 title:z.string().trim().min(1).max(80).default('출장 정산서'),
 sheet:z.string().max(31).default(''),firstRow:z.number().int().min(1).max(2000).default(7),
 lastRow:z.number().int().min(1).max(5000).default(36),
 columns:z.object({date:column,service:column,merchant:column,amount:column,reference:column,trip:column}),
 recipient:z.union([z.literal(''),z.string().email().max(254)]).default(''),
 mail:z.enum(['gmail','default']).default('gmail'),includeOriginals:z.boolean().default(true),
}).superRefine((v,ctx)=>{const columns=Object.values(v.columns).filter(Boolean);if(v.lastRow<v.firstRow||!v.columns.date||!v.columns.amount||new Set(columns).size!==columns.length)ctx.addIssue({code:'custom',message:'이용일·금액 열과 입력 행 범위를 확인해 주세요. 열은 중복될 수 없습니다.'});});
export type ReportConfig=z.infer<typeof reportConfigSchema>;
export const defaultReport:ReportConfig={title:'출장 정산서',sheet:'',firstRow:7,lastRow:36,columns:{date:'A',service:'B',merchant:'C',amount:'D',reference:'E',trip:'F'},recipient:'',mail:'gmail',includeOriginals:true};
export function reportRows(rows:Receipt[],dates:string[]){
 if(!dates.length)throw new Error('정산할 출장 날짜를 먼저 선택해 주세요.');
 const selected=rows.filter(row=>dates.includes(row.date)).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 if(!selected.length)throw new Error('선택한 날짜에 저장된 영수증이 없습니다.');
 return selected;
}
export function reportValue(row:Receipt,field:typeof reportFields[number],trips:Trip[]){
 if(field==='service')return sourceNames[row.source];
 if(field==='trip')return trips.find(trip=>trip.id===row.tripId)?.name||'';
 return row[field];
}
export function reportFilename(title:string,dates:string[]){return (title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'')||'출장 정산서')+'-'+[...dates].sort()[0]+(dates.length>1?' 외 '+(dates.length-1)+'일':'');}
export function mailComposeUrl(config:ReportConfig,link:string,expiresAt:string){
 const subject=config.title,body=`출장 정산 파일을 공유합니다.\n\n${link}\n\n다운로드 기한: ${new Date(expiresAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}\n링크를 받은 사람은 기한 내 파일을 내려받을 수 있습니다.`;
 if(config.mail==='gmail')return 'https://mail.google.com/mail/?'+new URLSearchParams({view:'cm',fs:'1',to:config.recipient,su:subject,body});
 return 'mailto:'+encodeURIComponent(config.recipient)+'?'+new URLSearchParams({subject,body}).toString().replaceAll('+','%20');
}
