import { SOURCES, originsFor, stateNames } from './providers.js';
const byId=id=>document.getElementById(id);
const prefs=await chrome.storage.local.get(['selected','autoStart']);
for(const source of SOURCES){const label=document.createElement('label');label.className='source';const input=document.createElement('input');input.type='checkbox';input.value=source.id;input.checked=(prefs.selected||SOURCES.filter(s=>s.enabled).map(s=>s.id)).includes(source.id);label.append(input,document.createTextNode(source.name));if(source.id==='socarBiz'){const note=document.createElement('small');note.textContent='기업 프로필';label.append(note);}byId('sources').append(label);}
byId('startup').checked=prefs.autoStart!==false;
async function send(type,extra={}){const result=await chrome.runtime.sendMessage({type,...extra});if(result?.error)byId('message').textContent=result.error;return result;}
function render(status){if(!status)return;byId('start').disabled=status.running;byId('stop').hidden=!status.running;byId('start').textContent=status.running?'연결 서비스에서 찾고 있어요':'연결하고 모두 가져오기';byId('progress').replaceChildren();for(const task of status.tasks){const row=document.createElement('div');row.className='task';const name=document.createElement('strong');name.textContent=task.name+' · '+stateNames[task.state];const note=document.createElement('span');note.textContent=(task.count?task.count+'건 발견 · ':'')+(task.note||'');row.append(name,note);if(['login','attention'].includes(task.state)){const button=document.createElement('button');button.className='secondary';button.textContent=task.state==='login'?'로그인하고 자동으로 이어가기':'공식 화면 확인';button.onclick=()=>send('OPEN_SOURCE',{providerId:task.providerId});row.append(button);}byId('progress').append(row);}}
byId('start').addEventListener('click',async()=>{const selected=[...byId('sources').querySelectorAll('input:checked')].map(input=>input.value);if(!selected.length){byId('message').textContent='서비스를 하나 이상 선택해 주세요.';return;}byId('message').textContent='';try{const granted=await chrome.permissions.request({origins:originsFor(selected)});if(!granted){byId('message').textContent='선택한 서비스 접근을 허용하면 자동으로 가져올 수 있어요.';return;}render((await send('START',{selected,autoStart:byId('startup').checked}))?.status);}catch(error){byId('message').textContent=error.message;}});
byId('stop').onclick=async()=>render((await send('STOP'))?.status);
byId('destination').onclick=()=>send('OPEN_DESTINATION');
byId('current').onclick=()=>send('CURRENT_PAGE');
byId('startup').onchange=()=>chrome.storage.local.set({autoStart:byId('startup').checked});
async function refresh(){try{render((await send('STATUS'))?.status);}catch{byId('message').textContent='수집 도구를 다시 열어 주세요.';}}
await refresh();setInterval(refresh,3000);
