const destination='https://chuljang-receipts.jhleokim.chatgpt.site/';
let packet=null;
const status=document.getElementById('status'),collect=document.getElementById('collect'),send=document.getElementById('send');
document.getElementById('source').addEventListener('change',()=>{packet=null;document.getElementById('review').hidden=true;});
collect.addEventListener('click',async()=>{
 collect.disabled=true;packet=null;document.getElementById('review').hidden=true;
 try{
  const source=document.getElementById('source').value;if(!source)throw new Error('영수증 서비스를 선택해 주세요.');
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id||!tab.url?.startsWith('https://'))throw new Error('HTTPS 영수증 페이지에서 실행해 주세요.');
  if(new URL(tab.url).origin===new URL(destination).origin)throw new Error('출장 사이트가 아닌, 발급받은 영수증 페이지에서 실행하세요.');
  const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
   const selected=window.getSelection()?.toString().trim();
   const hasDate=s=>/20\d{2}\s*[.년/\-]\s*\d{1,2}\s*[.월/\-]\s*\d{1,2}/.test(s);
   const hasAmount=s=>/결제|금액|운임|요금|TOTAL|KRW|\d[\d,]*\s*원/i.test(s);
   const scrub=s=>s.replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g,'[카드번호 숨김]').replace(/\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/g,'[연락처 숨김]').slice(0,12000);
   if(selected)return [scrub(selected)];
   const tables=Array.from(document.querySelectorAll('table'));
   const blocks=[];
   for(const table of tables){
    const headers=Array.from(table.querySelectorAll('thead th')).map(th=>th.innerText.trim());
    const rows=Array.from(table.querySelectorAll('tr')).filter(row=>row.getClientRects().length&&row.querySelector('td'));
    for(const row of rows){
     if(!hasDate(row.innerText)||!hasAmount(row.innerText))continue;
     const cells=Array.from(row.querySelectorAll('td'));
     const text=headers.length===cells.length?cells.map((td,i)=>headers[i]+': '+td.innerText).join('\n'):row.innerText;
     blocks.push(scrub(text));
    }
   }
   if(blocks.length)return blocks.slice(0,100);
   const root=document.querySelector('main, [role="main"], article')||document.body;
   const text=root.innerText;
   return hasDate(text)&&hasAmount(text)?[scrub(text)]:[];
  }});
  const blocks=results[0]?.result;
  if(!Array.isArray(blocks)||!blocks.length)throw new Error('영수증을 찾지 못했어요. 날짜·금액이 보이는 영수증을 열거나 필요한 텍스트를 선택하세요.');
  const u=new URL(tab.url);u.search='';u.hash='';
  packet={source,blocks,sourceUrl:u.toString(),version:1};
  document.getElementById('preview').textContent=blocks.join('\n\n---\n\n');
  document.getElementById('review').hidden=false;status.textContent=blocks.length+'개 영역을 읽었습니다. 전송 전에 내용을 확인하세요.';
 }catch(e){status.textContent=e.message;}finally{collect.disabled=false;}
});
send.addEventListener('click',async()=>{
 if(!packet)return;send.disabled=true;
 try{await chrome.storage.session.set({pendingCapture:{captureId:crypto.randomUUID(),packet,expires:Date.now()+20*60*1000}});await chrome.tabs.create({url:destination});status.textContent='출장 사이트에 로그인한 뒤 내용을 확인하고 저장하세요.';}catch(e){status.textContent=e.message;}finally{send.disabled=false;}
});
document.getElementById('download').addEventListener('click',()=>{
 if(!packet)return;const url=URL.createObjectURL(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='chuljang-collected.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
