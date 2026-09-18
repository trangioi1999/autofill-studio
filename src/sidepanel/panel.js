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
  setup: null, // ket qua AF_SETUP_STATUS: provider da san sang chua
  mode: 'fill', // 'fill' = quet & dien mot phat · 'agent' = vong lap dieu khien
  agentRunning: false,
  usage: { input: 0, output: 0, total: 0, calls: 0 },
};

const send = (msg) => chrome.runtime.sendMessage({ ...msg, tabId: msg.tabId ?? state.tabId });

/** 1234 -> "1.2k". Giong lib/usage.js nhung panel khong import module duoc. */
const fmtTok = (n) => {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
};

/** Cong don token cua ca phien, hien o thanh soan. */
function addUsage(u) {
  if (!u || !u.total) return;
  const s = state.usage;
  s.input += u.input || 0;
  s.output += u.output || 0;
  s.total += u.total || 0;
  s.calls += 1;
  renderUsage();
}

function renderUsage() {
  const chip = $('#usage');
  const u = state.usage;
  chip.classList.toggle('hide', !u.total);
  if (!u.total) return;
  chip.textContent = '';
  chip.append(
    document.createTextNode('phien nay: '),
    el('b', '', fmtTok(u.total)),
    document.createTextNode(` tok · ${u.calls} lan goi`)
  );
  chip.title = `Vao ${fmtTok(u.input)} · ra ${fmtTok(u.output)} · ${u.calls} lan goi model trong phien nay`;
}

function setBusy(on) {
  state.busy = on;
  document.body.classList.toggle('busy', on);
  $('#btn-run').disabled = on;
  $('#btn-scan').disabled = on;
}

/** Khung xuong nhap nhay khi dang quet — de nguoi dung thay no dang lam viec. */
function setScanning(on) {
  $('#fields-skel').classList.toggle('hide', !on);
  if (on) $('#fields-empty').classList.add('hide');
}

function setAgentRunning(on) {
  state.agentRunning = on;
  $('#btn-stop').classList.toggle('hide', !on);
  $('#btn-run').classList.toggle('hide', on);
}

/* ------------------------------------------------------------------ stream */

let openEv = null;

