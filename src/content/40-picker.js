/* AI Autofill Studio — content/40-picker.js
 * Lop overlay kieu Chrome DevTools: highlight khi hover, chon element bang click,
 * danh so cac field da nhan dien, nhay xanh/do sau khi dien.
 */
(() => {
  const AF = window.__AF__;
  if (!AF || AF.Picker) return;

  let host = null;
  let root = null;
  let layer = null;
  let tip = null;
  let picking = false;
  let onPick = null;

  const CSS_TEXT = `
    :host { all: initial; }
    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
    .box {
      position: fixed; border: 2px solid #7c5cff; background: rgba(124,92,255,.14);
      border-radius: 3px; pointer-events: none; transition: none;
      box-shadow: 0 0 0 1px rgba(255,255,255,.6) inset;
    }
    .box.ok { border-color:#16a34a; background: rgba(22,163,74,.18); }
    .box.err{ border-color:#dc2626; background: rgba(220,38,38,.18); }
    .box.idx{ border-color:#0ea5e9; background: rgba(14,165,233,.10); border-width:1px; }
    .badge {
      position: fixed; font: 600 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;
      background:#0ea5e9; color:#fff; padding:1px 5px; border-radius:3px;
      transform: translateY(-100%); pointer-events:none; white-space:nowrap;
    }
    .tip {
      position: fixed; max-width: 380px; z-index: 2147483647;
      font: 12px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      background:#1f1b2e; color:#f4f2ff; padding:6px 9px; border-radius:6px;
      box-shadow:0 6px 22px rgba(0,0,0,.35); pointer-events:none;
    }
    .tip b { color:#c4b5fd; }
    .tip code { font: 11px ui-monospace,Menlo,monospace; color:#a5f3fc; }
    .hint {
      position: fixed; left:50%; top:14px; transform:translateX(-50%);
      background:#7c5cff; color:#fff; padding:7px 14px; border-radius:999px;
      font:600 12px/1 ui-sans-serif,system-ui,sans-serif; z-index:2147483647;
      box-shadow:0 6px 22px rgba(0,0,0,.3); pointer-events:none;
    }
  `;

  const ensure = () => {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.setAttribute('data-af-overlay', '');
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS_TEXT;
    layer = document.createElement('div');
    layer.className = 'layer';
    root.append(style, layer);
    (document.documentElement || document.body).appendChild(host);
  };

  const place = (node, r, pad = 0) => {
    node.style.left = `${r.left - pad}px`;
    node.style.top = `${r.top - pad}px`;
    node.style.width = `${r.width + pad * 2}px`;
    node.style.height = `${r.height + pad * 2}px`;
  };

  const clearLayer = () => {
    if (layer) layer.innerHTML = '';
  };

  /* ------------------------------------------------------------ highlight */

  const box = (el, cls = '', ttl = 0) => {
    ensure();
    const b = document.createElement('div');
    b.className = `box ${cls}`;
    place(b, AF.rectOf(el));
    layer.appendChild(b);
    if (ttl) setTimeout(() => b.remove(), ttl);
    return b;
  };

  const flash = (el, ok = true) => {
    if (!AF.isConnected(el)) return;
    const b = box(el, ok ? 'ok' : 'err', 1400);
    setTimeout(() => {
      b.style.transition = 'opacity .4s';
      b.style.opacity = '0';
    }, 900);
  };

  /** Ve khung + so thu tu cho tat ca field da quet (giong "Inspect" cua DevTools). */
  const highlightFields = (fields) => {
    ensure();
    clearLayer();
    fields.forEach((f, i) => {
      const el = AF.registry.get(f.id);
      if (!el || !AF.isConnected(el)) return;
      const r = AF.rectOf(el);
      if (r.width <= 0 || r.height <= 0) return;
      const b = document.createElement('div');
      b.className = 'box idx';
      place(b, r);
      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = `${i + 1} ${f.kind}`;
      badge.style.left = `${r.left}px`;
      badge.style.top = `${r.top}px`;
      layer.append(b, badge);
    });
  };

  const scrollTo = (id) => {
    const el = AF.registry.get(id);
    if (!el) return false;
    AF.scrollIntoView(el);
    setTimeout(() => flash(el, true), 120);
    return true;
  };

  /* --------------------------------------------------------------- picker */

  const deepTarget = (e) => {
    const path = e.composedPath ? e.composedPath() : [];
    return path[0] || e.target;
  };

  const describeQuick = (el) => {
    const kind = el.tagName.toLowerCase() + (el.type ? `[${el.type}]` : '');
    const name = AF.accessibleName(el);
    return { kind, name, selector: AF.cssPath(el) };
  };

  let hoverBox = null;

  const onMove = (e) => {
    const el = deepTarget(e);
    if (!el || el.nodeType !== 1) return;
    ensure();
    if (!hoverBox) {
      hoverBox = document.createElement('div');
      hoverBox.className = 'box';
      layer.appendChild(hoverBox);
    }
    place(hoverBox, AF.rectOf(el));
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'tip';
      root.appendChild(tip);
    }
    const d = describeQuick(el);
    tip.innerHTML = `<b>${d.kind}</b>${d.name ? ' — ' + escapeHtml(d.name) : ''}<br><code>${escapeHtml(d.selector)}</code>`;
    const r = AF.rectOf(el);
    tip.style.left = `${Math.min(r.left, innerWidth - 400)}px`;
    tip.style.top = `${r.bottom + 6 > innerHeight - 60 ? r.top - 60 : r.bottom + 6}px`;
  };

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const onClick = (e) => {
    if (!picking) return;
    e.preventDefault();
    e.stopPropagation();
    const el = deepTarget(e);
    stopPick();
    const id = AF.idFor(el);
    const info = {
      id,
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      role: AF.roleOf(el) || '',
      label: AF.accessibleName(el),
      selector: AF.cssPath(el),
      locator: { afId: id },
      suggestedLocator: suggestLocator(el),
    };
    if (onPick) onPick(info);
  };

  const onKey = (e) => {
    if (picking && e.key === 'Escape') {
      e.preventDefault();
      stopPick();
      if (onPick) onPick(null);
    }
  };

  /** Goi y locator ben vung nhat cho element (uu tien testid > role+name > label). */
  const suggestLocator = (el) => {
    const testId =
      el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy') || el.getAttribute('data-qa');
    if (testId) return { testId };
    const role = AF.roleOf(el);
    const name = AF.accessibleName(el);
    if (role && name) return { role, name, exact: false };
    const ph = el.getAttribute('placeholder');
    if (ph) return { placeholder: ph };
    if (name) return { label: name };
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return { css: `#${el.id}` };
    return { css: AF.cssPath(el) };
  };

  let hintEl = null;

  const startPick = (cb) => {
    ensure();
    clearLayer();
    hoverBox = null;
    picking = true;
    onPick = cb;
    hintEl = document.createElement('div');
    hintEl.className = 'hint';
    hintEl.textContent = 'Chon 1 element — nhan Esc de huy';
    root.appendChild(hintEl);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  };

  const stopPick = () => {
    picking = false;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    if (hintEl) hintEl.remove();
    if (tip) tip.remove();
    tip = null;
    clearLayer();
    hoverBox = null;
  };

  AF.Picker = {
    ensure,
    clear: clearLayer,
    box,
    flash,
    highlightFields,
    scrollTo,
    startPick,
    stopPick,
    suggestLocator,
    get picking() {
      return picking;
    },
  };

  addEventListener('scroll', () => picking && clearLayer(), true);
})();
