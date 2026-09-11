/** @param {unknown} value @returns {string[]} */
export function normalizeDates(value) {
  if (!Array.isArray(value) || !value.length || value.length > 62) throw new Error('출장 날짜를 1~62일 선택해 주세요.');
  for (const day of value) {
    if (typeof day !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(day)) throw new Error('출장 날짜를 확인해 주세요.');
    const date = new Date(day + 'T00:00:00Z');
    if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== day) throw new Error('출장 날짜를 확인해 주세요.');
  }
  return [...new Set(value)].sort();
}

/** Travel labels only; payment/issuance dates cannot establish a trip day.
 * @param {string} text @returns {string[]} */
export function travelDates(text) {
  const result = [];
  const matches = text.matchAll(/(20\d{2})\s*[.년/\-]\s*(\d{1,2})\s*[.월/\-]\s*(\d{1,2})/g);
  for (const match of matches) {
    const before = text.slice(Math.max(0, match.index - 45), match.index);
    if (!/(?:이용|승차|출발|탑승|운행|대여|반납|체크인|체크아웃)\s*(?:일자|일시|날짜|일|시작|종료)?\s*[:：]?\s*$|(?:departure|travel|rental|return|check.in|check.out)\s*(?:date)?\s*[:：]?\s*$/i.test(before)) continue;
    const day = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    try { result.push(...normalizeDates([day])); } catch {}
  }
  return [...new Set(result)].sort();
}

/** @param {string} text @param {string[]} requestedDates */
export function matchTravelDate(text, requestedDates) {
  const dates = travelDates(text);
  const range = /20\d{2}\s*[.년/\-]\s*\d{1,2}\s*[.월/\-]\s*\d{1,2}(?:일|\s|\d{1,2}:\d{2})*\s*(?:~|～|–|—|부터|\bto\b)\s*(?:20\d{2}\s*[.년/\-]\s*)?\d{1,2}\s*[.월/\-]\s*\d{1,2}/i.test(text);
  // A total spanning multiple travel days must be reviewed once, never duplicated.
  if (range || dates.length !== 1) return { kind: 'review', date: '', dates };
  return { kind: requestedDates.includes(dates[0]) ? 'match' : 'outside', date: dates[0], dates };
}
