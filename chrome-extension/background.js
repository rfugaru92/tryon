// background service worker handles messages from content and forwards selection to popup
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'image-selected') {
    // When an image is selected, fetch its bytes (background context) and POST to server
    (async () => {
      try {
        const src = msg.src;
    console.log('[background] image-selected', src);
        // Get server URL from storage (fallback to localhost)
        const data = await chrome.storage.local.get(['serverUrl']);
        const server = (data.serverUrl || 'http://localhost:3000').replace(/\/$/, '');
    console.log('[background] server url', server);

        // Fetch the image bytes (cors is allowed in extension background)
    console.log('[background] fetching image bytes...');
        const r = await fetch(src, { mode: 'cors', credentials: 'omit' });
    console.log('[background] fetch response', r.status);
        if (!r.ok) throw new Error('Failed to fetch image: ' + r.status);
        const blob = await r.blob();
    console.log('[background] fetched blob size', blob.size || '(unknown)');

        // Build form data and POST to /runBlob
    console.log('[background] posting blob to server...');
        const fd = new FormData();
        fd.append('in1', blob, 'in1.jpg');
        const resp = await fetch(server + '/runBlob', { method: 'POST', body: fd });
    console.log('[background] server returned', resp.status);
  const json = await resp.json().catch(() => ({ ok: false, error: 'Invalid JSON response' }));

  // Persist last result for popup to show later
  try { await chrome.storage.local.set({ lastResult: json }); } catch (e) { console.warn('[background] failed to store lastResult', e); }

  // Forward result to any listeners (popup)
  console.log('[background] run result', json && (json.ok ? 'ok' : json.error));
  chrome.runtime.sendMessage({ type: 'runResult', payload: json });
      } catch (err) {
    console.error('[background] error during fetch/post', err);
        chrome.runtime.sendMessage({ type: 'runResult', payload: { ok: false, error: err.message } });
      }
    })();
    // Also notify popup that selection happened
  console.log('[background] notifying popup of selection');
    chrome.runtime.sendMessage({ type: 'selected', src: msg.src });
  }
});
