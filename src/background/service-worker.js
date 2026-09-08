/* Autofill Studio — background/service-worker.js
 * Dieu phoi: quet field tren moi frame, goi AI, chay ke hoach (DOM hoac CDP).
 */
import { getSettings, setSettings, resetSettings, pushHistory, DEFAULTS } from '../lib/storage.js';
import { SYSTEM_PROMPT, PLAN_SCHEMA, buildUserPrompt, planToSteps } from '../lib/prompt.js';
import { complete, testProvider, geminiOAuthLogin, geminiOAuthLogout, chromeaiAvailability, bridgeHealth, PROVIDERS } from '../providers/index.js';
import * as CDP from './cdp.js';
import * as Mem from '../lib/memory.js';
import {
  AGENT_SYSTEM, AGENT_SCHEMA, MAX_STEPS_DEFAULT, MUTATING,
  renderSnapshot, renderState, buildAgentPrompt, compactHistory, actionToStep,
} from '../lib/agent.js';
import { screenKey } from '../lib/screen.js';

/* ------------------------------------------------------------------ setup */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'af-open', title: 'Autofill Studio: mo bang dieu khien', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'af-fill', title: 'Autofill Studio: dien form nay', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'af-pick', title: 'Autofill Studio: chon element (inspect)', contexts: ['all'] });
  });
});

chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'af-open') chrome.sidePanel.open({ tabId: tab.id });
  if (info.menuItemId === 'af-pick') sendToAllFrames(tab.id, { type: 'AF_PICK' });
  if (info.menuItemId === 'af-fill') {
    chrome.sidePanel.open({ tabId: tab.id });
    const s = await getSettings();
    autofill({ tabId: tab.id, request: s.lastPrompt || '' }).catch(() => {});
  }
});

chrome.commands?.onCommand.addListener(async (cmd) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (cmd === 'toggle-picker') sendToAllFrames(tab.id, { type: 'AF_PICK' });
  if (cmd === 'run-autofill') {
    const s = await getSettings();
    autofill({ tabId: tab.id, request: s.lastPrompt || '' }).catch(() => {});
  }
});

/* -------------------------------------------------------------- frame util */

async function listFrames(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    return (frames || []).filter((f) => f.url && !/^(about:blank$|chrome:|devtools:)/.test(f.url));
  } catch {
    return [{ frameId: 0, url: '' }];
  }
}

async function ensureInjected(tabId, frameId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'AF_PING' }, { frameId });
    if (r && r.ok) return true;
  } catch {
    /* chua co content script */
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: [
        'src/content/00-util.js',
        'src/content/10-locator.js',
        'src/content/20-scanner.js',
        'src/content/30-actions.js',
        'src/content/40-picker.js',
        'src/content/50-snapshot.js',
        'src/content/99-main.js',
      ],
    });
    await chrome.scripting.insertCSS({ target: { tabId, frameIds: [frameId] }, files: ['src/content/overlay.css'] });
    return true;
  } catch (e) {
    return false;
  }
}

function ask(tabId, frameId, msg) {
  return chrome.tabs.sendMessage(tabId, msg, { frameId }).catch((e) => ({ ok: false, error: e.message }));
}

async function sendToAllFrames(tabId, msg) {
  const frames = await listFrames(tabId);
  return Promise.all(frames.map((f) => ask(tabId, f.frameId, msg)));
}

/* ----------------------------------------------------------------- scan */

async function scanTab(tabId, { deep = true } = {}) {
  const frames = await listFrames(tabId);
  const fields = [];
  let context = null;

  for (const f of frames) {
    const ready = await ensureInjected(tabId, f.frameId);
    if (!ready) continue;
    const r = await ask(tabId, f.frameId, { type: deep ? 'AF_DEEP_SCAN' : 'AF_SCAN' });
    if (!r || !r.ok) continue;
    if (f.frameId === 0) context = r.context;
    else if (!context) context = r.context;
    for (const field of r.fields) {
      field.frameId = f.frameId;
      field.frameUrl = f.url;
      field.gid = `${f.frameId}:${field.id}`;
      fields.push(field);
    }
  }

  // Neu co iframe, ghep them ngu canh cua chung
  return { fields, context: context || { url: '', title: '' }, frames: frames.length };
}

/* -------------------------------------------------------------- generate */

