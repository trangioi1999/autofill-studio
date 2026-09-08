/* Autofill Studio — content/99-main.js
 * Cau noi giua service worker / side panel / DevTools panel voi frame nay.
 */
(() => {
  const AF = window.__AF__;
  if (!AF || AF.__wired) return;
  AF.__wired = true;

  const handlers = {
    AF_PING: () => ({ ok: true, url: location.href, version: AF.VERSION, frames: frames.length }),

    AF_SCAN: () => ({ ok: true, fields: AF.Scanner.scan(), context: AF.Scanner.pageContext() }),

    AF_DEEP_SCAN: async () => ({
      ok: true,
      fields: await AF.Scanner.deepScan(),
      context: AF.Scanner.pageContext(),
    }),

    AF_CONTEXT: () => ({ ok: true, context: AF.Scanner.pageContext() }),

    /* ------------------------------------------------------------- agent */

    AF_SNAPSHOT: (msg) => ({
      ok: true,
      nodes: AF.Snapshot.capture({ max: msg.max || 150, interactiveOnly: !!msg.interactiveOnly }),
      state: AF.Snapshot.pageState(),
    }),

    AF_READ: (msg) => ({ ok: true, text: AF.Snapshot.readText(msg.query) }),

    AF_WAIT_TEXT: async (msg) => ({
      ok: await AF.Snapshot.waitForText(msg.text || '', msg.timeout || 8000),
    }),

    AF_SCROLL_PAGE: (msg) => {
      const by = msg.direction === 'up' ? -Math.round(innerHeight * 0.8) : Math.round(innerHeight * 0.8);
      window.scrollBy({ top: by, behavior: 'instant' });
      return { ok: true, scrollY: Math.round(window.scrollY) };
    },

    AF_RUN: async (msg) => {
      const results = await AF.Actions.runPlan(msg.steps || [], msg.options || {});
      return { ok: true, results };
    },

    AF_STEP: async (msg) => ({ ok: true, result: await AF.Actions.runStep(msg.step) }),

    AF_HIGHLIGHT: (msg) => {
      AF.Picker.highlightFields(msg.fields || AF.Scanner.scan());
      return { ok: true };
    },

    AF_CLEAR: () => {
      AF.Picker.clear();
      AF.Picker.stopPick();
      return { ok: true };
    },

    AF_SCROLL_TO: (msg) => ({ ok: AF.Picker.scrollTo(msg.id) }),

    AF_PICK: () =>
      new Promise((resolve) => {
        AF.Picker.startPick((info) => resolve({ ok: !!info, picked: info }));
      }),

    /** Thu 1 locator giong `page.locator(...).count()` cua Playwright. */
    AF_RESOLVE: (msg) => {
      const els = AF.Locator.resolveAll(msg.locator);
      return {
        ok: true,
        count: els.length,
        matches: els.slice(0, 20).map((el) => ({
          id: AF.idFor(el),
          tag: el.tagName.toLowerCase(),
          label: AF.accessibleName(el),
          selector: AF.cssPath(el),
          visible: AF.isVisible(el),
          enabled: AF.isEnabled(el),
        })),
      };
    },

    /** Danh dau element bang attribute tam de CDP tim lai duoc bang selector. */
    AF_CDP_MARK: (msg) => {
      const el = AF.registry.get(msg.afId);
      if (!el || !AF.isConnected(el)) return { ok: false, error: 'Element khong con ton tai' };
      // don dau cu
      AF.deepQueryAll(`[${msg.attr}]`).forEach((n) => n.removeAttribute(msg.attr));
      el.setAttribute(msg.attr, msg.mark);
      AF.scrollIntoView(el);
      const r = AF.rectOf(el);
      return {
        ok: true,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        tag: el.tagName.toLowerCase(),
      };
    },

    AF_DEBUG: (msg) => {
      AF.debug = !!msg.on;
      return { ok: true, debug: AF.debug };
    },
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const fn = handlers[msg && msg.type];
    if (!fn) return false;
    Promise.resolve()
      .then(() => fn(msg))
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: AF.err(e) }));
    return true; // async
  });

  // Bao cho service worker biet frame nay da san sang
  try {
    chrome.runtime.sendMessage({ type: 'AF_FRAME_READY', url: location.href });
  } catch {
    /* SW co the chua chay */
  }
})();
