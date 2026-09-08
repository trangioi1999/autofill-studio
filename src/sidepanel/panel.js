/* Autofill Studio — sidepanel/panel.js
 * Panel duoc dung nhu mot dong hoat dong cua agent: moi buoc (quet -> hoi AI ->
 * dien) la mot muc tren duong ray, co trang thai va thoi gian rieng.
 */

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const state = {
  tabId: null,
  url: '',
  settings: null,
  fields: [],
  steps: [],
  skipped: [],
  results: [],
  snapshots: [],
  allSnapshots: [],
  planSource: 'ai',
  filter: '',
  busy: false,
};

const send = (msg) => chrome.runtime.sendMessage({ ...msg, tabId: msg.tabId ?? state.tabId });

function setBusy(on) {
  state.busy = on;
  document.body.classList.toggle('busy', on);
  $('#btn-run').disabled = on;
  $('#btn-scan').disabled = on;
}

/* ------------------------------------------------------------------ stream */

let openEv = null;

function finishEv(kind = 'ok', mark = '✓') {
  if (!openEv) return;
  openEv.classList.remove('run');
  openEv.classList.add(kind);
  const dot = openEv.querySelector('.dot');
  if (dot) dot.textContent = mark;
  openEv = null;
}

/**
 * Them mot buoc vao dong hoat dong.
 * kind: 'run' (dang chay, se tu dong dong khi buoc sau xuat hien) | 'ok' | 'err' | 'idle'
 */
function ev(text, { kind = 'run', detail = '', ms = null, card = null } = {}) {
  finishEv();
  $('#run-empty').classList.add('hide');

  const node = el('div', `ev ${kind}`);
  const dot = el('span', 'dot', kind === 'ok' ? '✓' : kind === 'err' ? '✕' : '');
  const head = el('div', 'head');
  head.append(el('span', 'txt', text));
  if (ms != null) head.append(el('span', 'ms', `${ms}ms`));
  node.append(dot, head);
  if (detail) node.append(el('div', 'detail', detail));
  if (card) node.append(card);

  $('#stream').append(node);
  // chi cuon khi nguoi dung dang thuc su nhin tab Hoat dong
  if (!$('#view-run').classList.contains('hide')) node.scrollIntoView({ block: 'nearest' });
  if (kind === 'run') openEv = node;
  return node;
}

/**
 * Hop nhap lieu nho ngay trong panel. Dung thay window.prompt vi prompt chan
 * toan bo luong su kien va trong rat lac long giua giao dien nay.
 */
function askInline(label, value = '') {
  return new Promise((resolve) => {
    document.querySelectorAll('.ask').forEach((n) => n.remove());
    const wrap = el('div', 'ask');
    const box = el('div', 'ask-box');
    box.append(el('div', 'ask-label', label));
    const input = el('input', 'ask-input');
    input.value = value;
    const row = el('div', 'ask-row');
    const done = (v) => {
      wrap.remove();
      resolve(v);
    };
    row.append(
      btn('Huy', () => done(null), 'btn'),
      btn('Xong', () => done(input.value), 'btn primary grow')
    );
    box.append(input, row);
    wrap.append(box);
    wrap.onclick = (e) => {
      if (e.target === wrap) done(null);
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(input.value);
      if (e.key === 'Escape') done(null);
    };
    document.body.append(wrap);
    input.focus();
    input.select();
  });
}

let toastTimer;
function toast(msg, kind = 'info') {
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  const t = el('div', `toast ${kind}`, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3400);
}

/* -------------------------------------------------------------------- init */

async function init() {
  await pickTab();
  state.settings = await send({ type: 'AF_GET_SETTINGS' });
  $('#prompt').value = state.settings.lastPrompt || '';
  autoGrow();
  renderProvider();
  renderMode();
  await refreshMemory();
}

async function pickTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabId = tab?.id ?? null;
  state.url = tab?.url || '';
  renderScreen(tab);
}

function renderScreen(tab) {
  let label = '—';
  try {
    const u = new URL(tab?.url || state.url);
    label = u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    label = tab?.title || '—';
  }
  $('#screen').textContent = label;
  $('#screen').title = tab?.url || '';
}

