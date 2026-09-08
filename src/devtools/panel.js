/* AI Autofill Studio — devtools/panel.js
 * Inspector kieu Playwright chay ben trong Chrome DevTools.
 */
const $ = (s) => document.querySelector(s);
const tabId = chrome.devtools.inspectedWindow.tabId;
const send = (msg) => chrome.runtime.sendMessage({ ...msg, tabId });

const state = { fields: [], target: null, filter: '' };

/* ------------------------------------------------------- parse locator DSL */

function parseLocator(input) {
  const s = (input || '').trim();
  if (!s) return null;
  if (s.startsWith('{')) {
    try {
      return JSON.parse(s);
    } catch {
      return { css: s };
    }
  }
  if (s.startsWith('//') || s.startsWith('(//')) return { xpath: s };

  const out = {};
  let any = false;
  for (const part of s.split('|')) {
    const m = part.match(/^\s*(role|name|label|placeholder|text|testid|test-id|css|xpath|nth|value)\s*=\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase();
    let v = m[2].trim().replace(/^["']|["']$/g, '');
    if (k === 'testid' || k === 'test-id') out.testId = v;
    else if (k === 'nth') out.nth = Number(v);
    else out[k] = v;
    any = true;
  }
  return any ? out : { css: s };
}

/* --------------------------------------------------------------- render */

function renderRows() {
  const tb = $('#d-rows');
  tb.innerHTML = '';
  const q = state.filter.toLowerCase();
  const list = state.fields.filter(
    (f) => !q || `${f.label} ${f.name} ${f.kind} ${f.selector}`.toLowerCase().includes(q)
  );
  $('#d-count').textContent = `${state.fields.length} field`;

  list.forEach((f, i) => {
    const tr = document.createElement('tr');
    const opts = f.options?.length ? f.options.map((o) => o.label || o.value).slice(0, 4).join(', ') + (f.options.length > 4 ? '…' : '') : '';
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><span class="badge">${f.kind}</span></td>
      <td>${escapeHtml(f.label || '')}${f.required ? ' <b style="color:var(--err)">*</b>' : ''}</td>
      <td class="mono">${escapeHtml(f.name || '')}</td>
      <td class="mono">${escapeHtml(opts)}</td>
      <td class="mono" style="opacity:.7">${escapeHtml(f.selector || '')}</td>`;
    tr.onclick = () => {
      state.target = { afId: f.id, frameId: f.frameId, kind: f.kind, label: f.label };
      $('#d-target').textContent = `${f.kind} · ${f.label || f.name} · id=${f.id} · frame=${f.frameId}`;
      send({ type: 'AF_SCROLL_TO', frameId: f.frameId, id: f.id });
    };
    tb.appendChild(tr);
  });
}

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* --------------------------------------------------------------- actions */

$('#d-scan').onclick = async () => {
  $('#d-scan').disabled = true;
  try {
    const r = await send({ type: 'AF_SCAN_TAB', deep: true });
    state.fields = r.fields || [];
    renderRows();
  } finally {
    $('#d-scan').disabled = false;
  }
};

$('#d-highlight').onclick = () => send({ type: 'AF_HIGHLIGHT_TAB', fields: state.fields });
$('#d-clear').onclick = () => send({ type: 'AF_CLEAR_TAB' });

$('#d-pick').onclick = async () => {
  const r = await send({ type: 'AF_PICK_TAB' });
  if (!r?.picked) return;
  const p = r.picked;
  state.target = { afId: p.id, frameId: 0, kind: p.role, label: p.label };
  $('#d-target').textContent = `${p.tag} · ${p.label} · ${p.selector}`;
  $('#d-loc').value = Object.entries(p.suggestedLocator)
    .map(([k, v]) => `${k}=${v}`)
    .join('|');
};

$('#d-resolve').onclick = async () => {
  const loc = parseLocator($('#d-loc').value);
  const box = $('#d-locres');
  if (!loc) {
    box.textContent = 'Locator rong.';
    return;
  }
  const r = await send({ type: 'AF_RESOLVE', frameId: state.target?.frameId ?? 0, locator: loc });
  if (!r || r.ok === false) {
    box.className = 'res err';
    box.textContent = 'Loi: ' + (r?.error || 'khong phan hoi');
    return;
  }
  box.className = 'res ' + (r.count === 1 ? 'ok' : r.count === 0 ? 'err' : '');
  box.innerHTML =
    `<b>${r.count}</b> ket qua` +
    (r.matches || [])
      .map(
        (m, i) =>
          `<div class="mono" style="margin-top:4px">${i}: &lt;${m.tag}&gt; ${escapeHtml(m.label || '')} ` +
          `${m.visible ? '' : '[an]'}${m.enabled ? '' : '[disabled]'}<br>${escapeHtml(m.selector)}</div>`
      )
      .join('');
  if (r.matches?.[0]) {
    state.target = { afId: r.matches[0].id, frameId: state.target?.frameId ?? 0, label: r.matches[0].label };
    $('#d-target').textContent = `${r.matches[0].tag} · ${r.matches[0].label} · id=${r.matches[0].id}`;
    send({ type: 'AF_SCROLL_TO', frameId: state.target.frameId, id: r.matches[0].id });
  }
};

$('#d-run').onclick = async () => {
  const box = $('#d-runres');
  if (!state.target) {
    box.className = 'res err';
    box.textContent = 'Chua chon muc tieu.';
    return;
  }
  const action = $('#d-action').value;
  let value = $('#d-value').value;
  if (action === 'check') value = !/^(false|0|no|khong)$/i.test(value.trim());
  else if (action === 'upload') value = value.split('|').map((n) => ({ name: n.trim() })).filter((x) => x.name);
  else if (/select/.test(action) && value.includes('|')) value = value.split('|').map((x) => x.trim());

  const step = { afId: state.target.afId, action, value, kind: state.target.kind };
  const r = await send({ type: 'AF_STEP_ONE', frameId: state.target.frameId ?? 0, step });
  const res = r?.result || r;
  box.className = 'res ' + (res?.ok ? 'ok' : 'err');
  box.textContent = res?.ok
    ? `OK — ${res.action} (${res.ms}ms)${res.filled != null ? ` · ${res.filled} gia tri` : ''}`
    : `That bai: ${res?.error || 'khong ro'}`;
};

$('#d-filter').oninput = (e) => {
  state.filter = e.target.value;
  renderRows();
};

// Tu quet khi mo panel va khi trang dieu huong
$('#d-scan').click();
chrome.devtools.network.onNavigated.addListener(() => {
  state.fields = [];
  renderRows();
  setTimeout(() => $('#d-scan').click(), 800);
});
