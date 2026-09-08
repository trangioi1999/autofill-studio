/* Autofill Studio — content/50-snapshot.js
 * Chup mot "ban do" cua trang cho AI doc, kieu accessibility snapshot cua
 * Playwright: moi element tuong tac duoc mot dong, co ref de goi lai.
 *
 * Khac voi Scanner (chi quan tam o nhap lieu), snapshot con lay ca nut, link,
 * tab, menu, dialog... vi agent can dieu huong chu khong chi dien.
 */
(() => {
  const AF = window.__AF__;
  if (!AF || AF.Snapshot) return;

  const INTERACTIVE = [
    'a[href]', 'button', 'input', 'textarea', 'select', 'summary',
    '[contenteditable=""]', '[contenteditable="true"]',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
    '[role="checkbox"]', '[role="switch"]', '[role="radio"]', '[role="option"]',
    '[role="combobox"]', '[role="listbox"]', '[role="textbox"]', '[role="spinbutton"]',
    '[role="slider"]', '[role="searchbox"]',
    'mat-select', 'mat-checkbox', 'mat-slide-toggle', 'mat-radio-button',
    'p-dropdown', 'p-multiselect', 'p-checkbox', 'p-inputswitch', 'p-calendar',
    'nz-select', 'nz-switch', 'ng-select',
    '[onclick]', '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const LANDMARK = 'h1,h2,h3,h4,legend,[role="heading"],[role="alert"],[role="status"],label';

  const roleFor = (el) => {
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit.toLowerCase();
    const r = AF.roleOf(el);
    if (r) return r;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return el.multiple ? 'listbox' : 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
      if (t === 'file') return 'file';
      if (t === 'range') return 'slider';
      if (t === 'number') return 'spinbutton';
      if (t === 'search') return 'searchbox';
      return 'textbox';
    }
    if (/^(mat-select|p-dropdown|nz-select|ng-select)$/.test(tag)) return 'combobox';
    if (/^(mat-checkbox|p-checkbox|nz-checkbox)$/.test(tag)) return 'checkbox';
    if (/^(mat-slide-toggle|p-inputswitch|nz-switch)$/.test(tag)) return 'switch';
    if (el.isContentEditable) return 'textbox';
    return 'generic';
  };

  /** Gia tri hien tai, gon nhat co the. */
  const valueOf = (el, role) => {
    if (role === 'checkbox' || role === 'switch' || role === 'radio') {
      if (typeof el.checked === 'boolean') return el.checked ? 'checked' : '';
      return el.getAttribute('aria-checked') === 'true' ? 'checked' : '';
    }
    if (el.isContentEditable) return AF.norm(el.textContent).slice(0, 80);
    // <select> that: lay nhan cua option dang chon, bo option placeholder
    if (el.tagName === 'SELECT') {
      return [...(el.selectedOptions || [])]
        .filter((o) => o.value !== '' && !o.disabled)
        .map((o) => AF.norm(o.textContent) || o.value)
        .join(', ')
        .slice(0, 80);
    }
    if (typeof el.value === 'string' && el.value) return AF.norm(el.value).slice(0, 80);
    // dropdown custom: doc phan trigger (dung chung logic voi Scanner)
    if (role === 'combobox' || role === 'listbox') {
      return (AF.triggerText ? AF.triggerText(el) : '').slice(0, 80);
    }
    return '';
  };

  /** Nut/link thi lay chinh text cua no lam ten. */
  const nameOf = (el, role) => {
    let n = AF.accessibleName(el);
    if (!n && (role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem')) {
      n = AF.norm(el.textContent).slice(0, 80);
    }
    if (!n) n = AF.norm(el.getAttribute?.('placeholder') || el.getAttribute?.('title') || '');
    return n.slice(0, 100);
  };

  /* Bo qua element chi la vo boc cua mot element tuong tac khac. */
  const isWrapperOf = (el) => {
    const inner = el.querySelector?.('input,textarea,select,button,a[href]');
    if (!inner) return false;
    // mat-checkbox bao input that su -> giu vo boc, bo input ben trong
    return false;
  };

  AF.Snapshot = {
    /**
     * Tra ve danh sach node phang. Service worker se danh so ref e1..eN sau,
     * vi no moi nhin thay het cac frame.
     */
    capture({ max = 150, interactiveOnly = false } = {}) {
      const out = [];
      const seen = new Set();

      const push = (el, kind) => {
        if (!el || seen.has(el)) return;
        if (!AF.isVisible(el)) return;
        seen.add(el);

        const role = roleFor(el);
        const name = nameOf(el, role);
        const value = valueOf(el, role);

        // Khong ten, khong gia tri, khong phai o nhap -> vo nghia voi model
        if (!name && !value && !['textbox', 'combobox', 'file', 'searchbox'].includes(role)) return;

        out.push({
          afId: AF.idFor(el),
          kind,
          role,
          tag: el.tagName.toLowerCase(),
          name,
          value,
          href: el.tagName === 'A' ? (el.getAttribute('href') || '').slice(0, 120) : '',
          required: !!(el.required || el.getAttribute?.('aria-required') === 'true'),
          disabled: !AF.isEnabled(el),
          top: Math.round(AF.rectOf(el).top),
        });
      };

      for (const el of AF.deepQueryAll(INTERACTIVE)) {
        if (out.length >= max) break;
        const t = (el.type || '').toLowerCase();
        if (el.tagName === 'INPUT' && t === 'hidden') continue;
        // input an ben trong widget custom: bo, giu lai vo boc
        if (AF.closestDeep(AF.composedParent(el), 'mat-select,mat-checkbox,mat-slide-toggle,p-dropdown,p-multiselect,p-checkbox,nz-select,ng-select')) continue;
        if (isWrapperOf(el)) continue;
        push(el, 'control');
      }

      if (!interactiveOnly) {
        // Ten cua control da co roi thi dong chu trung lap chi ton token
        const taken = new Set(out.map((n) => AF.slug(n.name)).filter(Boolean));
        for (const el of AF.deepQueryAll(LANDMARK)) {
          if (out.length >= max + 40) break;
          if (el.tagName === 'LABEL') continue; // nhan da nam trong accessibleName roi
          const before = out.length;
          push(el, 'text');
          const added = out[out.length - 1];
          if (out.length > before && taken.has(AF.slug(added.name))) out.pop();
        }
      }

      // Sap theo vi tri tren trang cho giong thu tu doc
      out.sort((a, b) => a.top - b.top);
      return out;
    },

    /** Trang thai chung cua trang, de agent biet minh dang o dau. */
    pageState() {
      const dialog = AF.deepQuery('[role="dialog"],[role="alertdialog"],dialog[open],.cdk-overlay-pane,.ant-modal');
      const alerts = AF.deepQueryAll('[role="alert"],.mat-mdc-form-field-error,.ant-form-item-explain-error,.invalid-feedback')
        .filter(AF.isVisible)
        .map((n) => AF.norm(n.textContent))
        .filter(Boolean)
        .slice(0, 8);
      return {
        url: location.href,
        title: document.title,
        scrollY: Math.round(window.scrollY),
        scrollMax: Math.round(Math.max(0, document.body.scrollHeight - window.innerHeight)),
        dialogOpen: !!(dialog && AF.isVisible(dialog)),
        errors: alerts,
      };
    },

    /** Doc chu tren trang, cho tool "read". */
    readText(query) {
      const body = AF.norm(document.body?.innerText || '');
      if (!query) return body.slice(0, 3000);
      const q = AF.slug(query);
      const lines = body.split(/(?<=[.!?])\s+|\n+/).filter((l) => AF.slug(l).includes(q));
      return (lines.length ? lines.join('\n') : body).slice(0, 3000);
    },

    /** Cho tới khi mot doan chu xuat hien — tool "wait". */
    async waitForText(text, timeout = 8000) {
      const q = AF.slug(text);
      const ok = await AF.waitFor(() => AF.slug(document.body?.innerText || '').includes(q), { timeout });
      return !!ok;
    },
  };
})();
