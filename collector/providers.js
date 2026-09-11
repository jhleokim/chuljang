export const DESTINATION = 'https://chuljang-receipts.jhleokim.chatgpt.site';
export const SOURCES = [
  { id: 'korail', source: 'ktx', name: 'KTX · 코레일', hosts: ['www.korail.com', 'korail.com', 'www.letskorail.com'], startUrl: 'https://www.korail.com/ticket/mypage/ticketInfo/receipt', enabled: true },
  { id: 'kobus', source: 'tmoney', name: '티머니 · 고속버스', hosts: ['www.kobus.co.kr', 'kobus.co.kr'], startUrl: 'https://www.kobus.co.kr/mbrs/trprinqr/pymPtInqr.do', enabled: true },
  { id: 'koreanAir', source: 'airline', name: '대한항공', hosts: ['www.koreanair.com'], startUrl: 'https://www.koreanair.com/reservation/list', enabled: true },
  { id: 'asiana', source: 'airline', name: '아시아나항공', hosts: ['flyasiana.com', 'www.flyasiana.com'], startUrl: 'https://flyasiana.com/C/KR/KO/index?site_preference=NORMAL', enabled: false },
  { id: 'socarBiz', source: 'socar', name: '쏘카 비즈니스', hosts: ['business.socar.kr'], startUrl: 'https://business.socar.kr/', enabled: false },
];
export const APP_SOURCES = [
  { name: '카카오 T 개인', note: '앱 이용기록에서 거래확인증 공유', url: 'https://service.kakaomobility.com/cs/faqs/content/?category=16' },
  { name: '쏘카 개인', note: '앱 결제내역에서 영수증 공유', url: 'https://www.socar.kr/' },
];
export const originsFor = ids => [...new Set(SOURCES.filter(source => ids.includes(source.id)).flatMap(source => source.hosts.map(host => `https://${host}/*`)))];
export function allowedUrl(value, source) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && source.hosts.includes(url.hostname); } catch { return false; }
}
export function safeReadLink(value, label, source) {
  if (!allowedUrl(value, source) || !label || label.length > 90) return false;
  if (/취소|환불|결제하기|구매하기|예매하기|예약하기|탈퇴|로그아웃|cancel|refund|checkout|logout|delete/i.test(label)) return false;
  const url = new URL(value);
  if (/\/(?:cancel|refund|checkout|logout|delete)(?:[/.?]|$)/i.test(url.pathname)) return false;
  if ([...url.searchParams].some(([key, val]) => /^(action|mode|cmd)$/i.test(key) && /cancel|refund|pay|delete|logout/i.test(val))) return false;
  return /영수증|이용\s*내역|구매\s*내역|결제\s*내역|거래\s*내역|예약\s*조회|예약\s*내역|나의\s*예약|지난\s*예약|매출전표|거래확인증|상세\s*(보기|내역)|다음\s*(페이지)?|receipt|payment\s*history|my\s*(trips|bookings)|booking\s*history|next/i.test(label);
}
export const LIVE_STATES = ['opening', 'scanning', 'login', 'attention'];
export const stateNames = { opening: '페이지 여는 중', scanning: '내역 찾는 중', login: '서비스 로그인 필요', attention: '공식 화면 확인 필요', partial: '조회 범위 확인 필요', complete: '조회 완료', empty: '조회 내역 없음', limit: '이번 수집 한도 도달', error: '다시 확인 필요', stopped: '중단됨', expired: '다시 수집 필요' };
