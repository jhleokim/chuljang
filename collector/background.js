import { DESTINATION, SOURCES, originsFor, allowedUrl, safeReadLink, LIVE_STATES, stateNames } from './providers.js';
import { scanReceiptPage } from './scan.js';
import { enqueue, acknowledge, freshQueue } from './queue.js';

let serial = Promise.resolve();
const locked = work => { const result = serial.then(work); serial = result.catch(() => {}); return result; };
const getState = async () => ({ queue: [], job: null, ...(await chrome.storage.session.get(['queue', 'job', 'destinationTabId'])) });
const saveState = state => chrome.storage.session.set(state);
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
const extensionSender = sender => sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
const websiteSender = sender => sender.id === chrome.runtime.id && sender.frameId === 0 && sender.tab?.url && new URL(sender.tab.url).origin === DESTINATION;
const summary = state => ({ version: 2, running: !!state.job?.tasks.some(task => LIVE_STATES.includes(task.state)), pending: freshQueue(state.queue).reduce((count, item) => count + item.packet.blocks.length, 0), startedAt: state.job?.startedAt || null, tasks: (state.job?.tasks || []).map(({ providerId, state: status, count, note }) => ({ providerId, name: SOURCES.find(source => source.id === providerId)?.name, state: status, label: stateNames[status], count, note })) });
async function destination(state, active = false) {
  let tab;
  if (state.destinationTabId) { try { tab = await chrome.tabs.get(state.destinationTabId); } catch {} }
  if (!tab?.url?.startsWith(DESTINATION + '/')) tab = (await chrome.tabs.query({ url: DESTINATION + '/*' }))[0];
  if (!tab) tab = await chrome.tabs.create({ url: DESTINATION + '/', active });
  else if (active) await chrome.tabs.update(tab.id, { active: true });
  state.destinationTabId = tab.id; await saveState(state); return tab;
}
async function broadcast(state) {
  const data = summary(state);
  await chrome.action.setBadgeText({ text: data.pending ? String(data.pending) : data.running ? '…' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#3159ee' });
  if (state.destinationTabId) await chrome.tabs.sendMessage(state.destinationTabId, { type: 'COLLECTOR_STATUS', status: data }).catch(() => {});
}
async function start(ids, autoStart) {
  const state = await getState(); state.queue = freshQueue(state.queue);
  if (state.queue.length) { await destination(state, true); return { ok: false, error: '아직 저장 대기 중인 내역이 있어요. 출장 화면에서 먼저 확인해 주세요.' }; }
  if (state.job?.tasks.some(task => LIVE_STATES.includes(task.state))) return { ok: true, status: summary(state) };
  const selected = SOURCES.filter(source => ids.includes(source.id));
  if (!selected.length) return { ok: false, error: '연결할 서비스를 선택해 주세요.' };
  if (!(await chrome.permissions.contains({ origins: originsFor(ids) }))) return { ok: false, setup: true, error: '처음 한 번 서비스 연결을 허용해 주세요.' };
  await chrome.storage.local.set({ selected: selected.map(source => source.id), autoStart, lastStart: Date.now() });
  await chrome.alarms.create('collect-watchdog', { periodInMinutes: 0.5 });
  state.job = { id: crypto.randomUUID(), startedAt: Date.now(), tasks: selected.map(source => ({ providerId: source.id, state: 'opening', tabId: null, count: 0, visited: [], pendingUrls: [], seen: [], buttons: [], note: '', scans: 0 })) };
  await saveState(state); await destination(state);
  for (const task of state.job.tasks) {
    try { const tab = await chrome.tabs.create({ url: SOURCES.find(source => source.id === task.providerId).startUrl, active: false }); task.tabId = tab.id; task.state = 'scanning'; }
    catch { task.state = 'error'; task.note = '페이지를 열지 못했어요. 다시 수집해 주세요.'; }
    await saveState(state);
  }
  await broadcast(state); return { ok: true, status: summary(state) };
}
async function finishTab(task) {
  if (!task.tabId) return;
  try { const tab = await chrome.tabs.get(task.tabId); if (!tab.active) { await chrome.tabs.remove(task.tabId); task.tabId = null; } } catch { task.tabId = null; }
}
async function scan(tabId) {
  const state = await getState(), task = state.job?.tasks.find(item => item.tabId === tabId && LIVE_STATES.includes(item.state));
  if (!task) return;
  if (Date.now() - state.job.startedAt > 30 * 60 * 1000) { task.state = 'expired'; task.note = '30분 동안 확인되지 않았어요. 다시 수집해 주세요.'; await saveState(state); await broadcast(state); return; }
  const provider = SOURCES.find(source => source.id === task.providerId);
  try {
    const tab = await chrome.tabs.get(tabId); if (tab.status !== 'complete') return;
    if (!allowedUrl(tab.url, provider)) { task.state = 'login'; task.note = '열린 공식 로그인 화면에서 인증을 마치면 이어집니다.'; await saveState(state); await broadcast(state); return; }
    if (Date.now() - (task.lastScan || 0) < 1500) return;
    task.lastScan = Date.now(); task.scans += 1; await saveState(state);
    await chrome.scripting.executeScript({ target: { tabId }, files: ['watch.js'] });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: scanReceiptPage });
    if (!result) throw new Error('화면을 읽지 못했어요.');
    if (result.state === 'login') { task.state = 'login'; task.note = result.note || '로그인하면 자동으로 이어집니다.'; await saveState(state); await broadcast(state); return; }
    task.state = 'scanning'; const fresh = [];
    for (const block of result.blocks) { const hash = await digest(block.replace(/\s+/g, ' ').trim()); if (!task.seen.includes(hash) && task.count + fresh.length < 100) { task.seen.push(hash); fresh.push(block); } }
    if (fresh.length) {
      const sourceUrl = new URL(tab.url); sourceUrl.search = ''; sourceUrl.hash = '';
      state.queue = enqueue(state.queue, { version: 2, source: provider.source, blocks: fresh, sourceUrl: sourceUrl.toString(), automatic: true }, crypto.randomUUID()); task.count += fresh.length;
    }
    if (!task.visited.includes(tab.url)) task.visited.push(tab.url);
    for (const link of result.links) if (safeReadLink(link.url, link.label, provider) && !task.visited.includes(link.url) && !task.pendingUrls.includes(link.url) && task.pendingUrls.length < 40) task.pendingUrls.push(link.url);
    if (task.count >= 100 || task.visited.length >= 20 || task.buttons.length >= 20) { task.state = 'limit'; task.note = '최대 100건·20개 화면까지 모았어요. 추가 내역은 공식 화면에서 조회해 주세요.'; }
    else if (task.pendingUrls.length) {
      const next = task.pendingUrls.shift(); task.note = '영수증 화면으로 이동하고 있어요.';
      await saveState(state); await chrome.tabs.update(tabId, { url: next }); await broadcast(state); return;
    } else {
      const generation = await digest(JSON.stringify([result.pageLabel, result.blocks]));
      const buttonKey = button => tab.url + ':' + button.label + ':' + button.index + ':' + generation;
      const nextButton = result.buttons.find(button => !task.buttons.includes(buttonKey(button)));
      if (nextButton) {
        task.buttons.push(buttonKey(nextButton)); await saveState(state);
        const [{ result: moved }] = await chrome.scripting.executeScript({ target: { tabId }, func: scanReceiptPage, args: [{ button: nextButton }] });
        if (moved?.clicked) { task.note = '조회 결과를 기다리고 있어요.'; await saveState(state); await broadcast(state); return; }
      }
      if (task.scans < 2 && !task.count) task.note = '화면이 준비되기를 기다리고 있어요.';
      else { task.state = task.count ? 'complete' : result.state === 'empty' ? 'empty' : 'attention'; task.note = task.count ? '현재 조회 기간에서 찾은 내역을 전송했어요.' : result.note || (result.state === 'empty' ? '공식 화면에 조회 내역이 없어요.' : '로그인·조회 기간·예약 정보를 공식 화면에서 확인해 주세요. 완료하면 다시 읽습니다.'); }
    }
    await saveState(state);
    if (['complete', 'empty'].includes(task.state)) { await finishTab(task); await saveState(state); }
    await broadcast(state);
  } catch (error) { task.state = 'error'; task.note = error.message || '화면이 바뀌었거나 접근할 수 없어요.'; await saveState(state); await broadcast(state); }
}
async function status() { const state = await getState(); const before = state.queue.length; state.queue = freshQueue(state.queue); if (before !== state.queue.length) await saveState(state); return summary(state); }
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const site = websiteSender(sender), extension = extensionSender(sender);
  if (message?.type === 'RECEIPT_DOM_CHANGED' && sender.frameId === 0 && sender.tab?.id) { void locked(() => scan(sender.tab.id)); return false; }
  if (!site && !extension) return false;
  const handle = async () => {
    const state = await getState();
    if (message.type === 'STATUS') return { ok: true, status: await status() };
    if (message.type === 'OPEN_SETUP') { await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html'), active: true }); return { ok: true }; }
    if (message.type === 'START') {
      const prefs = await chrome.storage.local.get(['selected', 'autoStart']);
      const result = await start(extension && Array.isArray(message.selected) ? message.selected : prefs.selected || SOURCES.filter(source => source.enabled).map(source => source.id), extension ? !!message.autoStart : prefs.autoStart !== false);
      if (result.setup) await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html'), active: true }); return result;
    }
    if (message.type === 'STOP') { for (const task of state.job?.tasks || []) if (LIVE_STATES.includes(task.state)) task.state = 'stopped'; await saveState(state); await chrome.alarms.clear('collect-watchdog'); await broadcast(state); return { ok: true, status: summary(state) }; }
    if (message.type === 'OPEN_SOURCE') { const task = state.job?.tasks.find(item => item.providerId === message.providerId); if (task?.tabId) { try { await chrome.tabs.update(task.tabId, { active: true }); return { ok: true }; } catch {} } return { ok: false, error: '다시 수집을 시작해 주세요.' }; }
    if (message.type === 'OPEN_DESTINATION') { await destination(state, true); return { ok: true }; }
    if (message.type === 'GET_CAPTURE' && site) {
      if (!state.destinationTabId) state.destinationTabId = sender.tab.id;
      else if (state.destinationTabId !== sender.tab.id) { try { const bound = await chrome.tabs.get(state.destinationTabId); if (bound.url?.startsWith(DESTINATION + '/')) return null; } catch {} state.destinationTabId = sender.tab.id; }
      state.queue = freshQueue(state.queue); await saveState(state); return state.queue.find(item => !item.reviewDocumentId || item.reviewDocumentId !== sender.documentId) || null;
    }
    if (message.type === 'DEFER_CAPTURE' && site && state.destinationTabId === sender.tab.id && sender.documentId) { const item = state.queue.find(item => item.captureId === message.captureId); if (item) item.reviewDocumentId = sender.documentId; await saveState(state); return { ok: true }; }
    if (message.type === 'ACK_CAPTURE' && site && state.destinationTabId === sender.tab.id) { state.queue = acknowledge(state.queue, message.captureId); await saveState(state); await broadcast(state); return { ok: true }; }
    if (message.type === 'CURRENT_PAGE' && extension) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); const provider = SOURCES.find(source => allowedUrl(tab?.url, source));
      if (!provider) return { ok: false, error: '지원 서비스의 영수증 페이지에서 실행해 주세요.' };
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scanReceiptPage });
      if (!result?.blocks?.length) return { ok: false, error: '날짜·금액이 있는 영수증을 찾지 못했어요.' };
      const url = new URL(tab.url); url.search = ''; url.hash = '';
      state.queue = enqueue(state.queue, { version: 2, source: provider.source, blocks: result.blocks, sourceUrl: url.toString(), automatic: true }, crypto.randomUUID());
      await saveState(state); await destination(state, true); await broadcast(state); return { ok: true };
    }
    return { ok: false, error: '지원하지 않는 동작입니다.' };
  };
  locked(handle).then(respond).catch(error => respond({ ok: false, error: error.message })); return true;
});
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'complete' || change.url) void locked(() => scan(tabId)); });
chrome.tabs.onRemoved.addListener(tabId => { void locked(async () => { const state = await getState(); const task = state.job?.tasks.find(item => item.tabId === tabId && LIVE_STATES.includes(item.state)); if (task) { task.state = 'stopped'; task.note = '수집 탭을 닫았어요.'; task.tabId = null; await saveState(state); await broadcast(state); } }); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name !== 'collect-watchdog') return; void locked(async () => {
  const state = await getState();
  for (const task of state.job?.tasks || []) {
    if (task.state === 'opening' && !task.tabId) {
      try {
        if (Date.now() - state.job.startedAt > 30 * 60 * 1000) { task.state = 'expired'; task.note = '다시 수집을 시작해 주세요.'; }
        else { const tab = await chrome.tabs.create({ url: SOURCES.find(source => source.id === task.providerId).startUrl, active: false }); task.tabId = tab.id; task.state = 'scanning'; }
      } catch { task.state = 'error'; task.note = '페이지를 다시 열지 못했어요. 다시 수집해 주세요.'; }
      await saveState(state);
    }
  }
  for (const task of state.job?.tasks || []) if (task.tabId && LIVE_STATES.includes(task.state)) await scan(task.tabId);
  const after = await getState(); if (!after.job?.tasks.some(task => LIVE_STATES.includes(task.state))) await chrome.alarms.clear('collect-watchdog');
}); });
chrome.runtime.onStartup.addListener(() => { void locked(async () => { const prefs = await chrome.storage.local.get(['selected', 'autoStart', 'lastStart']); if (prefs.autoStart && prefs.selected?.length && Date.now() - (prefs.lastStart || 0) > 6 * 60 * 60 * 1000) await start(prefs.selected, true); }); });
