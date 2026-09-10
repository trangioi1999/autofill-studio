/* Autofill Studio — options/options.js
 * Moi thay doi deu tu luu (debounce). Nut "Luu" chi de nguoi dung yen tam.
 */

const $ = (s) => document.querySelector(s);
const send = (msg) => chrome.runtime.sendMessage(msg);

let settings = null;
let bridgeHealthCache = null;

const FIELDS = {
  provider: '#provider',
  'gemini.auth': '#g-auth',
  'gemini.apiKey': '#g-key',
  'gemini.clientId': '#g-client',
  'gemini.project': '#g-project',
  'gemini.location': '#g-location',
  'gemini.model': '#g-model',
  'anthropic.apiKey': '#a-key',
  'anthropic.model': '#a-model',
  'anthropic.baseUrl': '#a-base',
  'openai.baseUrl': '#o-base',
  'openai.apiKey': '#o-key',
  'openai.model': '#o-model',
  'bridge.url': '#b-url',
  'bridge.model': '#b-model',
  'bridge.token': '#b-token',
  persona: '#persona',
  language: '#language',
  deepScan: '#deepScan',
  cdpMode: '#cdpMode',
  stopOnError: '#stopOnError',
  randomGaps: '#randomGaps',
  autoSaveSnapshot: '#autoSaveSnapshot',
  autoSuggestSnapshot: '#autoSuggestSnapshot',
  typeDelay: '#typeDelay',
  maxFields: '#maxFields',
};

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
const set = (obj, path, val) => {
  const parts = path.split('.');
  let cur = obj;
  while (parts.length > 1) {
    const k = parts.shift();
    cur[k] = cur[k] || {};
    cur = cur[k];
  }
  cur[parts[0]] = val;
};

/** Dat gia tri cho <select>; neu option chua co (VD backend cu) thi them vao de khong mat. */
function setSelect(node, value) {
  const v = value ?? '';
  if (v !== '' && ![...node.options].some((o) => o.value === v)) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    node.append(o);
  }
  node.value = v;
}

function load() {
  for (const [path, sel] of Object.entries(FIELDS)) {
    const node = $(sel);
    if (!node) continue;
    const v = get(settings, path);
    if (node.type === 'checkbox') node.checked = !!v;
    else if (node.tagName === 'SELECT') setSelect(node, v);
    else node.value = v ?? '';
  }
  showProvider();
  toggleGeminiAuth();
  renderBridgeCmd();
  $('#redirect-uri').textContent = chrome.identity.getRedirectURL('oauth2');
}

function collect() {
  const patch = {};
  for (const [path, sel] of Object.entries(FIELDS)) {
    const node = $(sel);
    if (!node) continue;
    let v = node.type === 'checkbox' ? node.checked : node.value;
    if (path === 'typeDelay' || path === 'maxFields') v = Number(v) || undefined;
    set(patch, path, v);
  }
  return patch;
}

/* --------------------------------------------------------------- autosave */

let saveTimer = null;
function flash(text, ok = true) {
  const n = $('#save-result');
  n.textContent = text;
  n.style.color = ok ? 'var(--ok)' : 'var(--err)';
  clearTimeout(flash.t);
  flash.t = setTimeout(() => (n.textContent = ''), 2200);
}

async function save() {
  clearTimeout(saveTimer);
  settings = await send({ type: 'AF_SET_SETTINGS', patch: collect() });
  flash('Da luu ✓');
  return settings;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

/* ---------------------------------------------------------------- provider */

function showProvider() {
  const p = $('#provider').value;
  document.querySelectorAll('.prov').forEach((n) => n.classList.toggle('on', n.dataset.prov === p));
  if (p === 'chromeai') checkChromeAi();
  if (p === 'bridge') checkBridge();
}

function toggleGeminiAuth() {
  const oauth = $('#g-auth').value === 'oauth';
  $('#g-oauth-wrap').style.display = oauth ? 'grid' : 'none';
  $('#g-key-wrap').style.display = oauth ? 'none' : 'grid';
}

async function checkChromeAi() {
  const r = await send({ type: 'AF_CHROMEAI_STATUS' });
  const node = $('#chromeai-status');
  node.className = 'status-line ' + (r?.ok ? 'ok' : 'err');
  if (r?.ok) node.textContent = `Kha dung — trang thai: ${r.status}`;
  else node.textContent = `Chua kha dung — ${r?.status || '?'}. ${r?.reason || ''}`;
}

/* ------------------------------------------------------------------ bridge */

/** Lenh nguoi dung can chay, phan anh dung URL/token/backend dang chon. */
function renderBridgeCmd() {
  const url = $('#b-url').value.trim();
  const token = $('#b-token').value.trim();
  const parts = ['node bridge/server.mjs'];
  try {
    const port = new URL(url || 'http://127.0.0.1:8765').port;
    if (port && port !== '8765') parts.push(`--port ${port}`);
  } catch {
    /* url hong thi bo qua */
  }
  if (token) parts.push(`--token ${token}`);
  $('#bridge-cmd').textContent = parts.join(' ');
}

/**
 * Dung lai dropdown backend tu /health. Moi backend mot dong; Ollama them
 * mot dong cho tung model da pull. Gia tri dang luu luon duoc giu.
 */
function renderBackendOptions(h) {
  const sel = $('#b-model');
  const current = sel.value || get(settings, 'bridge.model') || 'default';
  sel.textContent = '';

  const add = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.append(o);
    return o;
  };

  const def = h?.default;
  add('default', def ? `Tu chon — bridge se dung ${def.name}${def.model ? ':' + def.model : ''}` : 'Tu chon (bridge quyet dinh)');

  const detail = h?.detail || (h?.backends || []).map((name) => ({ name, bin: h.bins?.[name] || name }));
  for (const b of detail) {
    const bin = b.bin && b.bin !== b.name && !/^https?:/.test(b.bin) ? ` (binary: ${b.bin})` : '';
    if (b.name === 'ollama') {
      if (b.models?.length) for (const m of b.models) add(`ollama:${m}`, `Ollama — ${m}`);
      else add('ollama', 'Ollama (chua pull model nao)');
      continue;
    }
    add(b.name, `${b.label || b.name}${bin}`);
  }
  setSelect(sel, current);

  const hint = $('#b-model-hint');
  if (!detail.length) hint.textContent = 'Bridge khong tim thay CLI nao. Cai va dang nhap claude / gemini / kiro, hoac chay Ollama, roi bam "Kiem tra lai".';
  else if (detail.length === 1) hint.textContent = `May chi co ${detail[0].name}, de "Tu chon" la du.`;
  else hint.textContent = `May co ${detail.length} backend. Chon dich danh de biet chac cai nao tra loi; "Tu chon" se lay ${def?.name || detail[0].name}.`;
}

