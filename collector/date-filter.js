// Self-contained for Chrome isolated-world injection. Only editable native date fields.
export function applyReceiptDates(requestedDates) {
  const visible = node => !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  if (!Array.isArray(requestedDates) || !requestedDates.length) return { applied: false };
  if ([...document.querySelectorAll('input')].some(node => visible(node) && (node.type === 'password' || /otp|card|phone|birth|카드|인증|생년|전화|휴대/i.test([node.name, node.id, node.placeholder].join(' '))))) return { applied: false };
  const label = node => [...(node.labels || [])].map(item => item.innerText).join(' ') + ' ' + (node.getAttribute('aria-label') || '');
  const candidates = [...document.querySelectorAll('input[type="date"]')].filter(node => visible(node) && !node.disabled && !node.readOnly);
  for (const start of candidates) {
    const group = start.closest('form, fieldset');
    if (!group) continue;
    const context = group.innerText || '';
    if (context.length > 1800 || !/이용일|승차일|탑승일|출발일|운행일/.test(context) || /결제일|구매일|예매일|발급일|예약번호|성명|이름/.test(context)) continue;
    const end = candidates.find(node => node !== start && node.closest('form, fieldset') === group && /종료|마지막|까지|end/i.test(label(node)));
    if (!end || !/시작|부터|start/i.test(label(start))) continue;
    const buttons = [...group.querySelectorAll('button, input[type="button"], input[type="submit"]')].filter(node => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true' && /^(조회|조회하기|검색)$/.test((node.innerText || node.value || '').trim()));
    if (buttons.length !== 1) continue;
    const first = requestedDates[0], last = requestedDates[requestedDates.length - 1];
    // Never force values beyond the form's own native constraints.
    if ([start, end].some(node => (node.min && first < node.min) || (node.max && last > node.max))) return { applied: false };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [node, value] of [[start, first], [end, last]]) {
      setter.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (start.value !== first || end.value !== last || !start.checkValidity() || !end.checkValidity()) return { applied: false };
    buttons[0].click(); return { applied: true, first, last };
  }
  return { applied: false };
}
