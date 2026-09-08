/* AI Autofill Studio — background/service-worker.js
 * Dieu phoi: quet field tren moi frame, goi AI, chay ke hoach (DOM hoac CDP).
 */
import { getSettings, setSettings, resetSettings, pushHistory, DEFAULTS } from '../lib/storage.js';
import { SYSTEM_PROMPT, PLAN_SCHEMA, buildUserPrompt, planToSteps } from '../lib/prompt.js';
import { complete, testProvider, geminiOAuthLogin, geminiOAuthLogout, chromeaiAvailability, bridgeHealth, PROVIDERS } from '../providers/index.js';
import * as CDP from './cdp.js';

/* ------------------------------------------------------------------ setup */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'af-open', title: 'AI Autofill: mo bang dieu khien', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'af-fill', title: 'AI Autofill: dien form nay', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'af-pick', title: 'AI Autofill: chon element (inspect)', contexts: ['all'] });
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
