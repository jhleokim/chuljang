import {SOURCES} from '../collector/providers.js';
export function remotePage(provider){
 const source=SOURCES.find(item=>item.id===provider),name=source?.name||'공식 서비스',host=source?new URL(source.loginUrl||source.startUrl).hostname:'';
 return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name} 공식 로그인 · 출장</title><link rel="stylesheet" href="/home-assets/home.css"><body class="remote"><header><div><strong>${name} · ${host}</strong><span id="status">공식 사이트에 직접 로그인하세요. 날짜 조회는 자동으로 이어집니다.</span></div><nav><button id="keyboard" type="button">키보드</button><button id="zoom" type="button">화면 확대</button><a href="/" target="_self">출장 화면</a></nav></header><input id="mobile-input" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="공식 사이트에 키보드 입력"><div id="screen"></div><script type="module" src="/home-assets/remote.js"></script></body></html>`;
}
