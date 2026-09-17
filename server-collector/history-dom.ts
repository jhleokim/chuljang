// Each function is self-contained for page.evaluate. No credentials or hidden form values are read.
export function readKorailHistory(){
 const text=(node:Element|null)=>(node?.textContent||'').replace(/\s+/g,' ').trim();
 const cards=[...document.querySelectorAll('.history_tk .tckWrap > ul > li.tckList')];
 const blocks:string[]=[],includedReferences:string[]=[],invalid:string[]=[];let cancelled=0;
 for(const card of cards){
  const status=[...card.querySelectorAll('.inline_wrap p')].map(text).find(value=>/상태\s*[:：]/.test(value))||'';
  if(/취소|반환|환불/.test(status)){cancelled++;continue;}
  const date=text(card.querySelector('.flag_wrap .dt')).match(/(20\d{2})[.년/\-\s]+(\d{1,2})[.월/\-\s]+(\d{1,2})/);
  const money=text(card.querySelector('.charge_wrap .money'));
  const amounts=[...money.matchAll(/(?:^|[^\d])((?:\d{1,3}(?:,\d{3})+|\d+))\s*원/g)].map(match=>match[1].replaceAll(',',''));
  const reference=card.querySelector('input[id^="check_"]')?.id.replace(/^check_/,'');
  const routeText=text(card.querySelector('.data_box.right h3.txt_bk')),route=routeText.match(/^(.+?)\s*→\s*(.+?)(?:\s*\(|$)/);
  if(!date||amounts.length!==1||!reference||!route){invalid.push('열차 이용내역의 날짜·금액·승차권 번호 형식이 변경되었습니다.');continue;}
  includedReferences.push(reference);
  blocks.push(`승차일: ${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}\n출발: ${route[1]}\n도착: ${route[2]}\n이용내역: ${routeText}\n결제금액: ${amounts[0]}원\n승인번호: ${reference}\n${status}`);
 }
 return {blocks,includedReferences,invalid,cancelled,references:cards.map(card=>card.querySelector('input[id^="check_"]')?.id.replace(/^check_/,'')),count:cards.length,more:[...document.querySelectorAll('a.page_group')].some(node=>text(node)==='더보기'),hasDates:!!document.querySelector('#Date01')&&!!document.querySelector('#Date02')};
}

export function serviceLoginState(provider:string){
 const visible=(node:Element)=>!!node.getClientRects().length;
 if([...document.querySelectorAll('input[type="password"]')].some(visible))return false;
 if(provider==='tmoneyTransit'&&document.querySelector('#loginForm #indlMbrsId'))return false;
 if([...document.querySelectorAll('a,button')].some(node=>visible(node)&&/^(로그아웃|log\s*out|sign\s*out)$/i.test((node.textContent||'').trim())))return true;
 return false;
}

// Wait for a usable official form instead of showing its empty bootstrap or
// loading overlay as if the user should enter their credentials there.
export function serviceLoginReady(provider:string){
 const visible=(node:Element)=>!!node.getClientRects().length;
 if([...document.querySelectorAll('input[type="password"]')].some(visible))return true;
 if([...document.querySelectorAll('a,button')].some(node=>visible(node)&&/^(로그아웃|log\s*out|sign\s*out)$/i.test((node.textContent||'').trim())))return true;
 return provider==='hipass'&&[...document.querySelectorAll('button,a')].some(node=>visible(node)&&/간편인증|공동인증서|아이핀/.test(node.textContent||''));
}
