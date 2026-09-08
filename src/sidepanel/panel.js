/* AI Autofill Studio — sidepanel/panel.js */

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const state = {
  tabId: null,
  settings: null,
  fields: [],
  steps: [],
  skipped: [],
  results: [],
  filter: '',
};

const send = (msg) => chrome.runtime.sendMessage({ ...msg, tabId: msg.tabId ?? state.tabId });

/* ------------------------------------------------------------------- log */

function log(line, kind = '') {
  const t = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  $('#log').textContent += `[${t}] ${kind ? kind.toUpperCase() + ' ' : ''}${line}\n`;
  $('#log').scrollTop = $('#log').scrollHeight;
}

let toastTimer;
function toast(msg, kind = 'info') {
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  const t = el('div', `toast ${kind}`, msg);
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}

/* ------------------------------------------------------------------ init */

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabId = tab?.id ?? null;
  state.settings = await send({ type: 'AF_GET_SETTINGS' });
  $('#prompt').value = state.settings.lastPrompt || '';
  renderProvider();
  renderCdp();
  log(`San sang. Tab #${state.tabId} — ${tab?.url?.slice(0, 60) || ''}`);
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
  $('#provider').textContent = map[p] || p;
  const cfg = state.settings[p] || {};
  const needsKey = ['gemini', 'anthropic', 'openai'].includes(p);
  const missing = needsKey && !cfg.apiKey && cfg.auth !== 'oauth';
  $('#provider').classList.toggle('muted', missing);
  $('#provider').title = missing ? 'Chua cau hinh API key — mo Cai dat' : `${map[p]} · ${cfg.model || ''}`;
}

function renderCdp() {
  const on = !!state.settings.cdpMode;
  $('#btn-cdp').textContent = on ? 'CDP' : 'DOM';
  $('#btn-cdp').classList.toggle('on', on);
  $('#btn-cdp').title = on
    ? 'Che do CDP: event trusted qua chrome.debugger (Chrome se hien thanh vang)'
    : 'Che do DOM: nhanh, khong thanh vang. Bam de doi sang CDP.';
}

/* ---------------------------------------------------------------- fields */

const kindLabel = {
  text: 'text', textarea: 'textarea', number: 'number', date: 'date', editor: 'rich-text',
  select: 'select', multiselect: 'multi', combobox: 'dropdown', 'multiselect-custom': 'multi-dropdown',
  checkbox: 'checkbox', 'checkbox-custom': 'checkbox', toggle: 'toggle',
  radio: 'radio', radiogroup: 'radio', file: 'file', range: 'range', color: 'color', datepicker: 'date',
};