function renderProvider() {
  const map = {
    gemini: 'Gemini',
    anthropic: 'Claude',
    openai: 'OpenAI-compat',
    chromeai: 'Chrome AI',
    bridge: 'Local Bridge',
  };
  const p = state.settings.provider;
  const cfg = state.settings[p] || {};
  const needsKey = ['gemini', 'anthropic', 'openai'].includes(p);
  const missing = needsKey && !cfg.apiKey && cfg.auth !== 'oauth';

  const chip = $('#provider');
  chip.textContent = missing ? `${map[p] || p} · chua co key` : map[p] || p;
  chip.classList.toggle('warn', missing);
  chip.title = missing ? 'Chua cau hinh API key — mo Cai dat' : `${map[p] || p} · ${cfg.model || ''}`;
}

function renderMode() {
  const on = !!state.settings.cdpMode;
  $('#btn-mode').textContent = on ? 'CDP' : 'DOM';
  $('#btn-mode').classList.toggle('on', on);
  $('#btn-mode').title = on
    ? 'CDP: gui event trusted qua chrome.debugger (Chrome hien thanh vang). Bam de tat.'
    : 'DOM: nhanh, khong thanh vang. Bam de doi sang CDP.';
}

/* ------------------------------------------------------------------ fields */

const kindLabel = {
  text: 'text', textarea: 'textarea', number: 'number', date: 'date', editor: 'rich-text',
  select: 'select', multiselect: 'multi', combobox: 'dropdown', 'multiselect-custom': 'multi-dropdown',
  checkbox: 'checkbox', 'checkbox-custom': 'checkbox', toggle: 'toggle',
  radio: 'radio', radiogroup: 'radio', file: 'file', range: 'range', color: 'color', datepicker: 'date',
};

function renderFields() {
  const box = $('#fields');
  box.textContent = '';
  const q = state.filter.toLowerCase();
  const list = state.fields.filter(
    (f) => !q || `${f.label} ${f.name} ${f.kind} ${f.section}`.toLowerCase().includes(q)
  );
  $('#c-fields').textContent = state.fields.length;
  $('#fields-empty').classList.toggle('hide', list.length > 0);

  let lastSection = null;
  for (const f of list) {
    if (f.section && f.section !== lastSection) {
      lastSection = f.section;
      const h = el('div', 'lbl mt', f.section);
      box.append(h);
    }
    const item = el('div', 'item' + (f.disabled ? ' skip' : ''));
    const top = el('div', 'top');
    top.append(
      el('span', 'kind', kindLabel[f.kind] || f.kind),
      el('span', 'name', f.label || f.name || f.placeholder || '(khong nhan)')
    );
    if (f.required) top.append(el('span', 'req', '*'));
    item.append(top);

    const bits = [];
    if (f.name) bits.push(`name=${f.name}`);
    if (f.currentValue) bits.push(`hien tai: ${f.currentValue.slice(0, 40)}`);
    if (f.options?.length) bits.push(`${f.options.length} lua chon`);
    if (f.frameId) bits.push(`iframe#${f.frameId}`);
    if (f.inShadow) bits.push('shadow-dom');
    if (bits.length) item.append(el('div', 'meta', bits.join(' · ')));
    item.append(el('div', 'sel', f.selector));

    const acts = el('div', 'acts');
    acts.append(
      btn('Xem', () => send({ type: 'AF_SCROLL_TO', frameId: f.frameId, id: f.id })),
      btn('Dien thu', async () => {
        const v = await askInline(`Gia tri cho "${f.label || f.name}"`);
        if (v == null) return;
        const r = await send({
          type: 'AF_STEP_ONE',
          frameId: f.frameId,
          step: { afId: f.id, action: 'fill', kind: f.kind, value: v },
        });
        const ok = r?.result?.ok;
        toast(ok ? `Da dien "${f.label || f.name}"` : `That bai: ${r?.result?.error || ''}`, ok ? 'ok' : 'err');
      })
    );
    item.append(acts);
    box.append(item);
  }
}

const btn = (label, onClick, cls = 'btn tiny') => {
  const b = el('button', cls, label);
  b.onclick = onClick;
  return b;
};

