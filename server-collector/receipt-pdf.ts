import type {Page} from '@cloudflare/playwright';
export function receiptPrintDocument(){
 const original=document.querySelector('.receipt_popup');if(!original)throw new Error('영수증 원문이 없습니다.');
 const copy=original.cloneNode(true) as Element;
 copy.querySelectorAll('script,iframe,object,embed,input,button,form').forEach(node=>node.remove());
 for(const node of [copy,...copy.querySelectorAll('*')])for(const attribute of [...node.attributes]){
  if(attribute.name.startsWith('on')||attribute.name==='srcdoc')node.removeAttribute(attribute.name);
  if(['href','src'].includes(attribute.name)){try{const url=new URL(attribute.value,location.href);if(url.protocol!=='https:'||!['www.korail.com','korail.com','cdn.korail.com'].includes(url.hostname))node.removeAttribute(attribute.name);else node.setAttribute(attribute.name,url.href);}catch{node.removeAttribute(attribute.name);}}
 }
 const styles=[...document.querySelectorAll('link[rel="stylesheet"]')].map(node=>new URL((node as HTMLLinkElement).href,location.href)).filter(url=>url.protocol==='https:'&&['www.korail.com','korail.com','cdn.korail.com'].includes(url.hostname)).map(url=>`<link rel="stylesheet" href="${url.href.replaceAll('"','&quot;')}">`).join('');
 const inline=[...(document.styleSheets||[])].flatMap(sheet=>{try{
  const base=new URL(sheet.href||location.href);if(base.protocol!=='https:'||!['www.korail.com','korail.com','cdn.korail.com'].includes(base.hostname))return [];
  return [...sheet.cssRules].map(rule=>rule.cssText.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi,(_,quote,path)=>{try{const url=new URL(path,base);return url.protocol==='https:'&&['www.korail.com','korail.com','cdn.korail.com'].includes(url.hostname)?`url("${url.href.replaceAll('"','%22')}")`:'none';}catch{return 'none';}}));
 }catch{return [];}}).join('\n').replace(/<\/style/gi,'<\\/style');
 return `<!doctype html><html lang="ko"><head><meta charset="utf-8">${styles}<style>${inline}</style><style>html,body{display:block!important;visibility:visible!important;background:white!important;margin:0;padding:12px}.receipt_popup{display:block!important;width:100%!important}.receipt_print{display:block!important}.receipt_print>li{break-inside:avoid;page-break-inside:avoid;float:none!important;max-width:100%;margin:0 auto 20px}</style></head><body>${copy.outerHTML}</body></html>`;
}
export async function korailReceiptPdf(page:Page,references:string[],day:string){
 if(!references.length)return;
 if(references.length>100||references.some(ref=>!/^[A-Z0-9-]+$/i.test(ref)))throw new Error('영수증 묶음 범위를 확인하지 못했습니다.');
 await page.evaluate(()=>{window.print=()=>{};});
 for(const ref of references)await page.locator(`label[for="check_${ref}"]`).click();
 await page.getByRole('button',{name:'선택 영수증 인쇄',exact:true}).click();
 await page.waitForFunction(refs=>{const present=[...document.querySelectorAll('.receipt_popup .receipt_top.reserve_num span')].map(node=>(node.textContent||'').replace(/\s/g,''));return refs.every(ref=>present.includes(ref));},references,{timeout:30000});
 const html=await page.evaluate(receiptPrintDocument),printPage=await page.context().newPage();
 try{
  await printPage.setContent(html,{waitUntil:'load',timeout:25000});await printPage.emulateMedia({media:'screen'});
  const bytes=await printPage.pdf({format:'A4',printBackground:true});
  if(bytes.length>1500000)throw new Error('영수증 PDF 묶음이 너무 커 자동 저장을 마치지 못했습니다.');
  return {name:`코레일-영수증-${day}.pdf`,mimeType:'application/pdf' as const,base64:bytes.toString('base64')};
 }finally{await printPage.close();}
}
