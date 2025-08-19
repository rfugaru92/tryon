// Content script: allow user to click an image to select it for the extension
(function () {
  // --- Auto Try-on helpers/state ---
  const RW_Z_BASE = 2147483600; // keep below selection overlay when active
  const autoState = {
    enabled: false,
    attached: new WeakSet(), // elements with button attached
    btns: new Map(), // element -> { btn }
    observer: null,
    scrollHandler: null,
    resizeHandler: null,
    pendingScan: null,
  };

  function rwParseSrcset(srcset) {
    if (!srcset) return null;
    const parts = String(srcset).split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    return parts[0].split(/\s+/)[0] || null;
  }
  function rwUrlFromBackground(str) {
    if (!str) return null;
    const m = String(str).match(/url\((['"]?)(.*?)\1\)/i);
    return m ? m[2] : null;
  }
  function rwResolveAbs(u) {
    if (!u) return u;
    if (/^(data:|https?:)/i.test(u)) return u;
    try { return new URL(u, document.baseURI).href; } catch { return u; }
  }
  function rwTryGetFromImg(img) {
    if (!img) return null;
    return img.currentSrc || img.src || img.getAttribute('data-src') || rwParseSrcset(img.getAttribute('srcset')) || rwParseSrcset(img.getAttribute('data-srcset')) || null;
  }
  function rwFindImageOnElement(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName;
    if (tag === 'IMG') {
      const s = rwTryGetFromImg(el);
      if (s) return { src: rwResolveAbs(s), node: el };
    }
    if (tag === 'SOURCE') {
      const s = rwParseSrcset(el.getAttribute('srcset')) || el.getAttribute('src');
      if (s) return { src: rwResolveAbs(s), node: el };
    }
    if (tag === 'CANVAS') {
      try { const s = el.toDataURL(); if (s) return { src: s, node: el }; } catch {}
    }
    // SVG <image>
    if (tag === 'IMAGE' || tag === 'SVG') {
      const imgEl = tag === 'IMAGE' ? el : (el.querySelector && el.querySelector('image'));
      if (imgEl) {
        const href = imgEl.getAttribute('href') || imgEl.getAttribute('xlink:href');
        if (href) return { src: rwResolveAbs(href), node: imgEl };
      }
    }
    // background-image
    const inline = el.style && el.style.backgroundImage;
    const comp = getComputedStyle(el).backgroundImage;
    const bg = rwUrlFromBackground(inline) || rwUrlFromBackground(comp);
    if (bg) return { src: rwResolveAbs(bg), node: el };
    // pseudo-elements
    try {
      const pb = getComputedStyle(el, '::before').backgroundImage;
      const pa = getComputedStyle(el, '::after').backgroundImage;
      const pbg = rwUrlFromBackground(pb) || rwUrlFromBackground(pa);
      if (pbg) return { src: rwResolveAbs(pbg), node: el };
    } catch {}
    // descendants quick search
    try {
      const d = el.querySelector && el.querySelector('img, source, canvas, svg image, svg');
      if (d) return rwFindImageOnElement(d);
    } catch {}
    return null;
  }
  function rwIsVisible(el) {
    if (!el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.05) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 60) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > (innerHeight || document.documentElement.clientHeight) || r.left > (innerWidth || document.documentElement.clientWidth)) return false;
    return true;
  }
  function rwUpdatePositions() {
    try {
      for (const [el, data] of autoState.btns) {
        if (!el.isConnected || !rwIsVisible(el)) {
          if (data && data.btn) { try { data.btn.style.display = 'none'; } catch {} }
          continue;
        }
        const r = el.getBoundingClientRect();
        const btn = data.btn;
        btn.style.left = (r.left + r.width - 70) + 'px';
        btn.style.top = (r.top + r.height - 34) + 'px';
        btn.style.display = 'block';
      }
    } catch {}
  }
  function rwAttachButton(el) {
    if (autoState.attached.has(el)) return;
    const found = rwFindImageOnElement(el);
    if (!found || !found.src) return;
    if (!rwIsVisible(el)) return;

    const btn = document.createElement('button');
    btn.className = 'rw-tryon-btn';
    btn.textContent = 'Try on';
    btn.style.position = 'fixed';
    btn.style.zIndex = String(RW_Z_BASE + 50);
    btn.style.pointerEvents = 'auto';
    btn.style.background = '#2563eb';
    btn.style.color = '#fff';
    btn.style.font = '12px system-ui, -apple-system, Segoe UI, Arial';
    btn.style.padding = '6px 10px';
    btn.style.border = '0';
    btn.style.borderRadius = '6px';
    btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    btn.style.cursor = 'pointer';
    btn.style.display = 'none';
    document.body.appendChild(btn);

    btn.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const again = rwFindImageOnElement(el) || found;
      const src = again && again.src;
      if (src) {
        try { chrome.runtime.sendMessage({ type: 'image-selected', src }); } catch (e) { console.error('[content] sendMessage failed', e); }
      }
    }, true);

    autoState.attached.add(el);
    autoState.btns.set(el, { btn });
    // Initial position
    rwUpdatePositions();
  }
  function rwScanOnce() {
    if (!autoState.enabled) return;
    const candidates = [];
    try {
      candidates.push(...document.querySelectorAll('img'));
      candidates.push(...document.querySelectorAll('canvas'));
      candidates.push(...document.querySelectorAll('svg, svg image'));
      // Elements likely to have backgrounds
      candidates.push(...document.querySelectorAll('[style*="background"], [class*="bg"], [data-bg], picture'));
    } catch {}
    const uniq = new Set();
    for (const el of candidates) {
      if (!(el instanceof Element)) continue;
      if (el.closest('.rw-tryon-btn')) continue; // skip our UI
      if (uniq.has(el)) continue; uniq.add(el);
      rwAttachButton(el);
    }
    rwUpdatePositions();
  }
  function rwStartAuto() {
    if (autoState.enabled) return;
    autoState.enabled = true;
    // Observe DOM changes
    if (!autoState.observer) {
      autoState.observer = new MutationObserver(() => {
        if (autoState.pendingScan) return;
        autoState.pendingScan = setTimeout(() => { autoState.pendingScan = null; rwScanOnce(); }, 100);
      });
    }
    autoState.observer.observe(document.documentElement || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'style', 'class'] });
    // Scroll/resize update
    autoState.scrollHandler = () => { rwUpdatePositions(); };
    autoState.resizeHandler = () => { rwUpdatePositions(); };
    window.addEventListener('scroll', autoState.scrollHandler, true);
    window.addEventListener('resize', autoState.resizeHandler, true);
    // Initial scan
    rwScanOnce();
    console.log('[content] Auto Try-on enabled');
  }
  function rwStopAuto() {
    if (!autoState.enabled) return;
    autoState.enabled = false;
    if (autoState.observer) try { autoState.observer.disconnect(); } catch {}
    if (autoState.pendingScan) { clearTimeout(autoState.pendingScan); autoState.pendingScan = null; }
    if (autoState.scrollHandler) { window.removeEventListener('scroll', autoState.scrollHandler, true); autoState.scrollHandler = null; }
    if (autoState.resizeHandler) { window.removeEventListener('resize', autoState.resizeHandler, true); autoState.resizeHandler = null; }
    try {
      for (const [el, data] of autoState.btns) {
        if (data && data.btn) try { data.btn.remove(); } catch {}
      }
    } catch {}
  autoState.btns = new Map();
    autoState.attached = new WeakSet();
    console.log('[content] Auto Try-on disabled');
  }

  // Create a function on window so popup can trigger it
  window.__runware_request_image_selection = function () {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = 0;
  overlay.style.left = 0;
  overlay.style.right = 0;
  overlay.style.bottom = 0;
  overlay.style.zIndex = 2147483646; // keep below highlight
  overlay.style.cursor = 'crosshair';
  overlay.style.background = 'rgba(0,0,0,0.02)';
  overlay.style.pointerEvents = 'none'; // don't block hits
  document.body.appendChild(overlay);

  // Highlight box to preview the candidate element
  const highlight = document.createElement('div');
  highlight.style.position = 'fixed';
  highlight.style.zIndex = 2147483647;
  highlight.style.pointerEvents = 'none';
  highlight.style.border = '2px solid #3b82f6';
  highlight.style.boxShadow = '0 0 0 2px rgba(59,130,246,0.25) inset, 0 0 0 2px rgba(59,130,246,0.25)';
  highlight.style.background = 'rgba(59,130,246,0.08)';
  document.body.appendChild(highlight);

  // Hint label near cursor
  const hint = document.createElement('div');
  hint.textContent = 'Click to select image (Esc to cancel)';
  hint.style.position = 'fixed';
  hint.style.zIndex = '2147483648';
  hint.style.pointerEvents = 'none';
  hint.style.background = 'rgba(17,24,39,0.9)';
  hint.style.color = '#fff';
  hint.style.font = '12px system-ui, -apple-system, Segoe UI, Arial';
  hint.style.padding = '4px 8px';
  hint.style.borderRadius = '6px';
  hint.style.transform = 'translate(12px, 12px)';
  document.body.appendChild(hint);

  // Floating action button on candidate element
  const runBtn = document.createElement('button');
  runBtn.textContent = 'Try on';
  runBtn.style.position = 'fixed';
  runBtn.style.zIndex = '2147483649';
  runBtn.style.pointerEvents = 'auto';
  runBtn.style.background = '#2563eb';
  runBtn.style.color = '#fff';
  runBtn.style.font = '12px system-ui, -apple-system, Segoe UI, Arial';
  runBtn.style.padding = '6px 10px';
  runBtn.style.border = '0';
  runBtn.style.borderRadius = '6px';
  runBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
  runBtn.style.cursor = 'pointer';
  runBtn.style.display = 'none';
  document.body.appendChild(runBtn);

    // Keep references to dynamically attached handlers so we can remove them in clean()
    let moveHandler = null;
    let docClickHandler = null;

    function clean() {
      try { overlay.remove(); } catch {}
      try { highlight.remove(); } catch {}
      try { hint.remove(); } catch {}
      try { runBtn.remove(); } catch {}
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      if (moveHandler) document.removeEventListener('mousemove', moveHandler, true);
      if (docClickHandler) document.removeEventListener('click', docClickHandler, true);
    }

    function onKey(e) { if (e.key === 'Escape') { clean(); } }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      const el = e.target;

      function parseSrcset(srcset) {
        if (!srcset) return null;
        // take first URL token before space/descriptor
        const parts = srcset.split(',').map(s => s.trim()).filter(Boolean);
        if (parts.length === 0) return null;
        const first = parts[0].split(/\s+/)[0];
        return first || null;
      }

      function urlFromBackground(str) {
        if (!str) return null;
        const m = String(str).match(/url\((['"]?)(.*?)\1\)/i);
        return m ? m[2] : null;
      }

      function tryGetFromImg(img) {
        if (!img) return null;
        return img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy') || parseSrcset(img.getAttribute('srcset')) || parseSrcset(img.getAttribute('data-srcset')) || null;
      }

      function findInShadow(root) {
        try {
          if (!root) return null;
          const img = root.querySelector('img');
          if (img) return tryGetFromImg(img);
        } catch (e) { /* ignore */ }
        return null;
      }

      function resolveAbs(u) {
        if (!u) return u;
        if (u.startsWith('data:') || /^https?:\/\//i.test(u)) return u;
        try { return new URL(u, document.baseURI).href; } catch { return u; }
      }

      function readFromElement(node) {
        if (!node || node.nodeType !== 1) return null;
        const tag = node.tagName;
        // IMG / SOURCE
        if (tag === 'IMG') return tryGetFromImg(node);
        if (tag === 'SOURCE') return parseSrcset(node.getAttribute('srcset')) || node.src || node.getAttribute('data-src');
        // CANVAS
        if (tag === 'CANVAS') { try { return node.toDataURL(); } catch { /* tainted */ } }
        // SVG <image>
        if (tag === 'IMAGE' || tag === 'SVG') {
          const imgEl = node.tagName === 'IMAGE' ? node : (node.querySelector && node.querySelector('image'));
          if (imgEl) {
            const href = imgEl.getAttribute('href') || imgEl.getAttribute('xlink:href');
            if (href) return href;
          }
        }
        // Backgrounds
        const inline = node.style && node.style.backgroundImage;
        const comp = window.getComputedStyle(node, null).backgroundImage;
        const bg = urlFromBackground(inline) || urlFromBackground(comp);
        if (bg) return bg;
        // Pseudo backgrounds
        try {
          const pb = window.getComputedStyle(node, '::before').backgroundImage;
          const pa = window.getComputedStyle(node, '::after').backgroundImage;
          const pbg = urlFromBackground(pb) || urlFromBackground(pa);
          if (pbg) return pbg;
        } catch {}
        // Shadow root first img
        if (node.shadowRoot) {
          const s = findInShadow(node.shadowRoot);
          if (s) return s;
        }
        return null;
      }

      function findImageUrlAtPoint(ev, startEl) {
        const x = ev.clientX, y = ev.clientY;
        let stacked = [];
        if (document.elementsFromPoint) stacked = document.elementsFromPoint(x, y);
        else {
          const one = document.elementFromPoint(x, y); if (one) stacked = [one];
        }
        const path = (ev.composedPath && ev.composedPath()) || [];
        // merge path + stacked, keep unique Elements
        const combined = [];
        const seen = new Set();
        function add(n) {
          if (!n || n.nodeType !== 1) return; // Elements only
          if (seen.has(n)) return; seen.add(n); combined.push(n);
        }
        path.forEach(add); stacked.forEach(add);

        // 1) scan combined elements
        for (const n of combined) {
          const got = readFromElement(n);
          if (got) return { src: resolveAbs(got), node: n };
        }

        // 2) climb ancestors from startEl (extra safety)
        let cur = startEl;
        while (cur) {
          const got = readFromElement(cur);
          if (got) return { src: resolveAbs(got), node: cur };
          cur = cur.parentElement;
        }

        // 3) search descendants of the clicked element
        try {
          const descendant = startEl.querySelector && startEl.querySelector('img, source, canvas, svg image, svg');
          if (descendant) {
            const got = readFromElement(descendant);
            if (got) return { src: resolveAbs(got), node: descendant };
          }
        } catch {}

        return null;
      }

      // Live highlight while moving
      let lastRect = null;
      let lastFound = null;
  function onMove(ev) {
        hint.style.left = ev.clientX + 'px';
        hint.style.top = ev.clientY + 'px';
        const found = findImageUrlAtPoint(ev, ev.target || el);
        if (found && found.node && typeof found.node.getBoundingClientRect === 'function') {
          const r = found.node.getBoundingClientRect();
          if (!lastRect || r.x !== lastRect.x || r.y !== lastRect.y || r.width !== lastRect.width || r.height !== lastRect.height) {
            highlight.style.left = r.left + 'px';
            highlight.style.top = r.top + 'px';
            highlight.style.width = r.width + 'px';
            highlight.style.height = r.height + 'px';
            lastRect = { x: r.x, y: r.y, width: r.width, height: r.height };
          }
          // position button bottom-right with small offset
          runBtn.style.left = (r.left + r.width - 70) + 'px';
          runBtn.style.top = (r.top + r.height - 34) + 'px';
          runBtn.style.display = 'block';
          lastFound = found;
        } else {
          highlight.style.width = '0px';
          highlight.style.height = '0px';
          runBtn.style.display = 'none';
        }
      }
  moveHandler = onMove;
  document.addEventListener('mousemove', moveHandler, true);

      // Clicking anywhere confirms current candidate
      const foundOnClick = findImageUrlAtPoint(e, el);
      const initialSrc = foundOnClick && foundOnClick.src;
      console.log('[content] selection mode started; initial candidate', initialSrc);

      function confirm(found) {
        const src = found && found.src;
        console.log('[content] confirmed src', src);
        if (src) {
          try { chrome.runtime.sendMessage({ type: 'image-selected', src }); }
          catch (err) { console.error('[content] sendMessage failed', err); }
        } else {
          alert('No image found here — try another element.');
        }
        clean();
      }

      // Button click confirms
      runBtn.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); confirm(lastFound || foundOnClick); };

      // Page click also confirms current highlighted
      // (kept for convenience)
      docClickHandler = function onDocClick(ev2){
        // Block page interactions during selection, but do NOT confirm.
        ev2.preventDefault();
        ev2.stopPropagation();
      };
      document.addEventListener('click', docClickHandler, true);
    }

    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  };

  // Also listen for background->popup requests to forward results back
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'ping') return; // noop
    if (msg && msg.type === 'auto-tryon-toggle') {
      if (msg.enabled) rwStartAuto(); else rwStopAuto();
    }
  });

  // Load saved auto mode and apply on page load
  try {
    chrome.storage?.local?.get?.(['autoTryOn'], (data) => {
      if (data && data.autoTryOn) rwStartAuto();
    });
  } catch {}
})();