/* -------------------------------------------------------------------- plan */

function renderPlan() {
  const box = $('#plan');
  box.textContent = '';
  $('#c-plan').textContent = state.steps.length;
  $('#plan-empty').classList.toggle('hide', state.steps.length > 0);

  const head = $('#plan-head');
  head.textContent = '';
  head.classList.toggle('hide', !state.steps.length);
  if (state.steps.length) {
    const done = state.results.length;
    const ok = state.results.filter((r) => r.ok).length;
    head.append(
      el(
        'div',
        '',
        state.planSource === 'memory'
          ? `${state.steps.length} buoc lay tu bo nho man hinh (khong goi AI).`
          : `${state.steps.length} buoc do AI de xuat. Sua truc tiep truoc khi ap dung neu can.`
      )
    );
    if (done) head.append(el('div', 'meta', `Da chay: ${ok}/${done} thanh cong.`));
    const row = el('div', 'row');
    row.append(
      btn('Ap dung ke hoach', applyPlan, 'btn primary grow'),
      btn('Copy JSON', async () => {
        await navigator.clipboard.writeText(JSON.stringify(state.steps, null, 2));
        toast('Da copy JSON', 'ok');
      })
    );
    head.append(row);
  }

  state.steps.forEach((s, i) => {
    const res = state.results.find((r) => r.step === s || (r.step && r.step.afId === s.afId));
    const item = el('div', 'item' + (res ? (res.ok ? ' ok' : ' err') : ''));
    const top = el('div', 'top');
    top.append(el('span', 'kind', s.action), el('span', 'name', s.label || s.afId));
    if (res) top.append(el('span', `state ${res.ok ? 'ok' : 'err'}`, res.ok ? '✓' : '✕'));
    item.append(top);

    const inp = el('input', 'val');
    inp.type = 'text';
    inp.value = Array.isArray(s.value)
      ? s.value.map((v) => (typeof v === 'string' ? v : v.name)).join(' | ')
      : typeof s.value === 'boolean'
      ? String(s.value)
      : String(s.value ?? '');
    inp.oninput = () => {
      const raw = inp.value;
      if (s.multiple) s.value = raw.split('|').map((x) => x.trim()).filter(Boolean);
      else if (s.action === 'check') s.value = !/^(false|0|no|khong)$/i.test(raw.trim());
      else if (s.action === 'upload') s.value = raw.split('|').map((n) => ({ name: n.trim() }));
      else s.value = raw;
    };
    item.append(inp);

    if (s.note) item.append(el('div', 'meta', s.note));
    if (res && !res.ok) item.append(el('div', 'meta', 'Loi: ' + (res.error || '')));

    const acts = el('div', 'acts');
    acts.append(
      btn('Xem', () => send({ type: 'AF_SCROLL_TO', frameId: s.frameId, id: s.afId })),
      btn('Chay buoc nay', async () => {
        const r = await send({ type: 'AF_STEP_ONE', frameId: s.frameId, step: s });
        const ok = r?.result?.ok;
        item.classList.toggle('ok', !!ok);
        item.classList.toggle('err', !ok);
        if (!ok) toast(r?.result?.error || 'That bai', 'err');
      }),
      btn('Bo', () => {
        state.steps.splice(i, 1);
        renderPlan();
      }, 'btn tiny danger')
    );
    item.append(acts);
    box.append(item);
  });

  if (state.skipped.length) {
    box.append(el('div', 'lbl mt', `Bo qua (${state.skipped.length})`));
    for (const s of state.skipped) {
      const f = state.fields.find((x) => (x.gid || x.id) === s.id);
      const it = el('div', 'item skip');
      it.append(el('div', 'name', f?.label || s.id), el('div', 'meta', s.reason));
      box.append(it);
    }
  }
}

