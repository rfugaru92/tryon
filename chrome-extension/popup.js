const serverEl = document.getElementById('server');
const statusEl = document.getElementById('status');
const selectBtn = document.getElementById('select');
const previewEl = document.getElementById('preview');
const resultImgEl = document.getElementById('resultImg');
const resultLinkEl = document.getElementById('resultLink');
const autoToggle = document.getElementById('autoToggle');

// Save/load server URL
chrome.storage.local.get(['serverUrl', 'autoTryOn'], (data) => {
  if (data.serverUrl) serverEl.value = data.serverUrl;
  if (typeof data.autoTryOn === 'boolean') autoToggle.checked = data.autoTryOn;
});
serverEl.addEventListener('change', () => {
  chrome.storage.local.set({ serverUrl: serverEl.value });
});

autoToggle.addEventListener('change', async () => {
  const enabled = autoToggle.checked;
  chrome.storage.local.set({ autoTryOn: enabled });
  // notify current tab content script to toggle auto mode
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: 'auto-tryon-toggle', enabled });
  statusEl.textContent = enabled ? 'Auto Try-on enabled' : 'Auto Try-on disabled';
});

function renderResultPayload(payload) {
  if (!payload || !payload.ok) {
    if (previewEl) previewEl.style.display = 'none';
    return;
  }
  const result = payload.result || payload;
  const url = result.generatedImageUrl || (result.result && result.result.generatedImageUrl);
  if (url && previewEl && resultImgEl && resultLinkEl) {
    previewEl.style.display = 'block';
    resultImgEl.src = url;
    resultLinkEl.href = url;
    resultLinkEl.textContent = url;
  } else if (previewEl) {
    previewEl.style.display = 'none';
  }
}

// Load last result on open
chrome.storage.local.get(['lastResult'], ({ lastResult }) => {
  if (lastResult) {
    console.log('[popup] loaded lastResult');
    renderResultPayload(lastResult);
  }
});

selectBtn.addEventListener('click', async () => {
  statusEl.textContent = 'Click an image on the page...';
  // inject a selector overlay via content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.__runware_request_image_selection && window.__runware_request_image_selection()
  });
});

// Listen for messages from background/content
chrome.runtime.onMessage.addListener((msg) => {
  console.log('[popup] message', msg);
  if (msg.type === 'selected') {
    statusEl.textContent = 'Selected image: ' + msg.src;
    statusEl.textContent = 'Sending...';
  }
  if (msg.type === 'runResult') {
    const payload = msg.payload || {};
    console.log('[popup] runResult', payload);
    if (payload.ok) {
      const result = payload.result || payload;
      const url = result.generatedImageUrl || (result.result && result.result.generatedImageUrl) || 'N/A';
      statusEl.textContent = 'Done. generatedImageUrl: ' + url;
  renderResultPayload(payload);
    } else {
      statusEl.textContent = 'Error: ' + (payload.error || JSON.stringify(payload));
  if (previewEl) previewEl.style.display = 'none';
    }
  }
});
