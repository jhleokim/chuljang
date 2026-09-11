let delivered=false;let captureId=null;
window.addEventListener('message',event=>{
 if(event.source!==window||event.origin!==location.origin)return;
 if(event.data?.type==='CHULJANG_STAGED'&&captureId&&event.data.captureId===captureId){void chrome.runtime.sendMessage({type:'ACK_CAPTURE',captureId}).catch(()=>{});return;}
 if(event.data?.type!=='CHULJANG_READY'||delivered)return;
 chrome.runtime.sendMessage({type:'GET_CAPTURE'}).then(item=>{
  if(!item||delivered)return;delivered=true;captureId=item.captureId;
  window.postMessage({type:'CHULJANG_COLLECTED',packet:item.packet,captureId},location.origin);
 }).catch(()=>{});
});
window.postMessage({type:'CHULJANG_BRIDGE_READY'},location.origin);