async function applyPlan() {
  setBusy(true);
  ev(`Ap dung ${state.steps.length} buoc...`);
  try {
    const results = await send({ type: 'AF_RUN_PLAN', steps: state.steps });
    state.results = Array.isArray(results) ? results : [];
    renderPlan();
    const ok = state.results.filter((r) => r.ok).length;
    finishEv(ok === state.results.length ? 'ok' : 'err');
    ev(`Xong: ${ok}/${state.results.length} o thanh cong.`, { kind: ok === state.results.length ? 'ok' : 'err' });
    toast(`${ok}/${state.results.length} o`, ok === state.results.length ? 'ok' : 'err');
  } catch (e) {
    finishEv('err', '✕');
    ev('Loi khi ap dung: ' + e.message, { kind: 'err' });
    toast(e.message, 'err');
  } finally {
    setBusy(false);
  }
}

/* ------------------------------------------------------------------ memory */

async function refreshMemory() {
  const r = await send({ type: 'AF_MEM_FOR_TAB' });
  state.snapshots = r?.snapshots || [];
  state.allSnapshots = (await send({ type: 'AF_MEM_LIST' })) || [];
  $('#c-mem').textContent = state.snapshots.length || state.allSnapshots.length;
  renderRecall();
  renderMemory();
}

function renderRecall() {
  const box = $('#recall');
  box.textContent = '';
  const snap = state.snapshots[0];
  if (!snap || !state.settings?.autoSuggestSnapshot) {
    box.classList.add('hide');
    return;
  }
  box.classList.remove('hide');
  box.append(
    el('div', 'rt', 'Man hinh nay da tung duoc dien'),
    el('div', 'rs', `"${snap.name}" · ${snap.entries.length} o · luu ${when(snap.usedAt || snap.at)}`)
  );
  const row = el('div', 'row');
  row.append(
    btn('Dien ngay tu bo nho', () => applySnapshot(snap.id), 'btn primary grow'),
    btn('Xem', () => switchView('memory'))
  );
  box.append(row);
}

function when(ts) {
  if (!ts) return '';
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'vua xong';
  if (d < 3600) return `${Math.floor(d / 60)} phut truoc`;
  if (d < 86400) return `${Math.floor(d / 3600)} gio truoc`;
  return `${Math.floor(d / 86400)} ngay truoc`;
}

function snapshotCard(s, mine) {
  const item = el('div', 'item');
  const top = el('div', 'top');
  top.append(el('span', 'kind', mine ? 'man hinh nay' : 'khac'), el('span', 'name', s.name));
  item.append(top);
  item.append(
    el('div', 'meta', `${s.entries.length} o · ${when(s.usedAt || s.at)}${s.uses ? ` · dung ${s.uses} lan` : ''}`)
  );
  if (!mine) item.append(el('div', 'sel', s.key));
  const preview = s.entries.slice(0, 3).map((e) => `${e.label}: ${e.value}`.slice(0, 44)).join(' · ');
  if (preview) item.append(el('div', 'meta', preview + (s.entries.length > 3 ? ' …' : '')));

  const acts = el('div', 'acts');
  acts.append(
    btn('Dien', () => applySnapshot(s.id), 'btn tiny primary'),
    btn('Xem truoc', () => previewSnapshot(s.id)),
    btn('Doi ten', async () => {
      const name = await askInline('Ten moi cho ban luu', s.name);
      if (name == null) return;
      await send({ type: 'AF_MEM_RENAME', id: s.id, name });
      await refreshMemory();
    }),
    btn('Xoa', async () => {
      await send({ type: 'AF_MEM_DELETE', id: s.id });
      toast('Da xoa ban luu', 'ok');
      await refreshMemory();
    }, 'btn tiny danger')
  );
  item.append(acts);
  return item;
}

function renderMemory() {
  const mine = $('#mem-this');
  const other = $('#mem-other');
  mine.textContent = '';
  other.textContent = '';

  for (const s of state.snapshots) mine.append(snapshotCard(s, true));
  const otherList = state.allSnapshots.filter((s) => !state.snapshots.some((x) => x.id === s.id));
  for (const s of otherList.slice(0, 40)) other.append(snapshotCard(s, false));

  $('#mem-other-lbl').classList.toggle('hide', !otherList.length);
  $('#mem-empty').classList.toggle('hide', state.allSnapshots.length > 0);
}