async function checkBridge() {
  const node = $('#bridge-status');
  node.className = 'status-line';
  node.textContent = 'Dang kiem tra bridge...';
  const cfg = { url: $('#b-url').value.trim(), token: $('#b-token').value.trim() };
  const h = await send({ type: 'AF_BRIDGE_HEALTH', cfg });
  bridgeHealthCache = h;
  if (h?.ok) {
    node.className = 'status-line ok';
    const names = (h.backends || []).map((n) => (h.bins?.[n] && h.bins[n] !== n && !/^https?:/.test(h.bins[n]) ? `${n} (${h.bins[n]})` : n));
    node.textContent = `Bridge OK (v${h.version || '?'}) — co: ${names.join(', ') || 'khong co backend nao'}` +
      (h.auth === 'token' ? ' · dang yeu cau token' : '');
    renderBackendOptions(h);
  } else {
    node.className = 'status-line err';
    node.textContent = h?.error || 'Khong ket noi duoc bridge.';
    renderBackendOptions(null);
  }
}

/* ------------------------------------------------------------------ events */

$('#provider').onchange = () => {
  showProvider();
  scheduleSave();
};
$('#g-auth').onchange = () => {
  toggleGeminiAuth();
  scheduleSave();
};
$('#btn-bridge-check').onclick = checkBridge;
$('#btn-copy-cmd').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('#bridge-cmd').textContent);
    $('#btn-copy-cmd').textContent = 'Da copy';
    setTimeout(() => ($('#btn-copy-cmd').textContent = 'Copy'), 1500);
  } catch {
    /* clipboard bi chan thi thoi */
  }
};
for (const id of ['#b-url', '#b-token']) {
  $(id).addEventListener('input', renderBridgeCmd);
  $(id).addEventListener('change', () => setTimeout(checkBridge, 450));
}

// Tu luu moi thay doi
for (const sel of Object.values(FIELDS)) {
  const node = $(sel);
  if (!node) continue;
  node.addEventListener('change', scheduleSave);
  if (node.tagName === 'TEXTAREA' || (node.tagName === 'INPUT' && node.type !== 'checkbox')) {
    node.addEventListener('input', scheduleSave);
  }
}

$('#btn-save').onclick = save;

$('#btn-reset').onclick = async () => {
  if (!confirm('Khoi phuc toan bo cai dat ve mac dinh?')) return;
  settings = await send({ type: 'AF_RESET_SETTINGS' });
  load();
};

$('#btn-test').onclick = async () => {
  const out = $('#test-result');
  out.style.color = '';
  out.textContent = 'Dang test...';
  await save();
  const r = await send({ type: 'AF_TEST_PROVIDER' });
  if (r?.ok) {
    const via = r.backend ? ` · qua ${r.backend}${r.model ? ':' + r.model : ''}` : '';
    out.textContent = `OK — ${r.ms}ms${via} · ${r.sample}`;
  } else out.textContent = `Loi: ${r?.error}`;
  out.style.color = r?.ok ? 'var(--ok)' : 'var(--err)';
};

$('#btn-oauth').onclick = async () => {
  await save();
  const r = await send({ type: 'AF_OAUTH_LOGIN' });
  $('#test-result').textContent = r?.ok ? 'Dang nhap Google thanh cong ✓' : `Loi: ${r?.error}`;
  $('#test-result').style.color = r?.ok ? 'var(--ok)' : 'var(--err)';
};

(async () => {
  settings = await send({ type: 'AF_GET_SETTINGS' });
  load();
  // Mo tu side panel voi ?provider=bridge -> chon san provider do
  const want = new URLSearchParams(location.search).get('provider');
  if (want && [...$('#provider').options].some((o) => o.value === want) && want !== settings.provider) {
    $('#provider').value = want;
    showProvider();
    await save();
  }
})();
