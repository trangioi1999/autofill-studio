/* Autofill Studio — options/options.js */

const $ = (s) => document.querySelector(s);
const send = (msg) => chrome.runtime.sendMessage(msg);

let settings = null;

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

function load() {
  for (const [path, sel] of Object.entries(FIELDS)) {
    const node = $(sel);
    if (!node) continue;
    const v = get(settings, path);
    if (node.type === 'checkbox') node.checked = !!v;
    else node.value = v ?? '';
  }
  showProvider();
  toggleGeminiAuth();
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
  if (r?.ok) node.textContent = `Kha dung — trang thai: ${r.status}`;
  else node.textContent = `Chua kha dung — ${r?.status || '?'}. ${r?.reason || ''}`;
}

async function checkBridge() {
  await send({ type: 'AF_SET_SETTINGS', patch: collect() });
  const r = await send({ type: 'AF_BRIDGE_HEALTH' });
  $('#bridge-status').textContent = r?.ok
    ? `Bridge OK — backend: ${(r.backends || []).join(', ') || r.backend || 'n/a'}`
    : `Khong ket noi duoc: ${r?.error || '?'}`;
}

/* ------------------------------------------------------------------ events */

$('#provider').onchange = showProvider;
$('#g-auth').onchange = toggleGeminiAuth;

$('#btn-save').onclick = async () => {
  settings = await send({ type: 'AF_SET_SETTINGS', patch: collect() });
  $('#save-result').textContent = 'Da luu ✓';
  setTimeout(() => ($('#save-result').textContent = ''), 2000);
};

$('#btn-reset').onclick = async () => {
  if (!confirm('Khoi phuc toan bo cai dat ve mac dinh?')) return;
  settings = await send({ type: 'AF_RESET_SETTINGS' });
  load();
};

$('#btn-test').onclick = async () => {
  $('#test-result').textContent = 'Dang test...';
  await send({ type: 'AF_SET_SETTINGS', patch: collect() });
  const r = await send({ type: 'AF_TEST_PROVIDER' });
  $('#test-result').textContent = r?.ok ? `OK — ${r.ms}ms · ${r.sample}` : `Loi: ${r?.error}`;
  $('#test-result').style.color = r?.ok ? 'var(--ok)' : 'var(--err)';
};

$('#btn-oauth').onclick = async () => {
  await send({ type: 'AF_SET_SETTINGS', patch: collect() });
  const r = await send({ type: 'AF_OAUTH_LOGIN' });
  $('#test-result').textContent = r?.ok ? 'Dang nhap Google thanh cong ✓' : `Loi: ${r?.error}`;
  $('#test-result').style.color = r?.ok ? 'var(--ok)' : 'var(--err)';
};

(async () => {
  settings = await send({ type: 'AF_GET_SETTINGS' });
  load();
})();
