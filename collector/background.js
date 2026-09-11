const origin='https://chuljang-receipts.jhleokim.chatgpt.site';
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(!sender.tab?.url||new URL(sender.tab.url).origin!==origin)return false;
 if(message?.type==='GET_CAPTURE'){
  chrome.storage.session.get('pendingCapture').then(async state=>{
   const item=state.pendingCapture;if(!item||Date.now()>item.expires){await chrome.storage.session.remove('pendingCapture');respond(null);return;}respond({packet:item.packet,captureId:item.captureId});
  }).catch(()=>respond(null));return true;
 }
 if(message?.type==='ACK_CAPTURE'){chrome.storage.session.get('pendingCapture').then(async state=>{if(state.pendingCapture?.captureId===message.captureId)await chrome.storage.session.remove('pendingCapture');respond({ok:true});}).catch(()=>respond({ok:false}));return true;}
 return false;
});