function renderFields() {
  const box = $('#fields');
  box.innerHTML = '';
  const q = state.filter.toLowerCase();
  const list = state.fields.filter(
    (f) => !q || `${f.label} ${f.name} ${f.kind} ${f.section}`.toLowerCase().includes(q)
  );
  $('#c-fields').textContent = state.fields.length;
  $('#fields-empty').style.display = list.length ? 'none' : '';

  let lastSection = null;
  for (const f of list) {
    if (f.section && f.section !== lastSection) {
      lastSection = f.section;
      const h = el('div', 'lbl', f.section);
      h.style.marginTop = '6px';
      box.appendChild(h);
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
    const bGo = el('button', '', 'Xem');
    bGo.onclick = () => send({ type: 'AF_SCROLL_TO', frameId: f.frameId, id: f.id });
    const bFill = el('button', '', 'Dien thu');
    bFill.onclick = async () => {
      const v = prompt(`Gia tri cho "${f.label || f.name}":`, '');
      if (v == null) return;
      const r = await send({
        type: 'AF_STEP_ONE',
        frameId: f.frameId,
        step: { afId: f.id, action: 'fill', kind: f.kind, value: v },
      });
      log(`Dien thu "${f.label}": ${r?.result?.ok ? 'OK' : 'that bai — ' + (r?.result?.error || '')}`);
    };
    acts.append(bGo, bFill);
    item.append(acts);
    box.appendChild(item);
  }
}

/* ------------------------------------------------------------------ plan */

function renderPlan() {
  const box = $('#plan');
  box.innerHTML = '';
  $('#c-plan').textContent = state.steps.length;
  $('#plan-empty').style.display = state.steps.length ? 'none' : '';
  $('#plan-actions').style.display = state.steps.length ? '' : 'none';

  state.steps.forEach((s, i) => {
    const res = state.results.find((r) => r.step === s || (r.step && r.step.afId === s.afId));
    const item = el('div', 'item' + (res ? (res.ok ? ' ok' : ' err') : ''));
    const top = el('div', 'top');
    top.append(el('span', 'kind', s.action), el('span', 'name', s.label || s.afId));
    if (res) top.append(el('span', `status ${res.ok ? 'ok' : 'err'}`, res.ok ? '✓' : '✕'));
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
    const bGo = el('button', '', 'Xem');
    bGo.onclick = () => send({ type: 'AF_SCROLL_TO', frameId: s.frameId, id: s.afId });
    const bRun = el('button', '', 'Chay buoc nay');
    bRun.onclick = async () => {
      const r = await send({ type: 'AF_STEP_ONE', frameId: s.frameId, step: s });
      const ok = r?.result?.ok;
      log(`Buoc ${i + 1} "${s.label}": ${ok ? 'OK' : 'that bai — ' + (r?.result?.error || '')}`, ok ? '' : 'err');
      item.classList.toggle('ok', !!ok);
      item.classList.toggle('err', !ok);
    };
    const bDel = el('button', '', 'Bo');
    bDel.onclick = () => {
      state.steps.splice(i, 1);
      renderPlan();
    };
    acts.append(bGo, bRun, bDel);
    item.append(acts);
    box.appendChild(item);
  });

  if (state.skipped.length) {
    const h = el('div', 'lbl', `Bo qua (${state.skipped.length})`);
    h.style.marginTop = '10px';
    box.appendChild(h);
    for (const s of state.skipped) {
      const f = state.fields.find((x) => (x.gid || x.id) === s.id);
      const it = el('div', 'item skip');
      it.append(el('div', 'name', f?.label || s.id), el('div', 'meta', s.reason));
      box.appendChild(it);
    }
  }
}

/* ----------------------------------------------------------------- events */

chrome.runtime.onMessage.addListener((m) => {
  if (m?.type !== 'AF_EVENT') return;
  if (m.phase === 'scan') log(m.message);
  if (m.phase === 'scanned') {
    state.fields = m.fields || [];
    renderFields();
    log(`Tim thay ${m.count} field tren ${m.frames} frame.`);
  }
  if (m.phase === 'generate') log(m.message);
  if (m.phase === 'planned') {
    state.steps = m.steps || [];
    state.skipped = m.skipped || [];
    state.results = [];
    renderPlan();
    log(`AI tra ve ${state.steps.length} buoc trong ${m.ms}ms.` + (m.usage ? ` Token: ${JSON.stringify(m.usage)}` : ''));
  }
  if (m.phase === 'run') log(m.message);
  if (m.phase === 'done') {
    state.results = m.results || [];
    renderPlan();
    log(`Hoan tat: ${m.ok}/${m.total} field thanh cong.`, m.ok === m.total ? '' : 'warn');
    for (const r of state.results.filter((x) => !x.ok)) log(`  ✕ ${r.step?.label || ''}: ${r.error || ''}`);
    toast(`Da dien ${m.ok}/${m.total} field`, m.ok === m.total ? 'ok' : 'err');
  }
});

/* ------------------------------------------------------------------- UI */

$('#btn-scan').onclick = async () => {
  $('#btn-scan').disabled = true;
  try {
    const r = await send({ type: 'AF_SCAN_TAB', deep: state.settings.deepScan });
    state.fields = r.fields || [];
    renderFields();
    log(`Quet xong: ${state.fields.length} field / ${r.frames} frame.`);
    toast(`${state.fields.length} field`, 'ok');
  } catch (e) {
    log('Quet loi: ' + e.message, 'err');
    toast('Quet loi: ' + e.message, 'err');
  } finally {
    $('#btn-scan').disabled = false;
  }
};

$('#btn-run').onclick = async () => {
  const request = $('#prompt').value.trim();
  $('#btn-run').disabled = true;
  $('#btn-run').textContent = 'Dang chay...';
  try {
    await send({ type: 'AF_AUTOFILL', request });
  } catch (e) {
    log('Loi: ' + e.message, 'err');
    toast(e.message, 'err');
  } finally {
    $('#btn-run').disabled = false;
    $('#btn-run').textContent = 'Quet & dien tu dong';
  }
};

$('#btn-apply').onclick = async () => {
  $('#btn-apply').disabled = true;
  try {
    const results = await send({ type: 'AF_RUN_PLAN', steps: state.steps });
    state.results = Array.isArray(results) ? results : [];
    renderPlan();
    const ok = state.results.filter((r) => r.ok).length;
    log(`Ap dung: ${ok}/${state.results.length} thanh cong.`);
    toast(`${ok}/${state.results.length} field`, ok === state.results.length ? 'ok' : 'err');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    $('#btn-apply').disabled = false;
  }
};

$('#btn-copy-plan').onclick = async () => {
  await navigator.clipboard.writeText(JSON.stringify(state.steps, null, 2));
  toast('Da copy JSON ke hoach', 'ok');
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

$('#btn-clear').onclick = () => send({ type: 'AF_CLEAR_TAB' });

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
  box.innerHTML = `<b>${p.tag}${p.type ? '[' + p.type + ']' : ''}</b> ${p.label ? '— ' + p.label : ''}<br>
    Locator goi y: <code>${JSON.stringify(p.suggestedLocator)}</code><br>
    <code>${p.selector}</code>`;
  log(`Da chon: ${p.tag} — ${p.label} | ${JSON.stringify(p.suggestedLocator)}`);
};

$('#btn-cdp').onclick = async () => {
  const next = !state.settings.cdpMode;
  state.settings = await send({ type: 'AF_SET_SETTINGS', patch: { cdpMode: next } });
  renderCdp();
  if (next) {
    const r = await send({ type: 'AF_CDP_ATTACH' });
    log(r?.ok ? 'Da gan chrome.debugger (che do CDP).' : 'Khong gan duoc debugger: ' + (r?.error || ''), r?.ok ? '' : 'err');
  } else {
    await send({ type: 'AF_CDP_DETACH' });
    log('Da go debugger, quay ve che do DOM.');
  }
};

$('#btn-settings').onclick = () => chrome.runtime.openOptionsPage();
$('#btn-clearlog').onclick = () => ($('#log').textContent = '');
$('#q').oninput = (e) => {
  state.filter = e.target.value;
  renderFields();
};

document.querySelectorAll('.tabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    document.querySelectorAll('.panel').forEach((p) => p.classList.add('hide'));
    $(`#tab-${b.dataset.tab}`).classList.remove('hide');
  };
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) send({ type: 'AF_GET_SETTINGS' }).then((s) => {
    state.settings = s;
    renderProvider();
    renderCdp();
  });
});

init();
