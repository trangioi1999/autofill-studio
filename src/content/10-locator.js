/* Autofill Studio — content/10-locator.js
 * Locator engine kieu Playwright: getByRole / getByLabel / getByPlaceholder /
 * getByText / getByTestId / css / xpath, xuyen shadow DOM, co auto-wait.
 */
(() => {
  const AF = window.__AF__;
  if (!AF || AF.Locator) return;

  /* ------------------------------------------------- accessible name (rut gon) */

  const labelTextOf = (el) => {
    const parts = [];

    // aria-labelledby
    const lb = el.getAttribute && el.getAttribute('aria-labelledby');
    if (lb) {
      const root = el.getRootNode();
      for (const id of lb.split(/\s+/)) {
        const t = root.getElementById ? root.getElementById(id) : document.getElementById(id);
        if (t) parts.push(AF.norm(t.textContent));
      }
      if (parts.length) return parts.join(' ');
    }

    // aria-label
    const al = el.getAttribute && el.getAttribute('aria-label');
    if (al) return AF.norm(al);

    // <label for>
    if (el.id) {
      const root = el.getRootNode();
      let lbl = null;
      try {
        lbl = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      } catch {
        /* noop */
      }
      if (lbl) return AF.norm(lbl.textContent);
    }

    // label bao ngoai
    const wrap = AF.closestDeep(el, 'label');
    if (wrap) {
      const clone = wrap.cloneNode(true);
      clone.querySelectorAll('input,select,textarea,button').forEach((n) => n.remove());
      const t = AF.norm(clone.textContent);
      if (t) return t;
    }

    // Angular Material / PrimeNG / Ant / Bootstrap floating label
    const field = AF.closestDeep(
      el,
      'mat-form-field,.mat-mdc-form-field,.mat-form-field,.p-float-label,.ant-form-item,.form-group,.field,.form-item,.MuiFormControl-root'
    );
    if (field) {
      const lbl = field.querySelector(
        'mat-label,.mat-mdc-floating-label,.mat-form-field-label,label,.ant-form-item-label label,.p-float-label>label,.MuiInputLabel-root'
      );
      if (lbl) {
        const t = AF.norm(lbl.textContent);
        if (t) return t;
      }
    }

    // O nam trong bang (mat-table form): nhan la tieu de cot, khong phai placeholder
    const th = tableHeaderOf(el);
    if (th) return th;

    // placeholder / title / name
    const ph = el.getAttribute && (el.getAttribute('placeholder') || el.getAttribute('title'));
    if (ph) return AF.norm(ph);

    // text ngay truoc do trong cung container
    const prev = el.previousElementSibling;
    if (prev && /^(label|span|div|p|b|strong|legend)$/i.test(prev.tagName)) {
      const t = AF.norm(prev.textContent);
      if (t && t.length <= 120) return t;
    }

    const nameAttr =
      (el.getAttribute && (el.getAttribute('formcontrolname') || el.getAttribute('name'))) || el.name;
    if (nameAttr) return AF.humanize(nameAttr);

    return '';
  };

  /**
   * Input trong <td> cua mat-table / cdk-table: tim <th> cung cot qua class
   * mat-column-X / cdk-column-X, khong co thi theo vi tri cot. Bo dau * bat buoc.
   */
  const tableHeaderOf = (el) => {
    const cell = AF.closestDeep(el, 'td,th,[role="cell"],[role="gridcell"],mat-cell,.mat-mdc-cell,.cdk-cell');
    if (!cell) return '';
    const table = AF.closestDeep(cell, 'table,[role="table"],[role="grid"],mat-table,.mat-mdc-table,.cdk-table');
    if (!table) return '';
    const clean = (t) => AF.norm(String(t || '').replace(/\*/g, '')).slice(0, 140);
    const col = (cell.className || '').match(/(?:mat|cdk)-column-([\w-]+)/);
    if (col) {
      const th = table.querySelector(`.mat-column-${CSS.escape(col[1])}[role="columnheader"], th.mat-column-${CSS.escape(col[1])}, .cdk-column-${CSS.escape(col[1])}[role="columnheader"], th.cdk-column-${CSS.escape(col[1])}, mat-header-cell.mat-column-${CSS.escape(col[1])}`);
      if (th) {
        const t = clean(th.textContent);
        if (t) return t;
      }
    }
    const row = cell.parentElement;
    if (row) {
      const idx = [...row.children].indexOf(cell);
      const head = table.querySelector('thead tr, [role="rowgroup"] [role="row"], mat-header-row, .mat-mdc-header-row');
      const hc = head && head.children[idx];
      if (hc) {
        const t = clean(hc.textContent);
        if (t) return t;
      }
    }
    return '';
  };
  AF.tableHeaderOf = tableHeaderOf;

  AF.accessibleName = (el) => {
    if (!el) return '';
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A' || el.getAttribute('role') === 'button') {
      const al = el.getAttribute('aria-label');
      if (al) return AF.norm(al);
      const t = AF.norm(el.textContent);
      if (t) return t;
      const img = el.querySelector('img[alt]');
      if (img) return AF.norm(img.alt);
    }
    if (tag === 'INPUT' && (el.type === 'submit' || el.type === 'button' || el.type === 'reset')) {
      return AF.norm(el.value || labelTextOf(el));
    }
    return labelTextOf(el);
  };

  /* -------------------------------------------------------------- ARIA role */

  const IMPLICIT_ROLE = {
    A: (el) => (el.hasAttribute('href') ? 'link' : null),
    BUTTON: () => 'button',
    SELECT: (el) => (el.multiple || el.size > 1 ? 'listbox' : 'combobox'),
    TEXTAREA: () => 'textbox',
    IMG: () => 'img',
    H1: () => 'heading',
    H2: () => 'heading',
    H3: () => 'heading',
    H4: () => 'heading',
    H5: () => 'heading',
    H6: () => 'heading',
    NAV: () => 'navigation',
    FORM: () => 'form',
    TABLE: () => 'table',
    UL: () => 'list',
    OL: () => 'list',
    LI: () => 'listitem',
    OPTION: () => 'option',
    PROGRESS: () => 'progressbar',
    DIALOG: () => 'dialog',
    SUMMARY: () => 'button',
  };

  const INPUT_ROLE = {
    button: 'button',
    submit: 'button',
    reset: 'button',
    image: 'button',
    checkbox: 'checkbox',
    radio: 'radio',
    range: 'slider',
    number: 'spinbutton',
    search: 'searchbox',
    email: 'textbox',
    tel: 'textbox',
    text: 'textbox',
    url: 'textbox',
    password: 'textbox',
    date: 'textbox',
    'datetime-local': 'textbox',
    month: 'textbox',
    week: 'textbox',
    time: 'textbox',
    file: 'button',
  };

  AF.roleOf = (el) => {
    if (!el || !el.tagName) return null;
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0].toLowerCase();
    if (el.tagName === 'INPUT') return INPUT_ROLE[el.type] || 'textbox';
    const fn = IMPLICIT_ROLE[el.tagName];
    return fn ? fn(el) : null;
  };

  /* ------------------------------------------------------------- text match */

  const matchStr = (actual, expected, { exact = false } = {}) => {
    if (expected == null) return true;
    if (expected instanceof RegExp) return expected.test(AF.norm(actual));
    const a = AF.slug(actual);
    const b = AF.slug(expected);
    if (!b) return true;
    return exact ? a === b : a.includes(b);
  };
  AF.matchStr = matchStr;

  /* --------------------------------------------------------------- resolve */

  const xpathAll = (expr, root) => {
    const out = [];
    try {
      const doc = root.ownerDocument || document;
      const it = doc.evaluate(expr, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < it.snapshotLength; i++) out.push(it.snapshotItem(i));
    } catch {
      /* xpath loi */
    }
    return out;
  };

  const FOCUSABLE =
    'input,textarea,select,button,a[href],[contenteditable=""],[contenteditable="true"],[tabindex],[role],mat-select,mat-checkbox,mat-radio-button,mat-slide-toggle,[formcontrolname]';

  /**
   * Giai 1 locator -> mang element.
   * locator = {
   *   afId, css, xpath, role, name, label, placeholder, text, testId, value,
   *   exact, nth, within: <locator>
   * }
   */
  function resolveAll(loc, scopeEl = null) {
    if (!loc) return [];
    if (typeof loc === 'string') loc = { css: loc };

    // scope truoc
    let scopes = [scopeEl || document];
    if (loc.within) {
      const s = resolveAll(loc.within, scopeEl);
      if (!s.length) return [];
      scopes = s;
    }

    let out = [];

    for (const scope of scopes) {
      let cands = [];

      if (loc.afId) {
        const el = AF.registry && AF.registry.get(loc.afId);
        if (el && AF.isConnected(el)) cands = [el];
        else cands = [];
      } else if (loc.css) {
        cands = AF.deepQueryAll(loc.css, scope === document ? document : scope);
        if (scope !== document) cands = cands.filter((e) => scope.contains(e) || scope === e);
      } else if (loc.xpath) {
        cands = xpathAll(loc.xpath, scope);
      } else if (loc.testId) {
        const attrs = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa', 'data-automation-id'];
        const sel = attrs.map((a) => `[${a}="${CSS.escape(loc.testId)}"]`).join(',');
        cands = AF.deepQueryAll(sel, scope === document ? document : scope);
      } else {
        // role / label / placeholder / text -> quet rong roi loc
        cands = AF.deepQueryAll(FOCUSABLE + ',label,span,div,p,h1,h2,h3,h4,h5,h6,td,th,li', scope === document ? document : scope);
        if (scope !== document && scope.contains) cands = cands.filter((e) => scope.contains(e));
      }

      if (loc.role) cands = cands.filter((e) => AF.roleOf(e) === String(loc.role).toLowerCase());
      if (loc.name != null) cands = cands.filter((e) => matchStr(AF.accessibleName(e), loc.name, loc));
      if (loc.label != null) cands = cands.filter((e) => matchStr(labelTextOf(e), loc.label, loc));
      if (loc.placeholder != null)
        cands = cands.filter((e) => matchStr(e.getAttribute && e.getAttribute('placeholder'), loc.placeholder, loc));
      if (loc.text != null) cands = cands.filter((e) => matchStr(e.textContent, loc.text, loc));
      if (loc.value != null) cands = cands.filter((e) => matchStr(e.value, loc.value, loc));

      out = out.concat(cands);
    }

    // unique + uu tien element thuc su tuong tac duoc
    out = [...new Set(out)];

    if (!loc.css && !loc.xpath && !loc.afId && out.length > 1) {
      const interactive = out.filter((e) => {
        try {
          return e.matches(FOCUSABLE);
        } catch {
          return false;
        }
      });
      if (interactive.length) out = interactive;
      // bo element cha khi con cung match
      out = out.filter((e) => !out.some((o) => o !== e && e.contains(o)));
    }

    if (typeof loc.nth === 'number') {
      const i = loc.nth < 0 ? out.length + loc.nth : loc.nth;
      out = out[i] ? [out[i]] : [];
    }

    return out;
  }

  AF.Locator = {
    resolveAll,
    resolve: (loc, scope) => resolveAll(loc, scope)[0] || null,

    /** Cho element xuat hien (auto-wait). */
    async wait(loc, { timeout = 5000, state = 'visible' } = {}) {
      return AF.waitFor(
        () => {
          const el = resolveAll(loc)[0];
          if (!el) return null;
          if (state === 'attached') return el;
          if (state === 'visible') return AF.isVisible(el) || AF.isFileInput(el) ? el : null;
          return el;
        },
        { timeout }
      );
    },

    /** Kiem tra "actionability" giong Playwright truoc khi thao tac. */
    async ready(el, { timeout = 5000, requireHit = false } = {}) {
      // radio/checkbox an (opacity:0) trong widget ve tay: xet host thay vi input
      const shown = () => {
        if (AF.isVisible(el) || AF.isFileInput(el)) return true;
        const h = AF.widgetHostOf && AF.widgetHostOf(el);
        return !!(h && AF.isVisible(h));
      };
      const ok = await AF.waitFor(() => AF.isConnected(el) && shown() && AF.isEnabled(el), { timeout });
      if (!ok) return false;
      AF.scrollIntoView(el);
      await AF.waitStable(el, { timeout: 800 });
      if (requireHit && !AF.isHittable(el)) {
        AF.scrollIntoView(el);
        await AF.sleep(80);
      }
      return true;
    },

    /** Sinh mo ta locator ngan gon cho log/UI. */
    describe(loc) {
      if (!loc) return '(null)';
      if (typeof loc === 'string') return `css=${loc}`;
      const bits = [];
      for (const k of ['afId', 'css', 'xpath', 'testId', 'role', 'name', 'label', 'placeholder', 'text']) {
        if (loc[k] != null) bits.push(`${k}=${JSON.stringify(loc[k])}`);
      }
      if (typeof loc.nth === 'number') bits.push(`nth=${loc.nth}`);
      return bits.join(' ') || '(empty)';
    },
  };

  AF.labelTextOf = labelTextOf;
})();