async function generatePlan({ tabId, request, fields, context }) {
  const settings = await getSettings();
  const trimmed = fields.slice(0, settings.maxFields);

  const user = buildUserPrompt({
    fields: trimmed,
    context,
    request,
    persona: settings.persona,
    language: settings.language,
  });

  const t0 = Date.now();
  const res = await complete({
    settings,
    system: SYSTEM_PROMPT,
    user,
    schema: settings.provider === 'chromeai' ? null : PLAN_SCHEMA,
  });

  const plan = res.json || {};
  const steps = planToSteps(plan, trimmed);
  return {
    steps,
    skipped: plan.skipped || [],
    raw: res.raw,
    usage: res.usage,
    ms: Date.now() - t0,
    provider: settings.provider,
  };
}

/* ------------------------------------------------------------------- run */

async function runPlan({ tabId, steps }) {
  const settings = await getSettings();
  const results = [];

  if (settings.cdpMode) {
    for (const step of steps) {
      let r;
      try {
        r = await CDP.runStep(tabId, step);
      } catch (e) {
        r = { fallback: true, cdpError: e.message };
      }
      if (r && r.fallback) {
        const dom = await ask(tabId, step.frameId ?? 0, { type: 'AF_STEP', step });
        r = dom?.result || { ok: false, error: dom?.error || 'that bai' };
        r.via = 'dom';
      }
      results.push({ ...r, step });
      await new Promise((res) => setTimeout(res, 60));
    }
    return results;
  }

  // Che do DOM: gom step theo frame de chay theo lo
  const byFrame = new Map();
  for (const s of steps) {
    const fid = s.frameId ?? 0;
    if (!byFrame.has(fid)) byFrame.set(fid, []);
    byFrame.get(fid).push(s);
  }

  for (const [frameId, group] of byFrame) {
    const r = await ask(tabId, frameId, {
      type: 'AF_RUN',
      steps: group,
      options: { stopOnError: settings.stopOnError, stepDelay: 60 },
    });
    if (r && r.ok) results.push(...r.results.map((x) => ({ ...x, via: 'dom' })));
    else group.forEach((s) => results.push({ ok: false, error: r?.error || 'frame khong phan hoi', step: s, via: 'dom' }));
  }
  return results;
}

/* ---------------------------------------------------------------- memory */

async function tabUrl(tabId) {
  try {
    const t = await chrome.tabs.get(tabId);
    return { url: t?.url || '', title: t?.title || '' };
  } catch {
    return { url: '', title: '' };
  }
}

/** Chup lai gia tri dang co tren form thanh mot ban luu. */
async function memSave({ tabId, name, id, auto = false }) {
  const { url, title } = await tabUrl(tabId);
  const { fields } = await scanTab(tabId, { deep: false });
  const entries = Mem.entriesFromFields(fields);

  if (auto) {
    // Ban tu dong: moi man hinh chi giu mot ban, ghi de cho khoi phinh
    const mine = (await Mem.snapshotsFor(url)).find((s) => s.auto);
    if (mine) {
      const saved = await Mem.saveSnapshot({ url, title, entries, id: mine.id, name: mine.name });
      return { ...saved, updated: true };
    }
  }
  return Mem.saveSnapshot({ url, title, name, entries, id, auto });
}

/** Quet trang roi dung mot ban luu de sinh step (khong goi AI). */
async function memPlan({ tabId, id }) {
  const { fields } = await scanTab(tabId, { deep: false });
  const r = await Mem.useSnapshot(id, fields);
  return { ...r, fields };
}

/** Duong tat: quet -> ghep bo nho -> dien luon. */
async function memApply({ tabId, id }) {
  const emit = (e) => chrome.runtime.sendMessage({ type: 'AF_EVENT', ...e }).catch(() => {});
  emit({ phase: 'scan', message: 'Dang quet field...' });
  const { steps, matched, missing, fields, snapshot } = await memPlan({ tabId, id });
  emit({ phase: 'scanned', count: fields.length, frames: 1, fields });
  emit({ phase: 'planned', steps, skipped: missing, ms: 0, source: 'memory', snapshot: { id: snapshot.id, name: snapshot.name } });
  if (!steps.length) {
    emit({ phase: 'done', results: [], ok: 0, total: 0 });
    return { ok: 0, total: 0, matched, missing };
  }
  emit({ phase: 'run', message: `Dang dien ${steps.length} field tu bo nho...` });
  const results = await runPlan({ tabId, steps });
  const okCount = results.filter((r) => r.ok).length;
  emit({ phase: 'done', results, ok: okCount, total: results.length, source: 'memory' });
  return { ok: okCount, total: results.length, matched, missing, results };
}

/* ------------------------------------------------------------------ agent */

const agentStop = new Set(); // tabId dang duoc yeu cau dung giua chung