async function applySnapshot(id) {
  switchView('run');
  setBusy(true);
  ev('Dang doi chieu bo nho voi form tren trang...');
  try {
    const r = await send({ type: 'AF_MEM_APPLY', id });
    if (r?.error) throw new Error(r.error);
    await refreshMemory();
    if (!r.matched) toast('Khong ghep duoc o nao — form co the da doi', 'err');
  } catch (e) {
    finishEv('err', '✕');
    ev('Loi: ' + e.message, { kind: 'err' });
    toast(e.message, 'err');
  } finally {
    setBusy(false);
  }
}

async function previewSnapshot(id) {
  setBusy(true);
  try {
    const r = await send({ type: 'AF_MEM_PLAN', id });
    if (r?.error) throw new Error(r.error);
    state.fields = r.fields || [];
    state.steps = r.steps || [];
    state.skipped = r.missing || [];
    state.results = [];
    state.planSource = 'memory';
    renderFields();
    renderPlan();
    switchView('plan');
    toast(`Ghep duoc ${r.matched} o`, r.matched ? 'ok' : 'err');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setBusy(false);
  }
}

/* ------------------------------------------------------- su kien tu background */

chrome.runtime.onMessage.addListener((m) => {
  if (m?.type !== 'AF_EVENT') return;

  if (m.phase === 'scan') ev(m.message || 'Dang quet...');

  if (m.phase === 'scanned') {
    state.fields = m.fields || [];
    renderFields();
    finishEv();
    ev(`Tim thay ${m.count} o tren ${m.frames} frame`, { kind: 'ok' });
  }

  if (m.phase === 'generate') ev(m.message || 'Dang hoi AI...');

  if (m.phase === 'planned') {
    state.steps = m.steps || [];
    state.skipped = m.skipped || [];
    state.results = [];
    state.planSource = m.source === 'memory' ? 'memory' : 'ai';
    renderPlan();
    finishEv();

    const card = el('div', 'card');
    card.append(
      el(
        'div',
        '',
        state.planSource === 'memory'
          ? `Ghep tu ban luu "${m.snapshot?.name || ''}"`
          : `AI de xuat gia tri cho ${state.steps.length} o`
      )
    );
    if (state.skipped.length) card.append(el('div', 'meta', `Bo qua ${state.skipped.length} o`));
    const row = el('div', 'row');
    row.append(btn('Xem ke hoach', () => switchView('plan')));
    card.append(row);

    ev(
      state.planSource === 'memory'
        ? `Lay ${state.steps.length} gia tri tu bo nho`
        : `AI tra ve ${state.steps.length} buoc`,
      { kind: 'ok', ms: m.ms || null, card }
    );
  }

  if (m.phase === 'run') ev(m.message || 'Dang dien...');

  if (m.phase === 'done') {
    state.results = m.results || [];
    renderPlan();
    finishEv();
    const all = m.ok === m.total && m.total > 0;
    const fails = state.results.filter((x) => !x.ok);
    ev(`Dien xong ${m.ok}/${m.total} o`, {
      kind: m.total === 0 ? 'err' : all ? 'ok' : 'err',
      detail: fails.length
        ? fails.slice(0, 6).map((r) => `✕ ${r.step?.label || ''} — ${r.error || ''}`).join('\n')
        : '',
    });
    toast(`${m.ok}/${m.total} o`, all ? 'ok' : 'err');
  }

  if (m.phase === 'saved') {
    ev(`Da ghi nho man hinh nay (${m.snapshot?.count || 0} o)`, { kind: 'ok' });
    refreshMemory();
  }
});

/* ---------------------------------------------------------------------- UI */

function switchView(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hide', v.id !== `view-${name}`));
}
document.querySelectorAll('.tabs button').forEach((b) => {
  b.onclick = () => switchView(b.dataset.view);
});

function autoGrow() {
  const t = $('#prompt');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 132) + 'px';
}
$('#prompt').addEventListener('input', autoGrow);
$('#prompt').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    $('#btn-run').click();
  }
});

$('#btn-run').onclick = async () => {
  const request = $('#prompt').value.trim();
  switchView('run');
  setBusy(true);
  ev(request ? `Yeu cau: ${request}` : 'Dien toan bo form bang du lieu hop ly', { kind: 'idle' });
  try {
    const r = await send({ type: 'AF_AUTOFILL', request });
    if (r?.error) throw new Error(r.error);
  } catch (e) {
    finishEv('err', '✕');
    ev('Loi: ' + e.message, { kind: 'err' });
    toast(e.message, 'err');
  } finally {
    setBusy(false);
  }
};

