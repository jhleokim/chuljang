import {Buffer} from 'node:buffer';
import type {Page} from 'playwright';
import {createHash} from 'node:crypto';
import {isDate,redact} from '../lib/receipts.ts';
import {SOURCES,allowedUrl} from '../collector/providers.js';

export class MemberHistoryError extends Error {constructor(message:string){super(message);this.name='MemberHistoryError';}}
export function transitAvailability(day:string,now=new Date()){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const age=Math.round((Date.parse(today+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000);
 return age<2?'아직 제공되지 않은 내역입니다. 이용일 이틀 뒤부터 자동 조회됩니다.':age>367?'일반 조회 기간을 지났습니다. 티머니의 과거 내역 신청이 필요합니다.':null;
}
// Inspect only rendered query controls. Authentication fields and hidden inputs are excluded.
export function memberQueryControls(provider:string){
 document.querySelectorAll('[data-chuljang-query]').forEach(node=>node.removeAttribute('data-chuljang-query'));
 const visible=(node:Element)=>!!node.getClientRects().length;
 const label=(node:Element)=>[node.getAttribute('aria-label'),node.getAttribute('title'),node.getAttribute('placeholder'),node.id,node.getAttribute('name'),...[...document.querySelectorAll('label')].filter(item=>item.getAttribute('for')===node.id).map(item=>item.textContent)].filter(Boolean).join(' ');
 const fields=[...document.querySelectorAll<HTMLInputElement>('input')].filter(node=>visible(node)&&!['hidden','password','checkbox','radio'].includes(node.type));
 const dates=fields.filter(node=>node.type==='date'||node.classList.contains('hasDatepicker')||/조회시작|조회종료|시작일|종료일|start.?date|end.?date|datepicker[3456]|search.*(?:from|to)|srch.*(?:strt|end)/i.test(label(node)));
 const start=dates.find(node=>/시작|start|strt|from|datepicker[35]$/i.test(label(node))),end=dates.find(node=>/종료|끝|end|to\b|datepicker[46]$/i.test(label(node)));
 const query=[...document.querySelectorAll('button,a,input[type=button],input[type=submit]')].filter(visible).filter(node=>/^(조회|조회하기|검색|검색하기|조회하기\s*조회)$/.test((node.textContent||node.getAttribute('value')||'').trim()));
 const selects=[...document.querySelectorAll<Element>('select')].filter(visible),card=selects.filter(node=>/card|카드/i.test(label(node)));
 const consent=[...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].filter(visible).filter(node=>!node.checked&&/본인.*(?:사용|이용).*내역.*동의|(?:사용|이용)내역.*조회.*동의/.test(label(node)));
 const mark=(node:Element|undefined,name:string)=>{if(!node)return null;node.setAttribute('data-chuljang-query',name);return '[data-chuljang-query="'+name+'"]';};
 const first=start||(dates.length===2?dates[0]:undefined),last=end||(dates.length===2?dates[1]:undefined);
 const jq=(window as unknown as {jQuery?:(node:Element)=>{datepicker?:(command:string,option:string)=>unknown}}).jQuery;
 let minDate:unknown=first?.min||null;if(first?.classList.contains('hasDatepicker')&&jq){try{minDate=jq(first).datepicker?.('option','minDate');}catch{}}
 const travelQuery=first&&/승차|출발|탑승|이용|사용/.test(label(first));
 return {start:mark(first,'start'),end:mark(last,'end'),query:mark(query.length===1?query[0]:undefined,'submit'),card:mark(['tmoneyTransit','hipass'].includes(provider)&&card.length===1?card[0]:undefined,'card'),consents:consent.map((node,index)=>mark(node,'consent'+index)!),noCards:/등록된\s*카드가\s*없|등록하신\s*카드가\s*없/.test(document.body.innerText),travelQuery:!!travelQuery,minDate:typeof minDate==='number'||typeof minDate==='string'?minDate:null};
}
export function memberResultSnapshot(provider:string){
 document.querySelectorAll('[data-chuljang-next]').forEach(node=>node.removeAttribute('data-chuljang-next'));
 const visible=(node:Element)=>!!node.getClientRects().length,text=(node:Element|null)=>(node?.textContent||'').replace(/\s+/g,' ').trim();
 const candidates=[...document.querySelectorAll('table')].filter(visible).map(table=>{
  let headers=[...table.querySelectorAll('thead th')].map(text);
  if(!headers.length&&table.closest('.ui-jqgrid'))headers=[...table.closest('.ui-jqgrid')!.querySelectorAll('.ui-jqgrid-htable thead th')].map(text);
  if(!headers.length)headers=[...table.querySelectorAll('tr:first-child th')].map(text);
  return {table,headers};
 }).filter(({table,headers})=>table.querySelector('tbody')&&headers.some(value=>/금액|요금|운임/.test(value))&&headers.some(value=>/일시|일자|날짜|이용일|승차일|출발일/.test(value))&&!table.classList.contains('ui-jqgrid-htable'));
 if(candidates.length!==1)return {error:'이용내역 표의 날짜·금액 열을 하나로 확인하지 못했습니다.'};
 const {table,headers}=candidates[0],container=table.closest('.ui-jqgrid')||table.parentElement!;
 table.setAttribute('data-chuljang-results','true');
 const data=[...table.querySelectorAll('tbody > tr')].filter(visible).filter(row=>!row.classList.contains('jqgfirstrow')).map(row=>({cells:[...row.querySelectorAll(':scope > td')].map(text),span:!!row.querySelector('td[colspan]')}));
 const empty=/조회(?:된|하신)?\s*(?:결과|내역|데이터)(?:가|이|은)?\s*없|사용\s*내역이\s*없|이용\s*내역이\s*없|검색(?:된)?\s*(?:결과|내역)(?:가|이)?\s*없|데이터가\s*없/.test(text(container));
 const rows=data.filter(row=>row.cells.length===headers.length&&!row.span).map(row=>row.cells);
 const pagers=[...document.querySelectorAll('[class*="paging"],[class*="pagination"],.ui-jqgrid-pager')].filter(visible);
 let next:Element|undefined,pagingUnknown=false;
 for(const pager of pagers){
  const controls=[...pager.querySelectorAll('a,button,td[id*="next"],td[id*="last"]')].filter(visible).filter(node=>!node.matches('[disabled],[aria-disabled=true],.disabled,.ui-state-disabled'));
  const current=Number(text(pager.querySelector('[aria-current="page"],strong,.active,.on,.sel')));
  const numeric=controls.filter(node=>/^\d+$/.test(text(node)));
  next=numeric.find(node=>Number(text(node))===current+1);
  if(!next)next=controls.find(node=>/^(다음|다음페이지|다음 페이지|next|›|>)$/i.test(text(node)||node.getAttribute('aria-label')||node.getAttribute('title')||'')||/next_/.test(node.id));
  if(numeric.length>1&&!current&&!next)pagingUnknown=true;
  if(next)break;
 }
 if(next)next.setAttribute('data-chuljang-next','true');
 const tableText=text(table);const limit=/최근\s*(\d+)\s*(?:개월|일)/.exec(text(container));
 return {headers,rows,empty:empty&&!rows.length,next:next?'[data-chuljang-next="true"]':null,pagingUnknown,signature:tableText,limit:limit?.[0],provider};
}
export function parseMemberRows(provider:string,headers:string[],rows:string[][],day:string){
 const normalized=headers.map(value=>value.replace(/\s/g,''));
 const dateIndex=normalized.findIndex(value=>(provider==='hipass'?/^(사용|이용|통행|거래|출구)(일시|일자|일|날짜)/:provider==='tmoneyTransit'?/^(사용|이용|승차|거래)(일시|일자|일|날짜)/:/^(출발|승차|탑승)(일시|일자|일|날짜)/).test(value));
 let amountIndex=normalized.findIndex(value=>/^(결제|사용|이용|승인|거래)금액/.test(value));if(amountIndex<0)amountIndex=normalized.findIndex(value=>/^(통행요금|통행료|요금|운임|금액)(\(원\)|원)?$/.test(value));
 const statusIndex=normalized.findIndex(value=>/^(상태|처리상태|거래상태|이용상태)$/.test(value));
 const kindIndex=normalized.findIndex(value=>/^(구분|거래구분|이용구분|거래유형)$/.test(value));
 const refIndex=normalized.findIndex(value=>/승인번호|예약번호|승차권번호|거래번호/.test(value));
 const routeIndex=normalized.findIndex(value=>/노선|이용내역|사용처|교통수단/.test(value));
 const from=normalized.findIndex(value=>/^(승차|출발|입구|진입)(역|지|정류장|영업소|톨게이트)?$/.test(value)),to=normalized.findIndex(value=>/^(하차|도착|출구|진출)(역|지|정류장|영업소|톨게이트)?$/.test(value));
 if(dateIndex<0||amountIndex<0)throw new MemberHistoryError('이용일과 결제금액 열을 확인하지 못했습니다. 결제일을 이용일로 대신하지 않았습니다.');
 const parsed=[];let cancelled=0;
 for(const cells of rows){
  if(cells.length!==headers.length)throw new MemberHistoryError('조회 표의 열 구성이 변경되었습니다.');
  if(statusIndex>=0&&/취소|환불|반환|미결제/.test(cells[statusIndex])||kindIndex>=0&&/충전|환불|취소/.test(cells[kindIndex])){cancelled++;continue;}
  const dates=[...cells[dateIndex].matchAll(/(20\d{2})[.년/\-\s]+(\d{1,2})[.월/\-\s]+(\d{1,2})/g)].map(match=>`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`);
  if(dates.length!==1||!isDate(dates[0]))throw new MemberHistoryError('왕복 또는 날짜가 불명확한 내역입니다. 금액을 중복 배정하지 않도록 상세 확인이 필요합니다.');
  if(dates[0]!==day)continue;
  const money=cells[amountIndex].replace(/\s|원|₩|￦|KRW/g,'');if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(money)||Number(money.replaceAll(',',''))>100000000)throw new MemberHistoryError('결제금액 형식을 확인하지 못했습니다.');
  const route=from>=0&&to>=0?cells[from]+' → '+cells[to]:routeIndex>=0?cells[routeIndex]:provider==='tmoneyTransit'?'티머니 대중교통':provider==='hipass'?'하이패스 통행료':'고속버스';
  parsed.push({date:day,amount:Number(money.replaceAll(',','')),reference:refIndex>=0?cells[refIndex]:'',route,original:headers.map((header,index)=>header+': '+cells[index]).join('\n')});
 }
 return {rows:parsed,cancelled};
}
async function fillDay(page:Page,selector:string,day:string){
 await page.locator(selector).evaluate((node,value)=>{
  const input=node as HTMLInputElement;
  const jq=(window as unknown as {jQuery?:(node:Element)=>{datepicker?:(command:string,date:Date)=>void}}).jQuery;
  if(input.classList.contains('hasDatepicker')&&jq){jq(input).datepicker?.('setDate',new Date(value+'T12:00:00'));}
  else{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(input,input.maxLength===8?value.replaceAll('-',''):value);}
  input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
 },day);
}
async function resultReady(page:Page,day:string,click:()=>Promise<unknown>,card=''){
 const date=day.replaceAll('-','');
 const response=page.waitForResponse(response=>{try{const req=response.request();if(new URL(response.url()).hostname!==new URL(page.url()).hostname||!['xhr','fetch','document'].includes(req.resourceType()))return false;const decoded=decodeURIComponent((req.postData()||'')+new URL(req.url()).search),query=decoded.replace(/[-.\s/]/g,'');return query.includes(date)&&(!card||decoded.includes(card));}catch{return false;}},{timeout:30000});
 const [reply]=await Promise.all([response,click()]);if(!reply.ok())throw new MemberHistoryError('공식 사이트가 조회 오류를 반환했습니다. 빈 내역으로 처리하지 않았습니다.');await reply.finished();
 await page.waitForFunction(()=>![...document.querySelectorAll('.loading,.ui-jqgrid-loading,[aria-busy="true"]')].some(node=>!!node.getClientRects().length),undefined,{timeout:15000});
}
export async function collectMemberDay(page:Page,provider:string,day:string,alive:()=>Promise<unknown>){
 const source=SOURCES.find(item=>item.id===provider);const verifiedPage=()=>{if(!source||!allowedUrl(page.url(),source))throw new MemberHistoryError('공식 서비스 주소를 벗어나 수집을 멈췄습니다.');};verifiedPage();
 const controls=await page.evaluate(memberQueryControls,provider);
 if(controls.noCards)throw new MemberHistoryError('계정에 등록된 카드가 없습니다. 공식 사이트에서 본인 카드를 등록하면 다음부터 자동 조회됩니다.');
 if(!controls.start||!controls.end||!controls.query||['tmoneyTransit','hipass'].includes(provider)&&!controls.card)throw new MemberHistoryError('회원 조회 화면의 날짜·카드·조회 버튼을 확인하지 못했습니다. 화면 구조 확인이 필요합니다.');
 for(const selector of controls.consents)await page.locator(selector).check();
 const cards=controls.card?await page.locator(controls.card).evaluate(node=>{const options=[...(node as unknown as {options:HTMLOptionElement[]}).options].filter(option=>!option.disabled&&option.value&&!/선택하세요|선택해|카드선택/.test(option.text));const all=options.find(option=>/전체|모든/.test(option.text));return (all?[all]:options).map(option=>option.value);}):[''];
 if(!cards.length)throw new MemberHistoryError('조회할 등록 카드가 없습니다.');
 const blocks:string[]=[],originals:string[]=[];let cancelled=0;
 let queryStart=day,queryEnd=day;
 // A payment-date query cannot establish travel-day completeness. Search its
 // complete available date window, then filter the actual departure dates.
 if(provider==='kobus'&&!controls.travelQuery){
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  if(typeof controls.minDate==='number'&&controls.minDate<0&&controls.minDate>=-730)queryStart=new Date(Date.parse(today+'T00:00:00Z')+controls.minDate*86400000).toISOString().slice(0,10);
  else if(typeof controls.minDate==='string'&&isDate(controls.minDate))queryStart=controls.minDate;
  else throw new MemberHistoryError('결제일 조회의 전체 조회 가능 기간을 확인하지 못했습니다. 이용일 내역을 누락하지 않도록 수집을 멈췄습니다.');
  queryEnd=today;if(day<queryStart)throw new MemberHistoryError('선택한 이용일은 KOBUS 화면의 일반 조회 기간을 지났습니다.');
 }
 for(const card of cards){
  await alive();if(controls.card)await page.locator(controls.card).selectOption(card);await fillDay(page,controls.start,queryStart);await fillDay(page,controls.end,queryEnd);
  await resultReady(page,queryStart,()=>page.locator(controls.query!).click(),card);
  verifiedPage();
  const signatures=new Set<string>(),occurrences=new Map<string,number>();
  for(let index=0;index<100;index++){
   await alive();verifiedPage();const result=await page.evaluate(memberResultSnapshot,provider);if(result.error||!result.headers||!result.rows)throw new MemberHistoryError(result.error||'이용내역을 확인하지 못했습니다.');
   if(result.pagingUnknown)throw new MemberHistoryError('다음 조회 페이지를 확인하지 못했습니다. 조회 완료로 처리하지 않았습니다.');
   if(signatures.has(result.signature!))throw new MemberHistoryError('조회 페이지가 반복되어 전체 내역을 확인하지 못했습니다.');signatures.add(result.signature!);
   if(!result.rows.length&&!result.empty)throw new MemberHistoryError('조회 결과가 비어 있지만 정상적인 내역 없음 응답을 확인하지 못했습니다.');
   const parsed=parseMemberRows(provider,result.headers,result.rows,day);cancelled+=parsed.cancelled;
   for(const row of parsed.rows){
    const identity=JSON.stringify([provider,card,row.original]),occurrence=occurrences.get(identity)||0;occurrences.set(identity,occurrence+1);
    const reference=row.reference&&/^[A-Z0-9-]{4,50}$/i.test(row.reference)?row.reference:createHash('sha256').update(identity+':'+occurrence).digest('hex').slice(0,32).toUpperCase();
    const original=redact(row.original);originals.push(original);
    blocks.push(`이용일: ${day}\n이용내역: ${redact(row.route)}\n결제금액: ${row.amount}원\n승인번호: ${reference}\n${original}`);
   }
   if(blocks.length>100)throw new MemberHistoryError('하루 내역이 100건을 넘습니다. 누락 없이 저장하도록 수집 범위 조정이 필요합니다.');
   if(!result.next)break;if(index===99)throw new MemberHistoryError('조회 페이지 한도를 넘었습니다. 완료로 처리하지 않았습니다.');
   const previous=result.signature;await page.locator(result.next).click();
   const deadline=Date.now()+20000;let changed=false;while(Date.now()<deadline){await alive();const current=await page.evaluate(memberResultSnapshot,provider);if(current.signature&&current.signature!==previous){changed=true;break;}await new Promise(resolve=>setTimeout(resolve,300));}if(!changed)throw new MemberHistoryError('다음 조회 페이지가 표시되지 않았습니다.');
  }
 }
 let attachment;
 if(blocks.length){const print=await page.context().newPage(),escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));try{await print.setContent(`<!doctype html><html lang="ko"><meta charset="utf-8"><style>body{font:12px sans-serif;padding:24px}pre{white-space:pre-wrap;break-inside:avoid;border-bottom:1px solid #ccc;padding:18px 0}h1{font-size:20px}</style><h1>${provider==='tmoneyTransit'?'티머니 대중교통':provider==='hipass'?'하이패스 통행료':'KOBUS 고속버스'} · ${day}</h1><p>공식 조회 내역 저장본 · 별도의 사업자 발급 영수증을 대체하지 않습니다.</p>${originals.map(value=>'<pre>'+escape(value)+'</pre>').join('')}</html>`);const bytes=await print.pdf({format:'A4',printBackground:true});if(bytes.length>1500000)throw new MemberHistoryError('내역 PDF가 자동 저장 크기를 넘었습니다.');attachment={name:`${provider}-조회내역-${day}.pdf`,mimeType:'application/pdf' as const,base64:Buffer.from(bytes).toString('base64')};}finally{await print.close();}}
 return {blocks,cancelled,completed:true,attachment};
}