function finishEv(kind = 'ok', mark = '✓') {
  if (!openEv) return;
  openEv.classList.remove('run');
  openEv.classList.add(kind);
  openEv.querySelector('.dots')?.remove();
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
  const txt = el('span', 'txt', text);
  if (kind === 'run') {
    const dots = el('span', 'dots');
    dots.append(el('i'), el('i'), el('i'));
    txt.append(dots);
  }
  head.append(txt);
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

/** Mot dong tool call trong the cua luot agent. */
function callRow(a) {
  const row = el('div', `call ${a.ok ? 'ok' : 'err'}`);
  const arg = [a.target, a.value != null && a.value !== '' ? `"${a.value}"` : '']
    .filter(Boolean)
    .join(' ');
  row.append(el('span', 't', a.tool));
  if (a.source) row.append(el('span', `src ${a.source}`, SRC_LABEL[a.source] || a.source));
  row.append(
    el('span', 'a', a.error ? `${arg} — ${a.error}` : a.note ? `${arg} ${a.note}`.trim() : arg),
    el('span', 's', a.ok ? '✓' : '✕')
  );
  return row;
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
  $('#profile').value = state.settings.persona || '';
  autoGrow();
  renderProvider();
  renderMode();
  await refreshMemory();
  await refreshSetup();
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

const PROVIDER_LABEL = {
  gemini: 'Gemini',
  anthropic: 'Claude API',
  openai: 'OpenAI-compat',
  chromeai: 'Chrome AI',
  bridge: 'Bridge',
};

function renderProvider() {
  const p = state.settings.provider;
  const cfg = state.settings[p] || {};
  const st = state.setup;
  const chip = $('#provider');

  let label = PROVIDER_LABEL[p] || p;
  if (p === 'bridge') {
    // Hien backend that su: "Bridge · claude" — de biet AI nao dang tra loi
    const chosen = st?.backend || (cfg.model && cfg.model !== 'default' ? cfg.model : '');
    if (chosen) label += ` · ${chosen}`;
  } else if (cfg.model && p !== 'chromeai') label += ` · ${cfg.model}`;

  const bad = st && !st.ready;
  chip.textContent = bad ? `${PROVIDER_LABEL[p] || p} · chua san sang` : label;
  chip.classList.toggle('warn', !!bad);
  chip.title = bad ? st.reason || 'Chua cau hinh — bam de mo Cai dat' : `${label} — bam de mo Cai dat`;
}

/* ------------------------------------------------------------------- setup */

/** Hoi background xem provider da san sang chua; ve the huong dan neu chua. */
async function refreshSetup() {
  state.setup = await send({ type: 'AF_SETUP_STATUS' });
  renderProvider();
  renderSetup();
  return state.setup;
}

function openOptions(provider) {
  const url = chrome.runtime.getURL('src/options/options.html') + (provider ? `?provider=${provider}` : '');
  chrome.tabs.create({ url });
}

async function chooseProvider(provider) {
  state.settings = await send({ type: 'AF_SET_SETTINGS', patch: { provider } });
  const st = await refreshSetup();
  if (st?.ready) toast(`Da chuyen sang ${PROVIDER_LABEL[provider] || provider}`, 'ok');
  return st;
}

function renderSetup() {
  const box = $('#setup');
  const st = state.setup;
  box.textContent = '';
  if (!st || st.ready) {
    box.classList.add('hide');
    return;
  }
  box.classList.remove('hide');
  const p = st.provider;

  box.append(el('div', 'rt', `Chua ket noi duoc AI (${PROVIDER_LABEL[p] || p})`));
  box.append(el('div', 'rs', st.reason || ''));

  // Bridge chua chay: in dung lenh can go
  if (p === 'bridge' && st.bridge?.offline) {
    box.append(el('div', 'rs', 'Mo terminal trong thu muc extension va chay:'));
    box.append(el('div', 'cmd', 'node bridge/server.mjs'));
  }

  const opts = el('div', 'opts');
  const opt = (k, title, desc, onClick) => {
    const b = el('button', 'opt');
    b.append(el('span', 'k', k));
    const t = el('span', '', title);
    t.append(el('span', 'd', desc));
    b.append(t);
    b.onclick = onClick;
    return b;
  };

  if (p !== 'bridge') {
    opts.append(
      opt('Khong key', 'Dung Local Bridge', 'Goi Claude Code / Gemini CLI / Kiro / Ollama da dang nhap tren may', async () => {
        const r = await chooseProvider('bridge');
        if (r && !r.ready) toast('Da chon Bridge — chay "node bridge/server.mjs" roi bam Kiem tra lai', 'info');
      })
    );
  }
  if (p !== 'chromeai') {
    opts.append(
      opt('Offline', 'Dung Chrome AI', 'Gemini Nano chay tren may, mien phi, Chrome 138+', async () => {
        const r = await chooseProvider('chromeai');
        if (r && !r.ready) openOptions('chromeai');
      })
    );
  }
  opts.append(
    opt('API key', 'Dan API key', 'Gemini (mien phi tai AI Studio) · Claude · OpenAI / OpenRouter / DeepSeek', () =>
      openOptions(['gemini', 'anthropic', 'openai'].includes(p) ? p : 'gemini')
    )
  );
  box.append(opts);

  const row = el('div', 'row');
  row.append(
    btn('Kiem tra lai', async () => {
      const r = await refreshSetup();
      toast(r?.ready ? 'Da ket noi' : r?.reason || 'Van chua san sang', r?.ready ? 'ok' : 'err');
    }, 'btn primary grow'),
    btn('Mo Cai dat', () => openOptions(p))
  );
  box.append(row);
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

/** Nhan cho biet gia tri lay tu dau — de nguoi dung khong nham du lieu bia. */
const SRC_LABEL = {
  profile: 'ho so',
  request: 'yeu cau',
  goal: 'muc tieu',
  page: 'tu trang',
  invented: 'AI bia',
  random: 'ngau nhien',
};

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
          : state.planSource === 'random'
          ? `${state.steps.length} buoc du lieu thu (khong goi AI): dropdown chon ngau nhien, so ngau nhien, text theo nhan.`
          : `${state.steps.length} buoc do AI de xuat. Sua truc tiep truoc khi ap dung neu can.`
      )
    );
    if (done) head.append(el('div', 'meta', `Da chay: ${ok}/${done} thanh cong.`));
    const invented = state.steps.filter((x) => x.source === 'invented').length;
    if (invented) {
      const w = el('div', 'meta', `${invented} gia tri do AI tu bia. Dien Ho so cua ban de no dung du lieu that.`);
      w.style.color = 'var(--warn)';
      head.append(w);
    }
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
    if (s.source) top.append(el('span', `src ${s.source}`, SRC_LABEL[s.source] || s.source));
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

/** "Tra loi boi: Bridge -> claude:sonnet" — de biet AI nao vua tra loi. */
function viaLabel(m) {
  const p = PROVIDER_LABEL[m.provider] || m.provider;
  return m.via ? `Tra loi boi: ${p} → ${m.via}` : `Tra loi boi: ${p}`;
}

/* ------------------------------------------------------- su kien tu background */

let currentCalls = null;

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

  if (m.phase === 'tabs') {
    finishEv();
    ev(m.count ? `Thay ${m.count} tab: ${(m.labels || []).join(' · ')}` : m.message || 'Khong co tab', { kind: 'idle' });
  }
  if (m.phase === 'tab') {
    finishEv();
    ev(`Tab ${m.index}/${m.count}: ${m.label}`, { kind: 'idle' });
  }
  if (m.phase === 'tab-done') {
    finishEv();
    if (m.error) ev(`Tab "${m.label}": ${/Khong tim thay field/.test(m.error) ? 'khong co o nhap lieu, bo qua' : m.error}`, { kind: 'idle' });
  }

  if (m.phase === 'pass') {
    finishEv();
    ev(m.message || `Luot ${m.pass}: ${m.count} o vua duoc mo khoa`, { kind: 'idle' });
  }

  if (m.phase === 'planned') {
    const extra = (m.pass || 1) > 1; // luot 2+: noi them, khong thay the ke hoach dau
    state.steps = extra ? state.steps.concat(m.steps || []) : m.steps || [];
    state.skipped = extra ? state.skipped.concat(m.skipped || []) : m.skipped || [];
    if (!extra) state.results = [];
    state.planSource = m.source === 'memory' ? 'memory' : m.source === 'random' ? 'random' : 'ai';
    renderPlan();
    finishEv();

    const card = el('div', 'card');
    card.append(
      el(
        'div',
        '',
        state.planSource === 'memory'
          ? `Ghep tu ban luu "${m.snapshot?.name || ''}"`
          : state.planSource === 'random'
          ? `Sinh du lieu thu cho ${extra ? (m.steps || []).length : state.steps.length} o (khong goi AI)`
          : `AI de xuat gia tri cho ${extra ? (m.steps || []).length : state.steps.length} o`
      )
    );
    if (state.skipped.length) card.append(el('div', 'meta', `Bo qua ${state.skipped.length} o`));
    if (m.randomFilled) card.append(el('div', 'meta', `${m.randomFilled} o co danh sach lua chon AI bo trong / dua sai -> da chon ngau nhien`));
    if (m.skippedFilled) card.append(el('div', 'meta', `Bo qua ${m.skippedFilled} o da co gia tri san`));
    if (state.planSource === 'ai' && m.provider) card.append(el('div', 'meta', viaLabel(m)));
    const row = el('div', 'row');
    row.append(btn('Xem ke hoach', () => switchView('plan')));
    card.append(row);

    if (m.usage) addUsage(m.usage);
    if (m.usage?.total) card.append(el('div', 'meta', `${fmtTok(m.usage.total)} token cho lan goi nay`));

    const n = extra ? (m.steps || []).length : state.steps.length;
    ev(
      state.planSource === 'memory'
        ? `Lay ${n} gia tri tu bo nho`
        : state.planSource === 'random'
        ? `${extra ? `Luot ${m.pass}: ` : ''}Sinh ${n} gia tri thu`
        : `${extra ? `Luot ${m.pass}: ` : ''}AI tra ve ${n} buoc`,
      { kind: 'ok', ms: m.ms || null, card }
    );
  }

  if (m.phase === 'run') ev(m.message || 'Dang dien...');

  if (m.phase === 'done') {
    const extra = (m.pass || 1) > 1;
    state.results = extra ? state.results.concat(m.results || []) : m.results || [];
    renderPlan();
    finishEv();
    const all = m.ok === m.total && m.total > 0;
    const fails = (m.results || []).filter((x) => !x.ok);
    ev(`${extra ? `Luot ${m.pass}: ` : ''}Dien xong ${m.ok}/${m.total} o`, {
      kind: m.total === 0 ? 'err' : all ? 'ok' : 'err',
      detail: fails.length
        ? fails.slice(0, 6).map((r) => `✕ ${r.step?.label || ''} — ${r.error || ''}`).join('\n')
        : '',
    });
    toast(`${m.ok}/${m.total} o`, all ? 'ok' : 'err');
  }

  /* ------------------------------------------------------------- agent */

  if (m.phase === 'agent-start') {
    setAgentRunning(true);
    ev(`Agent nhan muc tieu: ${m.goal || '(khong co)'}`, { kind: 'idle', detail: `Toi da ${m.max} luot` });
  }

  if (m.phase === 'agent-look') ev(`Luot ${m.step}/${m.max} — dang nhin trang...`);

  if (m.phase === 'agent-looked') {
    finishEv();
    ev(`Doc duoc ${m.count} element`, { kind: 'ok', detail: m.title || m.url || '' });
  }

  if (m.phase === 'agent-think') ev('Dang nghi...');

  if (m.phase === 'agent-thought') {
    finishEv();
    const card = el('div', 'card');
    if (m.thought) card.append(el('div', 'thought', m.thought));
    const calls = el('div', 'calls');
    card.append(calls);
    // Cong token cua RIENG luot nay; m.usage la tong cong don cua ca phien
    // agent, tru ra se sai neu truoc do da chay che do Dien form.
    if (m.turnUsage) addUsage(m.turnUsage);
    if (m.usage?.total) {
      card.append(el('div', 'meta', `Ca phien agent: ${fmtTok(m.usage.total)} token / ${m.usage.calls || 1} lan goi`));
    }
    if (m.provider) card.append(el('div', 'meta', viaLabel(m)));
    const node = ev(`Chon ${m.count} hanh dong`, { kind: 'ok', ms: m.ms || null, card });
    node.dataset.turn = '1';
    currentCalls = calls;
  }

  if (m.phase === 'agent-act' && currentCalls) currentCalls.append(callRow(m.action));

  if (m.phase === 'agent-end') {
    setAgentRunning(false);
    currentCalls = null;
    const kind = m.status === 'done' ? 'ok' : 'err';
    const label = {
      done: 'Agent hoan thanh muc tieu',
      blocked: 'Agent dung lai',
      stopped: 'Da dung theo yeu cau',
      maxsteps: 'Het so luot cho phep',
    }[m.status] || m.status;
    const cost = m.usage?.total ? `\n${fmtTok(m.usage.total)} token qua ${m.usage.calls || m.steps} lan goi model` : '';
    ev(`${label} — sau ${m.steps} luot`, { kind, detail: (m.summary || '') + cost });
    toast(label, kind);
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

document.querySelectorAll('.modes button').forEach((b) => {
  b.onclick = () => {
    state.mode = b.dataset.mode;
    document.querySelectorAll('.modes button').forEach((x) => x.classList.toggle('on', x === b));
    $('#prompt').placeholder =
      state.mode === 'agent'
        ? 'Muc tieu cho agent. VD: tim viec Angular o TP.HCM roi dien don ung tuyen dau tien'
        : state.mode === 'random'
        ? 'Khong can nhap gi — bam gui de dien du lieu thu ngay (khong goi AI)'
        : 'Vi du: dien don ung tuyen Senior Angular Dev, 6 nam kinh nghiem, o TP.HCM';
    $('#prompt').disabled = state.mode === 'random';
  };
});

/** Truoc khi goi AI: neu provider chua san sang thi chi the huong dan, khong chay. */
async function ensureReady() {
  const st = await refreshSetup();
  if (st?.ready) return true;
  switchView('run');
  toast(st?.reason || 'Chua ket noi AI', 'err');
  $('#setup').scrollIntoView({ block: 'start' });
  return false;
}

$('#btn-run').onclick = async () => {
  const request = $('#prompt').value.trim();
  switchView('run');

  if (state.mode === 'random') {
    // Khong can AI, khong can key
    setBusy(true);
    ev('Dien du lieu thu: dropdown / multi chon ngau nhien, so ngau nhien, text theo nhan', { kind: 'idle' });
    try {
      const r = await send({ type: 'AF_DUMMY_FILL', allTabs: chips.allTabs });
      if (r?.error) throw new Error(r.error);
    } catch (e) {
      finishEv('err', '✕');
      ev('Loi: ' + e.message, { kind: 'err' });
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
    return;
  }

  if (!(await ensureReady())) return;

  if (state.mode === 'agent') {
    if (!request) return toast('Agent can mot muc tieu cu the', 'err');
    setBusy(true);
    try {
      const r = await send({ type: 'AF_AGENT_RUN', goal: request });
      if (r?.error) throw new Error(r.error);
    } catch (e) {
      setAgentRunning(false);
      finishEv('err', '✕');
      ev('Loi: ' + e.message, { kind: 'err' });
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
    return;
  }

  setBusy(true);
  ev(request ? `Yeu cau: ${request}` : 'Dien toan bo form bang du lieu hop ly', { kind: 'idle' });
  try {
    const r = await send({ type: 'AF_AUTOFILL', request, allTabs: chips.allTabs });
    if (r?.error) throw new Error(r.error);
  } catch (e) {
    finishEv('err', '✕');
    ev('Loi: ' + e.message, { kind: 'err' });
    toast(e.message, 'err');
  } finally {
    setBusy(false);
  }
};

$('#btn-stop').onclick = async () => {
  await send({ type: 'AF_AGENT_STOP' });
  toast('Dang dung agent sau hanh dong hien tai...', 'info');
};

$('#btn-map').onclick = async () => {
  switchView('run');
  setBusy(true);
  $('#btn-map').classList.add('busy');
  ev('Dang chup ban do trang (dung cai ma model nhin thay)...');
  try {
    const r = await send({ type: 'AF_SNAPSHOT_TAB' });
    if (!r?.ok) throw new Error(r?.error || 'that bai');
    finishEv();
    const card = el('div', 'mapdump', r.text);
    ev(`Ban do: ${r.count} element co the tuong tac`, { kind: 'ok', card });
  } catch (e) {
    finishEv('err', '✕');
    ev('Loi: ' + e.message, { kind: 'err' });
  } finally {
    $('#btn-map').classList.remove('busy');
    setBusy(false);
  }
};

$('#btn-scan').onclick = async () => {
  switchView('fields');
  setBusy(true);
  $('#btn-scan').classList.add('busy');
  setScanning(true);
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
    setScanning(false);
    $('#btn-scan').classList.remove('busy');
    setBusy(false);
  }
};

/* Chip bat/tat: bam 1 lan la bat (chip to mau), bam lai la tat. */
const chips = { highlight: false, pick: false, allTabs: false };

function renderChips() {
  $('#btn-alltabs').classList.toggle('on', chips.allTabs);
  $('#btn-highlight').classList.toggle('on', chips.highlight);
  $('#btn-pick').classList.toggle('on', chips.pick);
  $('#btn-pick').textContent = chips.pick ? 'Dang chon… (Esc)' : 'Chon element';
  $('#btn-clear').classList.toggle('hide', !chips.highlight && !chips.pick && $('#picked').classList.contains('hide'));
}

async function setHighlight(on) {
  chips.highlight = on;
  renderChips();
  if (!on) {
    await send({ type: 'AF_CLEAR_TAB' });
    return;
  }
  if (!state.fields.length) {
    const r = await send({ type: 'AF_SCAN_TAB', deep: false });
    state.fields = r.fields || [];
    renderFields();
  }
  await send({ type: 'AF_HIGHLIGHT_TAB', fields: state.fields });
}

$('#btn-highlight').onclick = () => setHighlight(!chips.highlight);
$('#btn-alltabs').onclick = () => {
  chips.allTabs = !chips.allTabs;
  renderChips();
  toast(chips.allTabs ? 'Se bam tung tab tren trang va dien tung tab' : 'Chi dien tab dang mo', 'info');
};

$('#btn-clear').onclick = async () => {
  chips.highlight = false;
  chips.pick = false;
  $('#picked').classList.add('hide');
  renderChips();
  await send({ type: 'AF_CLEAR_TAB' });
};

$('#btn-pick').onclick = async () => {
  if (chips.pick) {
    // bam lai = huy: content script tra null cho request AF_PICK dang cho
    chips.pick = false;
    renderChips();
    await send({ type: 'AF_CLEAR_TAB' });
    return;
  }
  chips.pick = true;
  // danh dau va chon element dung chung mot lop overlay -> tat danh dau truoc
  chips.highlight = false;
  renderChips();
  toast('Di chuot len trang roi click element muon chon. Esc de huy.', 'info');
  const r = await send({ type: 'AF_PICK_TAB' });
  chips.pick = false;
  const p = r?.picked;
  const box = $('#picked');
  if (!p) {
    box.classList.add('hide');
    renderChips();
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
  renderChips();
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

$('#btn-profile-save').onclick = async () => {
  state.settings = await send({ type: 'AF_SET_SETTINGS', patch: { persona: $('#profile').value } });
  const f = $('#profile-saved');
  f.classList.remove('on');
  void f.offsetWidth; // ep chay lai animation
  f.classList.add('on');
  toast('Da luu ho so', 'ok');
};

$('#btn-mem-export').onclick = async () => {
  const r = await send({ type: 'AF_MEM_EXPORT' });
  if (!r?.ok) return toast(r?.error || 'Xuat that bai', 'err');
  if (!r.count) return toast('Chua co ban luu nao de xuat', 'err');
  const blob = new Blob([r.text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = `autofill-studio-bo-nho-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Da xuat ${r.count} ban luu`, 'ok');
};

$('#btn-mem-copy').onclick = async () => {
  const r = await send({ type: 'AF_MEM_EXPORT' });
  if (!r?.ok || !r.count) return toast('Chua co ban luu nao de copy', 'err');
  await navigator.clipboard.writeText(r.text);
  toast(`Da copy ${r.count} ban luu vao clipboard`, 'ok');
};

$('#btn-mem-import').onclick = () => {
  $('#import-box').classList.toggle('hide');
  if (!$('#import-box').classList.contains('hide')) $('#import-text').focus();
};

$('#btn-import-cancel').onclick = () => {
  $('#import-box').classList.add('hide');
  $('#import-text').value = '';
};

$('#btn-import-go').onclick = async () => {
  const text = $('#import-text').value.trim();
  if (!text) return toast('Chua dan gi vao', 'err');
  const r = await send({ type: 'AF_MEM_IMPORT', text });
  if (!r?.ok) return toast(r?.error || 'Nhap that bai', 'err');
  $('#import-box').classList.add('hide');
  $('#import-text').value = '';
  const bits = [`them ${r.added}`, r.updated ? `cap nhat ${r.updated}` : '', r.skipped ? `bo qua ${r.skipped} ban hong` : '']
    .filter(Boolean)
    .join(' · ');
  toast(`Da nhap: ${bits}`, 'ok');
  await refreshMemory();
};

$('#btn-mem-refresh').onclick = refreshMemory;
$('#btn-settings').onclick = () => chrome.runtime.openOptionsPage();
$('#provider').onclick = () => openOptions(state.settings?.provider);
$('#q').oninput = (e) => {
  state.filter = e.target.value;
  renderFields();
};

/* Panel song lau hon tab: doi tab thi phai doc lai ngu canh */
chrome.tabs.onActivated.addListener(async () => {
  await pickTab();
  chips.highlight = false;
  chips.pick = false;
  renderChips();
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
  renderMode();
  await refreshSetup();
});

/* Cai dat doi o tab khac (nguoi dung vua dan key) -> cap nhat ngay */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  state.settings = changes.settings.newValue || state.settings;
  renderMode();
  refreshSetup();
});

init();
