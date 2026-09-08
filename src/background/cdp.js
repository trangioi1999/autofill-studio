/* AI Autofill Studio — background/cdp.js
 * Driver dung Chrome DevTools Protocol qua chrome.debugger.
 * Khac biet so voi che do DOM: event la "trusted" (isTrusted === true), giong
 * het nguoi that go phim / bam chuot. Dung khi trang co bao ve chat (kiem tra
 * isTrusted, chan synthetic event) hoac khi can upload file that tu dia.
 *
 * Danh doi: Chrome hien thanh vang "... dang go loi trinh duyet nay".
 */

const attached = new Set();
const VERSION = '1.3';

function send(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(`${method}: ${err.message}`));
      else resolve(result);
    });
  });
}

export async function attach(tabId) {
  if (attached.has(tabId)) return true;
  await new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, VERSION, () => {
      const err = chrome.runtime.lastError;
      if (err && !/already attached/i.test(err.message)) reject(new Error(err.message));
      else resolve();
    });
  });
  attached.add(tabId);
  await send(tabId, 'DOM.enable').catch(() => {});
  await send(tabId, 'Runtime.enable').catch(() => {});
  return true;
}

export async function detach(tabId) {
  if (!attached.has(tabId)) return false;
  attached.delete(tabId);
  await new Promise((resolve) => chrome.debugger.detach({ tabId }, () => resolve()));
  return true;
}

export const isAttached = (tabId) => attached.has(tabId);

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) attached.delete(source.tabId);
});

/* ------------------------------------------------------- tim node theo afId */

const MARK = 'data-af-cdp';

/** Content script danh dau element, CDP tim lai bang attribute do. */
async function markAndLocate(tabId, frameId, afId) {
  const mark = `af-${Math.random().toString(36).slice(2, 10)}`;
  const res = await chrome.tabs.sendMessage(
    tabId,
    { type: 'AF_CDP_MARK', afId, mark, attr: MARK },
    frameId != null ? { frameId } : undefined
  );
  if (!res || !res.ok) throw new Error(res?.error || 'Khong danh dau duoc element');
  const { root } = await send(tabId, 'DOM.getDocument', { depth: -1, pierce: true });
  const { nodeId } = await send(tabId, 'DOM.querySelector', {
    nodeId: root.nodeId,
    selector: `[${MARK}="${mark}"]`,
  });
  if (!nodeId) throw new Error('CDP khong thay element (co the nam trong closed shadow DOM)');
  return { nodeId, rect: res.rect, mark };
}

async function centerOf(tabId, nodeId, fallbackRect) {
  try {
    const { model } = await send(tabId, 'DOM.getBoxModel', { nodeId });
    const q = model.content; // [x1,y1,x2,y2,x3,y3,x4,y4]
    return { x: (q[0] + q[4]) / 2, y: (q[1] + q[5]) / 2 };
  } catch {
    if (!fallbackRect) throw new Error('Khong lay duoc toa do element');
    return { x: fallbackRect.x + fallbackRect.w / 2, y: fallbackRect.y + fallbackRect.h / 2 };
  }
}

/* ---------------------------------------------------------------- hanh dong */

export async function click(tabId, frameId, afId) {
  await attach(tabId);
  const { nodeId, rect } = await markAndLocate(tabId, frameId, afId);
  await send(tabId, 'DOM.scrollIntoViewIfNeeded', { nodeId }).catch(() => {});
  const { x, y } = await centerOf(tabId, nodeId, rect);
  const base = { x, y, button: 'left', clickCount: 1, buttons: 1 };
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 });
  return { ok: true };
}

export async function pressKey(tabId, key, modifiers = 0) {
  await attach(tabId);
  const MAP = {
    Enter: { windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter', text: '\r' },
    Tab: { windowsVirtualKeyCode: 9, key: 'Tab', code: 'Tab' },
    Escape: { windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' },
    Backspace: { windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' },
    Delete: { windowsVirtualKeyCode: 46, key: 'Delete', code: 'Delete' },
    ArrowDown: { windowsVirtualKeyCode: 40, key: 'ArrowDown', code: 'ArrowDown' },
    ArrowUp: { windowsVirtualKeyCode: 38, key: 'ArrowUp', code: 'ArrowUp' },
    a: { windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' },
  };
  const k = MAP[key] || { windowsVirtualKeyCode: 0, key, code: key };
  await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', modifiers, ...k });
  await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...k });
  return { ok: true };
}

/** Go text that su: focus bang chuot -> Ctrl+A -> Delete -> insertText. */
export async function typeInto(tabId, frameId, afId, text) {
  await attach(tabId);
  await click(tabId, frameId, afId);
  await pressKey(tabId, 'a', 2 /* Ctrl */);
  await pressKey(tabId, 'Delete');
  await send(tabId, 'Input.insertText', { text: String(text ?? '') });
  // mot so framework chi commit khi blur
  await pressKey(tabId, 'Tab');
  return { ok: true };
}

/** Go tung ky tu — can cho autocomplete phan ung theo tung phim. */
export async function typeSlow(tabId, frameId, afId, text, delay = 30) {
  await attach(tabId);
  await click(tabId, frameId, afId);
  await pressKey(tabId, 'a', 2);
  await pressKey(tabId, 'Delete');
  for (const ch of String(text ?? '')) {
    await send(tabId, 'Input.dispatchKeyEvent', { type: 'char', text: ch, key: ch });
    if (delay) await new Promise((r) => setTimeout(r, delay));
  }
  return { ok: true };
}

/**
 * Upload file that tu dia — thu ma che do DOM khong lam duoc.
 * paths = duong dan tuyet doi tren may cua ban.
 */
export async function setFiles(tabId, frameId, afId, paths) {
  await attach(tabId);
  const { nodeId } = await markAndLocate(tabId, frameId, afId);
  await send(tabId, 'DOM.setFileInputFiles', { nodeId, files: paths });
  return { ok: true, files: paths.length };
}

/** Chup anh man hinh tab — dung cho log "truoc/sau" giong Playwright trace. */
export async function screenshot(tabId) {
  await attach(tabId);
  const { data } = await send(tabId, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).catch(
    async () => {
      await send(tabId, 'Page.enable');
      return send(tabId, 'Page.captureScreenshot', { format: 'png' });
    }
  );
  return `data:image/png;base64,${data}`;
}

/** Chay 1 step qua CDP. Cac action khong ho tro se tra ve fallback:true. */
export async function runStep(tabId, step) {
  const frameId = step.frameId ?? 0;
  switch (step.action) {
    case 'fill':
      if (step.kind && /select|combobox|radio|checkbox|toggle|file/.test(step.kind)) return { fallback: true };
      await typeInto(tabId, frameId, step.afId, step.value);
      return { ok: true, via: 'cdp' };
    case 'type':
      await typeSlow(tabId, frameId, step.afId, step.value, step.delay ?? 30);
      return { ok: true, via: 'cdp' };
    case 'click':
      await click(tabId, frameId, step.afId);
      return { ok: true, via: 'cdp' };
    case 'press':
      await pressKey(tabId, step.value || 'Enter');
      return { ok: true, via: 'cdp' };
    case 'upload': {
      const paths = (Array.isArray(step.value) ? step.value : [step.value])
        .map((v) => (typeof v === 'string' ? v : v && v.path))
        .filter(Boolean);
      if (!paths.length) return { fallback: true }; // khong co duong dan that -> dung DOM
      await setFiles(tabId, frameId, step.afId, paths);
      return { ok: true, via: 'cdp' };
    }
    default:
      return { fallback: true };
  }
}