/** Chup ban do trang tren moi frame. */
async function snapshotTab(tabId) {
  const frames = await listFrames(tabId);
  const out = [];
  let state = null;
  for (const f of frames) {
    if (!(await ensureInjected(tabId, f.frameId))) continue;
    const r = await ask(tabId, f.frameId, { type: 'AF_SNAPSHOT' });
    if (!r || !r.ok) continue;
    if (f.frameId === 0 || !state) state = r.state;
    if (r.nodes?.length) out.push({ frameId: f.frameId, url: f.url, nodes: r.nodes });
  }
  return { frames: out, state: state || { url: '', title: '' } };
}

/** Cho trang tai xong sau khi dieu huong. */
function waitForTabLoad(tabId, timeout = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpd);
      clearTimeout(timer);
      resolve(v);
    };
    const onUpd = (id, info) => {
      if (id === tabId && info.status === 'complete') setTimeout(() => finish(true), 350);
    };
    const timer = setTimeout(() => finish(false), timeout);
    chrome.tabs.onUpdated.addListener(onUpd);
  });
}

/** Chay mot hanh dong khong gan voi element cu the. */
async function runGlobalAction(tabId, a) {
  switch (a.tool) {
    case 'navigate': {
      const url = String(a.url || '');
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Chi cho phep dieu huong toi http/https' };
      await chrome.tabs.update(tabId, { url });
      await waitForTabLoad(tabId);
      return { ok: true, note: url };
    }
    case 'back':
      try {
        await chrome.tabs.goBack(tabId);
        await waitForTabLoad(tabId);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    case 'scroll': {
      const r = await ask(tabId, 0, { type: 'AF_SCROLL_PAGE', direction: a.direction || 'down' });
      return { ok: !!r?.ok, note: `scrollY=${r?.scrollY ?? '?'}` };
    }
    case 'wait': {
      if (a.text) {
        const r = await ask(tabId, 0, { type: 'AF_WAIT_TEXT', text: a.text, timeout: 8000 });
        return r?.ok ? { ok: true, note: `thay "${a.text}"` } : { ok: false, error: `khong thay "${a.text}" sau 8s` };
      }
      await new Promise((res) => setTimeout(res, Math.min(Math.max(a.ms || 800, 100), 10000)));
      return { ok: true };
    }
    case 'read': {
      const r = await ask(tabId, 0, { type: 'AF_READ', query: a.query || '' });
      return { ok: !!r?.ok, note: (r?.text || '').slice(0, 900) };
    }
    default:
      return { ok: false, error: `khong ho tro tool "${a.tool}"` };
  }
}

/**
 * Chay danh sach hanh dong cua mot luot. Dung ngay sau hanh dong lam trang doi
 * de agent duoc nhin ban do moi truoc khi quyet dinh tiep.
 */
async function runActions(tabId, actions, refMap, emit) {
  const results = [];

  for (const a of actions) {
    if (agentStop.has(tabId)) break;

    let r;
    let target = null;

    if (['navigate', 'back', 'scroll', 'wait', 'read'].includes(a.tool)) {
      r = await runGlobalAction(tabId, a);
    } else {
      target = refMap.get(String(a.ref || ''));
      if (!target) {
        r = { ok: false, error: `ref "${a.ref}" khong co trong ban do luot nay` };
      } else {
        const step = actionToStep(a, target);
        if (!step) r = { ok: false, error: `khong ho tro tool "${a.tool}"` };
        else {
          const [out] = await runPlan({ tabId, steps: [step] });
          r = { ok: !!out?.ok, error: out?.error || '' };
        }
      }
    }

    const entry = {
      tool: a.tool,
      target: target?.name || a.ref || a.url || a.text || a.direction || '',
      value: a.value,
      source: a.source || '',
      ok: !!r.ok,
      error: r.error || '',
      note: r.note || '',
    };
    results.push(entry);
    emit({ phase: 'agent-act', action: entry });

    if (r.ok && MUTATING.has(a.tool)) {
      await new Promise((res) => setTimeout(res, 500));
      break; // trang co the da doi — phai chup lai
    }
  }

  return results;
}

/** Vong lap chinh: nhin -> nghi -> lam -> lap lai. */
async function runAgent({ tabId, goal, maxSteps }) {
  const settings = await getSettings();
  const max = Math.min(Math.max(maxSteps || settings.agentMaxSteps || MAX_STEPS_DEFAULT, 1), 40);
  agentStop.delete(tabId);

  const emit = (e) => chrome.runtime.sendMessage({ type: 'AF_EVENT', ...e }).catch(() => {});
  const turns = [];
  const finish = (status, summary, step) => {
    emit({ phase: 'agent-end', status, summary, steps: step });
    return { status, summary, steps: step, turns };
  };

  emit({ phase: 'agent-start', goal, max });

  for (let step = 1; step <= max; step++) {
    if (agentStop.has(tabId)) return finish('stopped', 'Nguoi dung da dung agent', step - 1);

    emit({ phase: 'agent-look', step, max });
    const snap = await snapshotTab(tabId);
    const { text: map, refMap, count } = renderSnapshot(snap.frames);
    emit({ phase: 'agent-looked', step, count, url: snap.state.url, title: snap.state.title });

    if (!count) return finish('blocked', 'Khong doc duoc element nao tren trang nay', step);

    const user = buildAgentPrompt({
      goal,
      persona: settings.persona,
      language: settings.language,
      state: renderState(snap.state),
      map,
      history: compactHistory(turns),
      step,
      maxSteps: max,
    });

    emit({ phase: 'agent-think', step });
    const t0 = Date.now();
    let plan;
    try {
      const res = await complete({
        settings,
        system: AGENT_SYSTEM,
        user,
        schema: settings.provider === 'chromeai' ? null : AGENT_SCHEMA,
      });
      plan = res.json || {};
    } catch (e) {
      return finish('blocked', `Provider loi: ${e.message}`, step);
    }

    const actions = Array.isArray(plan.actions) ? plan.actions : [];
    emit({
      phase: 'agent-thought',
      step,
      thought: plan.thought || '',
      status: plan.status,
      count: actions.length,
      ms: Date.now() - t0,
    });

    const results = await runActions(tabId, actions, refMap, emit);
    turns.push({ thought: plan.thought, results });

    if (plan.status === 'done') return finish('done', plan.summary || 'Da xong', step);
    if (plan.status === 'blocked') return finish('blocked', plan.summary || 'Khong the di tiep', step);
    if (agentStop.has(tabId)) return finish('stopped', 'Nguoi dung da dung agent', step);
    // Model bao con viec nhung khong lam gi -> tranh lap vo han
    if (!actions.length) return finish('blocked', 'Model khong de xuat hanh dong nao', step);
  }

  return finish('maxsteps', `Het ${max} luot ma chua xong. Tang so luot trong Cai dat neu can.`, max);
}

/* ------------------------------------------------------------- full flow */

async function autofill({ tabId, request, onEvent }) {
  const emit = (e) => {
    onEvent && onEvent(e);
    chrome.runtime.sendMessage({ type: 'AF_EVENT', ...e }).catch(() => {});
  };

  const settings = await getSettings();
  emit({ phase: 'scan', message: 'Dang quet field...' });
  const { fields, context, frames } = await scanTab(tabId, { deep: settings.deepScan });
  emit({ phase: 'scanned', count: fields.length, frames, fields });

  if (!fields.length) throw new Error('Khong tim thay field nao tren trang.');

  emit({ phase: 'generate', message: `Dang hoi ${settings.provider}...` });
  const plan = await generatePlan({ tabId, request, fields, context });
  emit({ phase: 'planned', steps: plan.steps, skipped: plan.skipped, ms: plan.ms, usage: plan.usage });

  emit({ phase: 'run', message: `Dang dien ${plan.steps.length} field...` });
  const results = await runPlan({ tabId, steps: plan.steps });
  const okCount = results.filter((r) => r.ok).length;
  emit({ phase: 'done', results, ok: okCount, total: results.length });

  await setSettings({ lastPrompt: request });
  await pushHistory({ url: context.url, request, ok: okCount, total: results.length });

  // Tu dong ghi nho man hinh nay de lan sau dien lai khong ton mot lan goi AI
  if (settings.autoSaveSnapshot && okCount > 0) {
    try {
      const snap = await memSave({ tabId, auto: true });
      emit({ phase: 'saved', snapshot: { id: snap.id, name: snap.name, count: snap.entries.length } });
    } catch (e) {
      emit({ phase: 'run', message: 'Khong luu duoc bo nho: ' + e.message });
    }
  }

  return { fields, plan, results };
}

/* ------------------------------------------------------------ msg router */

const routes = {
  AF_GET_SETTINGS: () => getSettings(),
  AF_SET_SETTINGS: (m) => setSettings(m.patch),
  AF_RESET_SETTINGS: () => resetSettings(),
  AF_DEFAULTS: () => DEFAULTS,
  AF_PROVIDERS: () => PROVIDERS,

  AF_TEST_PROVIDER: async () => {
    try {
      return await testProvider(await getSettings());
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
  AF_OAUTH_LOGIN: async () => {
    const s = await getSettings();
    try {
      await geminiOAuthLogin(s.gemini);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
  AF_OAUTH_LOGOUT: async () => {
    await geminiOAuthLogout();
    return { ok: true };
  },
  AF_CHROMEAI_STATUS: () => chromeaiAvailability(),
  AF_BRIDGE_HEALTH: async () => bridgeHealth((await getSettings()).bridge),

  AF_SCAN_TAB: (m) => scanTab(m.tabId, { deep: m.deep }),
  AF_GENERATE: (m) => generatePlan(m),
  AF_RUN_PLAN: (m) => runPlan(m),
  AF_AUTOFILL: (m) => autofill(m),

  AF_HIGHLIGHT_TAB: async (m) => {
    const frames = await listFrames(m.tabId);
    for (const f of frames) {
      const mine = (m.fields || []).filter((x) => x.frameId === f.frameId);
      await ask(m.tabId, f.frameId, { type: 'AF_HIGHLIGHT', fields: mine });
    }
    return { ok: true };
  },
  AF_CLEAR_TAB: async (m) => {
    await sendToAllFrames(m.tabId, { type: 'AF_CLEAR' });
    return { ok: true };
  },
  AF_SCROLL_TO: (m) => ask(m.tabId, m.frameId ?? 0, { type: 'AF_SCROLL_TO', id: m.id }),
  AF_RESOLVE: (m) => ask(m.tabId, m.frameId ?? 0, { type: 'AF_RESOLVE', locator: m.locator }),
  AF_STEP_ONE: (m) => ask(m.tabId, m.frameId ?? 0, { type: 'AF_STEP', step: m.step }),

  AF_PICK_TAB: async (m) => {
    const frames = await listFrames(m.tabId);
    for (const f of frames) await ensureInjected(m.tabId, f.frameId);
    // frame nao nguoi dung click truoc thi frame do tra ve
    const answers = await Promise.race([
      Promise.all(frames.map((f) => ask(m.tabId, f.frameId, { type: 'AF_PICK' }))),
      new Promise((r) => setTimeout(() => r(null), 120000)),
    ]);
    const hit = (answers || []).find((a) => a && a.ok && a.picked);
    await sendToAllFrames(m.tabId, { type: 'AF_CLEAR' });
    return hit || { ok: false };
  },

  AF_CDP_ATTACH: async (m) => {
    await CDP.attach(m.tabId);
    return { ok: true };
  },
  AF_CDP_DETACH: async (m) => ({ ok: await CDP.detach(m.tabId) }),
  AF_CDP_STATUS: (m) => ({ attached: CDP.isAttached(m.tabId) }),
  AF_SCREENSHOT: async (m) => ({ ok: true, dataUrl: await CDP.screenshot(m.tabId) }),

  AF_AGENT_RUN: (m) => runAgent(m),
  AF_AGENT_STOP: (m) => {
    agentStop.add(m.tabId);
    return { ok: true };
  },
  AF_SNAPSHOT_TAB: async (m) => {
    const snap = await snapshotTab(m.tabId);
    const { text, count } = renderSnapshot(snap.frames);
    return { ok: true, text, count, state: snap.state };
  },

  AF_MEM_LIST: () => Mem.listSnapshots(),
  AF_MEM_FOR_TAB: async (m) => {
    const { url, title } = await tabUrl(m.tabId);
    return { key: screenKey(url), url, title, snapshots: await Mem.snapshotsFor(url) };
  },
  AF_MEM_SAVE: (m) => memSave(m),
  AF_MEM_PLAN: (m) => memPlan(m),
  AF_MEM_APPLY: (m) => memApply(m),
  AF_MEM_RENAME: (m) => Mem.renameSnapshot(m.id, m.name),
  AF_MEM_DELETE: (m) => Mem.deleteSnapshot(m.id),
  AF_MEM_CLEAR: () => Mem.clearSnapshots(),

  AF_FRAME_READY: () => ({ ok: true }),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fn = routes[msg && msg.type];
  if (!fn) return false;
  const m = { ...msg };
  if (m.tabId == null && sender.tab) m.tabId = sender.tab.id;
  Promise.resolve()
    .then(() => fn(m, sender))
    .then((r) => sendResponse(r ?? { ok: true }))
    .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
  return true;
});

/* Dong CDP khi tab dong de khong ket banner debug */
chrome.tabs.onRemoved.addListener((tabId) => CDP.detach(tabId).catch(() => {}));
