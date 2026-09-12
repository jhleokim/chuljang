// Diagnostic UI structure only. No field values, account identifiers, receipt rows or script bodies.
export function inspectMemberControls(){
 const safe=(value:string)=>(value||'').replace(/\d{3,}/g,'…').slice(0,90);
 const controls=[...document.querySelectorAll('input,select,button,a')].filter(node=>!!node.getClientRects().length).filter(node=>!/(password|hidden)/i.test(node.getAttribute('type')||'')).map(node=>({tag:node.tagName,id:safe(node.id),name:safe(node.getAttribute('name')||''),type:node.getAttribute('type')||'',label:safe(node.getAttribute('aria-label')||node.getAttribute('title')||(node.tagName==='BUTTON'||node.tagName==='A'?node.textContent||'':'')),readOnly:node.hasAttribute('readonly')})).filter(node=>node.tag==='INPUT'||node.tag==='SELECT'||/조회|검색|내역|다음|더보기|교통|카드/.test(node.label)).slice(0,70);
 const tables=[...document.querySelectorAll('table')].map(table=>({id:safe(table.id),className:safe(table.className),headers:[...table.querySelectorAll('thead th')].map(node=>safe(node.textContent||'')).slice(0,20)})).filter(table=>table.headers.length).slice(0,10);
 const scripts=[...document.scripts].map(node=>node.src).filter(Boolean).map(value=>{try{const url=new URL(value);return url.origin+url.pathname;}catch{return '';}}).filter(Boolean).slice(-20);
 return {path:location.pathname,controls,tables,scripts};
}
