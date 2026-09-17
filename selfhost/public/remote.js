import RFB from '/remote-assets/core/rfb.js';
const status=document.getElementById('status');
const base=location.pathname;
const rfb=new RFB(document.getElementById('screen'),`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}${base}socket`,{});
rfb.scaleViewport=true;rfb.resizeSession=false;
const keyboard=document.getElementById('mobile-input'),toggle=document.getElementById('keyboard'),zoom=document.getElementById('zoom');
if(keyboard&&toggle){
 let composing=false;
 const send=text=>{for(const character of text){const point=character.codePointAt(0);rfb.sendKey(point<=255?point:0x01000000|point);}};
 toggle.addEventListener('click',()=>keyboard.focus());
 keyboard.addEventListener('compositionstart',()=>{composing=true;});
 keyboard.addEventListener('compositionend',event=>{composing=false;send(event.data||'');keyboard.value='';});
 keyboard.addEventListener('input',event=>{if(composing||event.isComposing)return;if(event.inputType==='deleteContentBackward')rfb.sendKey(0xff08);else send(keyboard.value);keyboard.value='';});
 keyboard.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();rfb.sendKey(0xff0d);}else if(event.key==='Backspace'&&!keyboard.value&&!composing){event.preventDefault();rfb.sendKey(0xff08);}});
 keyboard.addEventListener('blur',()=>{keyboard.value='';});
}
zoom?.addEventListener('click',()=>{rfb.scaleViewport=!rfb.scaleViewport;zoom.textContent=rfb.scaleViewport?'화면 확대':'전체 화면';});
rfb.addEventListener('disconnect',()=>{status.textContent='로그인 창 연결이 종료됐습니다. 출장 화면에서 진행 상황을 확인하세요.';});
const timer=setInterval(async()=>{
  try{const response=await fetch(base+'status',{cache:'no-store'});if(response.status===410){clearInterval(timer);rfb.disconnect();status.textContent='로그인 창이 종료됐습니다. 출장 화면에서 자동으로 이어집니다.';window.close();setTimeout(()=>location.replace('/'),500);}else if(response.status===401||response.redirected){clearInterval(timer);rfb.disconnect();location.replace('/');}}
  catch{status.textContent='서버 연결을 다시 확인하고 있어요.';}
},1500);
