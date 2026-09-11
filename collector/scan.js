// Runs in the isolated world of an explicitly permitted service tab. Never reads input values.
export function scanReceiptPage(command = {}) {
  const visible = node => !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  const compact = value => value.replace(/\s+/g, ' ').trim();
  const scrub = value => value.replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, '[카드번호 숨김]').replace(/\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/g, '[연락처 숨김]').slice(0, 12000);
  const readLabel = /^(이용\s*내역(?:\/영수증\s*조회)?|구매\s*내역|항공권\s*구매\s*내역|결제\s*내역|예약\s*조회|예약\s*내역|나의\s*예약|(?:e-?티켓\/)?영수증(?:\s*(보기|조회))?|거래확인증|매출전표|상세\s*(보기|내역)|다음(?:\s*페이지)?|조회|조회하기)$/i;
  const sensitiveForm = [...document.querySelectorAll('input')].some(node => visible(node) && (node.type === 'password' || /카드|생년|휴대|전화|인증|card|password|phone|birth|otp/i.test([node.name, node.id, node.placeholder, node.getAttribute('aria-label')].join(' '))));
  const controls = [...document.querySelectorAll('button, a[href="#"], a[href^="javascript:"], input[type="button"]')].filter(visible);
  const buttonEntries = controls.map((node, index) => ({ label: compact(node.innerText || node.getAttribute('aria-label') || node.getAttribute('value') || ''), index })).filter(item => readLabel.test(item.label) && !sensitiveForm);
  if (command.button) {
    const choice = buttonEntries.find(item => item.label === command.button.label && item.index === command.button.index);
    if (!choice) return { clicked: false };
    const node = controls[choice.index];
    if (node.disabled || node.getAttribute('aria-disabled') === 'true' || (node.type === 'submit' && node.form)) return { clicked: false };
    node.click(); return { clicked: true };
  }
  const root = document.querySelector('main, [role="main"]') || document.body;
  const text = root.innerText || '';
  const password = [...document.querySelectorAll('input[type="password"]')].some(visible);
  const challenge = /보안문자|자동입력\s*방지|로봇이\s*아닙|captcha/i.test(text) || [...document.querySelectorAll('iframe[src*="captcha"]')].some(visible);
  if (password || challenge) return { blocks: [], links: [], buttons: [], state: 'login', note: challenge ? '공식 사이트에서 보안 확인을 마치면 자동으로 이어집니다.' : '이 탭에서 로그인하면 자동으로 이어집니다.' };
  const hasDate = value => /20\d{2}\s*[.년/\-]\s*\d{1,2}\s*[.월/\-]\s*\d{1,2}/.test(value);
  const hasAmount = value => /(?:결제\s*금액|승인\s*금액|총액|합계|운임|요금|AMOUNT PAID|TOTAL)\s*[:：]?\s*(?:₩|￦|KRW|USD|JPY|EUR|\$)?\s*[\d,]+/i.test(value);
  const blocks = [];
  for (const table of document.querySelectorAll('table')) {
    if (!visible(table)) continue;
    const headers = [...table.querySelectorAll('thead th')].map(node => compact(node.innerText));
    for (const row of table.querySelectorAll('tbody tr, tr')) {
      if (!visible(row)) continue;
      const cells = [...row.querySelectorAll(':scope > td')];
      if (!cells.length) continue;
      const value = headers.length === cells.length ? cells.map((cell, i) => `${headers[i]}: ${cell.innerText}`).join('\n') : row.innerText;
      if (hasDate(value) && hasAmount(value) && !/^\s*(합계|총계)/.test(value)) blocks.push(scrub(value));
    }
  }
  for (const node of document.querySelectorAll('[data-receipt], .receipt-item, .payment-item, .ticket-item, .reservation-item')) {
    if (!visible(node) || node.querySelector('[data-receipt], .receipt-item, .payment-item, .ticket-item, .reservation-item')) continue;
    if (hasDate(node.innerText) && hasAmount(node.innerText)) blocks.push(scrub(node.innerText));
  }
  const receiptHeading = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')].some(node => visible(node) && /^(?:전자\s*)?(?:영수증|거래확인증|매출전표|결제\s*영수증|e-?ticket receipt|itinerary receipt)\s*$/i.test(compact(node.innerText)));
  if (!blocks.length && receiptHeading && text.length <= 12000 && hasDate(text) && hasAmount(text) && !sensitiveForm) blocks.push(scrub(text));
  const historyContext = /영수증|이용\s*내역|결제\s*내역|구매\s*내역|예약\s*(조회|내역)|나의\s*예약|my\s*(trips|bookings)/i.test([...document.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(visible).map(node => node.innerText).join(' '));
  const links = [...document.querySelectorAll('a[href]')].filter(visible).map(node => ({ url: node.href, label: compact(node.innerText || node.getAttribute('aria-label') || '') })).filter(item => item.label.length <= 90 && (historyContext || !/상세|다음|next/i.test(item.label)));
  const unique = [...new Set(blocks)].slice(0, 100);
  const needsLogin = !unique.length && /로그인\s*(후|이\s*필요|하셔야|해\s*주세요)|please\s*(log|sign)\s*in/i.test(text);
  const empty = !unique.length && /조회된?\s*(이용|예약|결제|구매)?\s*내역이?\s*없|이용\s*내역이\s*없|예약\s*내역이\s*없|no\s*(bookings|reservations|receipts|results)/i.test(text);
  const pageLabel = [...document.querySelectorAll('[aria-current="page"], .pagination .active, .paging .on')].filter(visible).map(node => node.innerText).join('|');
  return { blocks: unique, pageLabel, links, buttons: buttonEntries.filter(item => historyContext || !/상세|다음|^조회/i.test(item.label)), state: needsLogin ? 'login' : empty ? 'empty' : 'ready', note: sensitiveForm ? '공식 화면에서 조회 정보를 입력하면 자동으로 이어집니다.' : '' };
}
