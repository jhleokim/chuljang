(() => {
  if (window.__chuljangReceiptWatcher) return;
  window.__chuljangReceiptWatcher = true;
  let timer;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => chrome.runtime.sendMessage({ type: 'RECEIPT_DOM_CHANGED' }).catch(() => {}), 1800);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setTimeout(() => { observer.disconnect(); window.__chuljangReceiptWatcher = false; }, 30 * 60 * 1000);
})();
