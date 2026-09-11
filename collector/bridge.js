let ready = false, inFlight = null, polling = false;
const delivered = new Set();
const post = message => window.postMessage(message, location.origin);
async function poll() {
  if (polling) return; polling = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'STATUS' });
    post({ type: 'CHULJANG_EXTENSION', version: 2, status: result?.status });
    if (!ready || inFlight) return;
    const item = await chrome.runtime.sendMessage({ type: 'GET_CAPTURE' });
    if (!item || inFlight) return;
    inFlight = item.captureId; delivered.add(inFlight);
    post({ type: 'CHULJANG_COLLECTED', packet: item.packet, captureId: inFlight });
  } catch {} finally { polling = false; }
}
window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type === 'CHULJANG_READY') { ready = true; void poll(); }
  if (data?.type === 'CHULJANG_PROBE') { post({ type: 'CHULJANG_EXTENSION', version: 2 }); void poll(); }
  if (data?.type === 'CHULJANG_BUSY' && data.captureId === inFlight) { inFlight = null; ready = false; }
  if (data?.type === 'CHULJANG_REVIEW_PENDING' && data.captureId === inFlight) {
    chrome.runtime.sendMessage({ type: 'DEFER_CAPTURE', captureId: inFlight }).then(() => { inFlight = null; void poll(); }).catch(() => {});
  }
  if (data?.type === 'CHULJANG_SAVED' && delivered.has(data.captureId)) {
    chrome.runtime.sendMessage({ type: 'ACK_CAPTURE', captureId: data.captureId }).then(() => { delivered.delete(data.captureId); if (inFlight === data.captureId) inFlight = null; void poll(); }).catch(() => {});
  }
  if (data?.type === 'CHULJANG_COLLECTOR_COMMAND' && ['START', 'STOP', 'OPEN_SETUP', 'OPEN_SOURCE'].includes(data.command)) {
    chrome.runtime.sendMessage({ type: data.command, providerId: data.providerId }).then(result => { post({ type: 'CHULJANG_COMMAND_RESULT', requestId: data.requestId, result }); void poll(); }).catch(() => post({ type: 'CHULJANG_COMMAND_RESULT', requestId: data.requestId, result: { ok: false, error: '수집 도구를 다시 연결해 주세요.' } }));
  }
});
chrome.runtime.onMessage.addListener(message => { if (message.type === 'COLLECTOR_STATUS') { post({ type: 'CHULJANG_EXTENSION', version: 2, status: message.status }); void poll(); } });
setInterval(() => void poll(), 5000);
post({ type: 'CHULJANG_BRIDGE_READY' });
post({ type: 'CHULJANG_EXTENSION', version: 2 });