$('#btn-scan').onclick = async () => {
  switchView('fields');
  setBusy(true);
  ev('Dang quet trang...');
  try {
    const r = await send({ type: 'AF_SCAN_TAB', deep: state.settings.deepScan });
    if (r?.error) throw new Error(r.error);
    state.fields = r.fields || [];
    renderFields();
    finishEv();
    ev(`Tim thay ${state.fields.length} o tren ${r.frames} frame`, { kind: 'ok' });
    toast(`${state.fields.length} o nhap lieu`, 'ok');
  } catch (e) {
    finishEv('err', '✕');
    ev('Quet loi: ' + e.message, { kind: 'err' });
    toast(e.message, 'err');
  } finally {
    setBusy(false);
  }
};

$('#btn-highlight').onclick = async () => {
  if (!state.fields.length) {
    const r = await send({ type: 'AF_SCAN_TAB', deep: false });
    state.fields = r.fields || [];
    renderFields();
  }
  await send({ type: 'AF_HIGHLIGHT_TAB', fields: state.fields });
  toast('Da danh dau field tren trang', 'info');
};

$('#btn-clear').onclick = () => {
  send({ type: 'AF_CLEAR_TAB' });
  $('#picked').classList.add('hide');
};

$('#btn-pick').onclick = async () => {
  toast('Di chuot len trang roi click element muon chon', 'info');
  const r = await send({ type: 'AF_PICK_TAB' });
  const p = r?.picked;
  const box = $('#picked');
  if (!p) {
    box.classList.add('hide');
    return;
  }
  box.classList.remove('hide');
  box.textContent = '';
  box.append(
    el('div', '', `${p.tag}${p.type ? `[${p.type}]` : ''}${p.label ? ` — ${p.label}` : ''}`),
    Object.assign(el('code'), { textContent: JSON.stringify(p.suggestedLocator) }),
    el('div', 'sel', p.selector)
  );
  ev(`Da chon element: ${p.tag} — ${p.label || ''}`, { kind: 'ok', detail: p.selector });
};

$('#btn-mode').onclick = async () => {
  const next = !state.settings.cdpMode;
  state.settings = await send({ type: 'AF_SET_SETTINGS', patch: { cdpMode: next } });
  renderMode();
  if (next) {
    const r = await send({ type: 'AF_CDP_ATTACH' });
    ev(r?.ok ? 'Da gan chrome.debugger — che do CDP' : 'Khong gan duoc debugger: ' + (r?.error || ''), {
      kind: r?.ok ? 'ok' : 'err',
    });
  } else {
    await send({ type: 'AF_CDP_DETACH' });
    ev('Da go debugger — quay ve che do DOM', { kind: 'ok' });
  }
};

$('#btn-mem-save').onclick = async () => {
  const name = await askInline('Ten cho ban luu nay', '');
  if (name == null) return;
  setBusy(true);
  try {
    const r = await send({ type: 'AF_MEM_SAVE', name });
    if (r?.error) throw new Error(r.error);
    toast(`Da luu "${r.name}" — ${r.entries.length} o`, 'ok');
    await refreshMemory();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setBusy(false);
  }
};

$('#btn-mem-refresh').onclick = refreshMemory;
$('#btn-settings').onclick = () => chrome.runtime.openOptionsPage();
$('#q').oninput = (e) => {
  state.filter = e.target.value;
  renderFields();
};

/* Panel song lau hon tab: doi tab thi phai doc lai ngu canh */
chrome.tabs.onActivated.addListener(async () => {
  await pickTab();
  state.fields = [];
  state.steps = [];
  state.results = [];
  renderFields();
  renderPlan();
  await refreshMemory();
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (tabId !== state.tabId || info.status !== 'complete') return;
  await pickTab();
  await refreshMemory();
});

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  state.settings = await send({ type: 'AF_GET_SETTINGS' });
  renderProvider();
  renderMode();
});

init();
