import RFB from '/remote-assets/core/rfb.js';
const status=document.getElementById('status');
const base=location.pathname;
const rfb=new RFB(document.getElementById('screen'),`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}${base}socket`,{});
rfb.scaleViewport=true;rfb.resizeSession=false;
rfb.addEventListener('disconnect',()=>{status.textContent='로그인 창 연결이 종료됐습니다. 출장 화면에서 진행 상황을 확인하세요.';});
const timer=setInterval(async()=>{
  try{const response=await fetch(base+'status',{cache:'no-store'});if(response.status===410){clearInterval(timer);rfb.disconnect();status.textContent='로그인 창이 종료됐습니다. 출장 화면에서 자동으로 이어집니다.';window.close();}else if(response.status===401||response.redirected){clearInterval(timer);rfb.disconnect();location.replace('/signin-with-chatgpt');}}
  catch{status.textContent='서버 연결을 다시 확인하고 있어요.';}
},1500);
