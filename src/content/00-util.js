/* Autofill Studio — content/00-util.js
 * Namespace dung chung cho tat ca content scripts (classic scripts, khong phai module).
 */
(() => {
  if (window.__AF__) return;

  const AF = (window.__AF__ = {});

  AF.VERSION = '0.1.0';
  AF.frameUrl = location.href;

  /* ---------------------------------------------------------------- basics */

  AF.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  AF.uid = (() => {
    let n = 0;
    return (p = 'e') => `${p}${(++n).toString(36)}`;
  })();

  AF.norm = (s) =>
    (s == null ? '' : String(s))
      .replace(/[​-‍﻿]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  AF.lower = (s) => AF.norm(s).toLowerCase();

  /** Bo dau tieng Viet + lowercase — de match label "Họ và tên" voi "ho va ten". */
  AF.slug = (s) =>
    AF.lower(s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  /** Tach camelCase / snake_case / kebab-case thanh tu co nghia. */
  AF.humanize = (s) =>
    AF.norm(
      String(s || '')
        .replace(/[_\-.]+/g, ' ')
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    );

  /* ------------------------------------------------------------- DOM utils */

  /** Tat ca root cua frame nay: document + moi open shadowRoot (de quy). */
  AF.allRoots = (root = document) => {
    const roots = [root];
    const seen = new Set();
    const walk = (r) => {
      let els;
      try {
        els = r.querySelectorAll('*');
      } catch {
        return;
      }
      for (const el of els) {
        const sr = el.shadowRoot;
        if (sr && !seen.has(sr)) {
          seen.add(sr);
          roots.push(sr);
          walk(sr);
        }
      }
    };
    walk(root);
    return roots;
  };

  /** querySelectorAll xuyen shadow DOM. */
  AF.deepQueryAll = (selector, root = document) => {
    const out = [];
    for (const r of AF.allRoots(root)) {
      let found;
      try {
        found = r.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const el of found) out.push(el);
    }
    return out;
  };

  AF.deepQuery = (selector, root = document) => AF.deepQueryAll(selector, root)[0] || null;

  /** getRootNode().host chain — de tim "cha" that su khi element nam trong shadow DOM. */
  AF.composedParent = (el) => {
    if (!el) return null;
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode();
    if (root instanceof ShadowRoot) return root.host;
    return null;
  };

  AF.ancestors = (el, max = 30) => {
    const out = [];
    let cur = AF.composedParent(el);
    while (cur && out.length < max) {
      out.push(cur);
      cur = AF.composedParent(cur);
    }
    return out;
  };

  AF.closestDeep = (el, selector) => {
    let cur = el;
    while (cur) {
      try {
        if (cur.matches && cur.matches(selector)) return cur;
      } catch {
        /* selector loi */
      }
      cur = AF.composedParent(cur);
    }
    return null;
  };

  /* --------------------------------------------------- visibility / bounds */

  AF.isConnected = (el) => !!(el && el.isConnected);

  AF.rectOf = (el) => {
    try {
      return el.getBoundingClientRect();
    } catch {
      return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
    }
  };

  AF.isVisible = (el) => {
    if (!AF.isConnected(el)) return false;
    // input[type=file] thuong bi an co y — van coi la "co the tac dong" qua CDP/DOM.
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (style.display === 'none') return false;
    if (Number(style.opacity) === 0) return false;
    const r = AF.rectOf(el);
    if (r.width <= 0 || r.height <= 0) {
      // host inline / display:contents (mat-radio-group) khong co kich thuoc
      // rieng nhung con cua no thi co -> van la nhin thay
      if (el.children && el.children.length && !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
        for (const c of el.children) {
          const cr = AF.rectOf(c);
          if (cr.width > 0 && cr.height > 0) return true;
        }
      }
      return false;
    }
    return true;
  };

  /**
   * Input radio/checkbox cua Material (MDC), PrimeNG, Ant... bi an bang
   * opacity:0 va nam de len widget ve tay. Tra ve widget nhin thay duoc
   * bao quanh no, hoac null neu day la input binh thuong.
   */
  AF.widgetHostOf = (el) => {
    if (!el || el.tagName !== 'INPUT' || !/^(radio|checkbox)$/.test(el.type)) return null;
    return AF.closestDeep(
      el,
      'mat-radio-button,mat-checkbox,mat-slide-toggle,.mdc-radio,.mdc-checkbox,.mdc-switch,.mdc-form-field,' +
        '.p-radiobutton,.p-checkbox,.ant-radio,.ant-checkbox,.ant-radio-wrapper,.ant-checkbox-wrapper,.MuiRadio-root,.MuiCheckbox-root,.form-check,label'
    );
  };

  AF.isFileInput = (el) => el && el.tagName === 'INPUT' && el.type === 'file';

  AF.isEnabled = (el) => {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    if (el.readOnly) return false;
    const fs = AF.closestDeep(el, 'fieldset[disabled]');
    if (fs) return false;
    return true;
  };

  /** Element o vi tri trung tam co bi che khong (hit-test giong Playwright). */
  AF.isHittable = (el) => {
    const r = AF.rectOf(el);
    if (r.width <= 0 || r.height <= 0) return false;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    let top = document.elementFromPoint(x, y);
    // xuyen qua shadow DOM
    let guard = 0;
    while (top && top.shadowRoot && guard++ < 10) {
      const inner = top.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === top) break;
      top = inner;
    }
    if (!top) return false;
    return el === top || el.contains(top) || (top.contains && top.contains(el));
  };

  AF.reducedMotion = () => {
    try {
      return matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  };

  /** Element da nam gon trong khung nhin (chua le mep) chua? */
  AF.inViewport = (el, margin = 48) => {
    const r = AF.rectOf(el);
    if (r.width <= 0 && r.height <= 0) return false;
    return r.top >= margin && r.bottom <= innerHeight - margin && r.left >= 0 && r.right <= innerWidth;
  };

  /**
   * Cuon toi element. Chi cuon khi no chua nam trong khung nhin — truoc day
   * moi buoc deu nhay "center" tuc thi nen trang giat lien tuc. Cuon muot va
   * doi cho on dinh roi moi tra ve; { instant: true } de cuon ngay (CDP can
   * toa do dung ngay lap tuc).
   */
  AF.scrollIntoView = async (el, { instant = false } = {}) => {
    if (AF.inViewport(el)) return false;
    const smooth = !instant && !AF.reducedMotion();
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: smooth ? 'smooth' : 'instant' });
    } catch {
      try {
        el.scrollIntoView();
      } catch {
        /* noop */
      }
    }
    if (smooth) await AF.waitStable(el, { timeout: 700 });
    return true;
  };

  /**
   * Cho den khi predicate() true. Tra ve gia tri predicate hoac null neu timeout.
   * Day la "auto-waiting" kieu Playwright.
   */
  AF.waitFor = async (predicate, { timeout = 5000, interval = 60 } = {}) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      let v;
      try {
        v = await predicate();
      } catch {
        v = null;
      }
      if (v) return v;
      if (Date.now() > deadline) return null;
      await AF.sleep(interval);
    }
  };

  /** Cho element on dinh vi tri (khong con animate) — tranh click hut. */
  AF.waitStable = async (el, { timeout = 2000 } = {}) => {
    let last = null;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const r = AF.rectOf(el);
      const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
      if (last === key) return true;
      last = key;
      await AF.sleep(50);
    }
    return false;
  };

  /* --------------------------------------------------------------- logging */

  AF.log = (...a) => {
    if (AF.debug) console.log('%c[AF]', 'color:#7c5cff;font-weight:bold', ...a);
  };
  AF.debug = false;

  AF.err = (e) => (e && e.message ? e.message : String(e));
})();
