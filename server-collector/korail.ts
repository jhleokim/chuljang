import type {Page} from '@cloudflare/playwright';
import {readKorailHistory} from './history-dom.ts';
import {korailReceiptPdf} from './receipt-pdf.ts';

export function korailDayUrl(day:string){return 'https://www.korail.com/ticket/mypage/ticketInfo/receipt?searchDate='+day.replaceAll('-','');}
export function korailReceiptResponse(value:unknown){
 const data=value as {strResult?:string;resultData?:{aentity1?:Record<string,string>[];h_tot_page_cnt?:string};h_msg_txt?:string};
 if(!['SUCC','SUCC_NULL'].includes(data?.strResult||'')||!Array.isArray(data.resultData?.aentity1))throw new Error('코레일 조회 응답을 확인하지 못했습니다. 빈 내역으로 처리하지 않았습니다.');
 const rows=data.resultData.aentity1;
 const references=[...new Set(rows.map(row=>[row.h_wct_no,row.h_sale_dt?.slice(4)||'',row.h_sale_sqno,row.h_tk_ret_pwd].join('-')))];
 if(rows.some(row=>!row.h_wct_no||!row.h_sale_sqno||!row.h_tk_ret_pwd))throw new Error('코레일 승차권 식별 정보가 없습니다.');
 const pages=Number(data.resultData.h_tot_page_cnt);
 if(!Number.isInteger(pages)||pages<0||(rows.length>0&&pages===0))throw new Error('코레일 전체 페이지 수를 확인하지 못했습니다.');
 return {count:references.length,references,pages:Math.max(1,pages)};
}

export async function collectKorailDay(page:Page,day:string,alive:()=>Promise<unknown>){
 const predicate=(index:number)=>(response:import('@cloudflare/playwright').Response)=>{const url=new URL(response.url()),date=day.replaceAll('-','');return url.pathname==='/ebizweb/mypage/ticket-history/receipt'&&response.request().method()==='GET'&&url.searchParams.get('h_abrd_dt_from')===date&&url.searchParams.get('h_abrd_dt_to')===date&&url.searchParams.get('radIndGrpDvCd')===String(index);};
 const [response]=await Promise.all([page.waitForResponse(predicate(1),{timeout:35000}),page.goto(korailDayUrl(day),{waitUntil:'commit',timeout:25000})]);
 const first=korailReceiptResponse(await response.json());
 const expected=new Set(first.references);
 if(!expected.size)return {blocks:[] as string[],cancelled:0,completed:true};
 for(let index=1;index<=first.pages;index++){
  await alive();
  await page.waitForFunction(refs=>{const current=[...document.querySelectorAll('.history_tk .tckWrap > ul > li.tckList input[id^="check_"]')].map(node=>node.id.replace(/^check_/,''));return refs.every(ref=>current.includes(ref));},[...expected],{timeout:30000});
  if(index===first.pages)break;
  if(index>=100)throw new Error('코레일 조회 페이지 수가 예상 범위를 넘었습니다. 수집을 완료로 처리하지 않았습니다.');
  const [next]=await Promise.all([page.waitForResponse(predicate(index+1),{timeout:30000}),page.locator('a.page_group').filter({hasText:'더보기'}).click()]);
  const result=korailReceiptResponse(await next.json());
  if(!result.count)throw new Error('코레일 다음 페이지 응답이 비어 있어 수집 범위를 확인하지 못했습니다.');
  if(!result.references.some(ref=>!expected.has(ref)))throw new Error('코레일 다음 페이지에 새 승차권이 없어 조회 완료를 확인하지 못했습니다.');
  result.references.forEach(ref=>expected.add(ref));
 }
 const result=await page.evaluate(readKorailHistory);
 if(result.invalid.length||result.references.length!==expected.size||result.references.some(ref=>!expected.has(ref||''))||result.more)throw new Error(result.invalid[0]||'코레일 조회 건수와 표시된 내역이 일치하지 않습니다.');
 const attachment=await korailReceiptPdf(page,result.includedReferences,day);
 return {blocks:result.blocks,cancelled:result.cancelled,completed:true,attachment};
}
