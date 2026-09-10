/* Autofill Studio — content/20-scanner.js
 * Quet toan bo field tren frame: input chuan, contenteditable, va cac widget
 * custom cua Angular Material / PrimeNG / Ant / MUI / headless UI.
 */
(() => {
  const AF = window.__AF__;
  if (!AF || AF.Scanner) return;

  AF.registry = new Map(); // afId -> element
  const backref = new WeakMap(); // element -> afId

  const idFor = (el) => {
    let id = backref.get(el);
    if (id && AF.registry.get(id) === el) return id;
    id = AF.uid('n');
    backref.set(el, id);
    AF.registry.set(id, el);
    return id;
  };
  AF.idFor = idFor;

  /* ------------------------------------------------------- selector for UI */

  const cssPath = (el, maxDepth = 6) => {
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth++ < maxDepth) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) {
        parts.unshift(`#${cur.id}`);
        break;
      }
      const fc = cur.getAttribute && cur.getAttribute('formcontrolname');
      if (fc) part += `[formcontrolname="${fc}"]`;
      else if (cur.getAttribute && cur.getAttribute('name')) part += `[name="${cur.getAttribute('name')}"]`;
      else {
        const cls = (cur.className && typeof cur.className === 'string' ? cur.className : '')
          .split(/\s+/)
          .filter((c) => c && !/^ng-|^cdk-|^mat-mdc-|^_ngcontent|^_nghost/.test(c))
          .slice(0, 2);
        if (cls.length) part += '.' + cls.join('.');
        const parent = AF.composedParent(cur);
        if (parent) {
          const sameTag = [...parent.children].filter((c) => c.tagName === cur.tagName);
          if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
        }
      }
      parts.unshift(part);
      const p = AF.composedParent(cur);
      if (!p || p === document.body || p === document.documentElement) break;
      cur = p;
    }
    return parts.join(' > ');
  };
  AF.cssPath = cssPath;

  /* ----------------------------------------------------------- classify */

  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

  /* Angular Material va cac thu vien tuong tu bien <input> thanh dropdown
     (matAutocomplete) hoac datepicker (matDatepicker). Phai nhan ra truoc khi
     coi no la o text thuong, neu khong AI se go chu vao ma khong chon option. */
  const DATE_PH = /(^|[^a-z])(dd|mm|yyyy|yy)([\/.\-]|$)/i;

  const isDatepickerInput = (el) => {
    const cls = el.className || '';
    if (/mat-datepicker-input|datepicker-input|p-inputtext.*p-calendar|\bdatepicker\b|flatpickr-input|hasDatepicker/i.test(cls)) return true;
    if (el.hasAttribute('matdatepicker') || el.hasAttribute('data-provide') && /datepicker/i.test(el.getAttribute('data-provide'))) return true;
    if (DATE_PH.test(el.getAttribute('placeholder') || '')) return true;
    if (AF.closestDeep(AF.composedParent(el), 'p-calendar,mat-datepicker,.mat-datepicker,.datepicker,.react-datepicker-wrapper,.ant-picker')) return true;
    if (el.getAttribute('aria-haspopup') === 'dialog') {
      const ff = AF.closestDeep(el, 'mat-form-field,.mat-mdc-form-field,.form-group');
      if (ff && ff.querySelector('mat-datepicker-toggle,.mat-datepicker-toggle,[aria-label*="calendar" i],[aria-label*="lich" i]')) return true;
    }
    return false;
  };

  const isAutocompleteInput = (el) => {
    const role = el.getAttribute('role');
    const ac = el.getAttribute('aria-autocomplete');
    if (role === 'combobox' || ac === 'list' || ac === 'both') return true;
    if (el.getAttribute('aria-haspopup') === 'listbox') return true;
    if (/autocomplete-trigger|chip-input|ng-input|select__input|ant-select-selection-search-input|MuiAutocomplete-input|vs__search|select2-search__field|choices__input/i.test(el.className || '')) return true;
    if (el.hasAttribute('matautocomplete') || el.hasAttribute('matchipinputfor')) return true;
    if (AF.closestDeep(AF.composedParent(el), '.ng-select,.ant-select,.MuiAutocomplete-root,.select2-container,.choices,.v-select,.el-select,.p-autocomplete')) return true;
    return false;
  };

  /** Input autocomplete gan chip (mat-chip-grid) = chon nhieu. */
  const isMultiAutocomplete = (el) => {
    if (el.getAttribute('aria-multiselectable') === 'true') return true;
    if (/chip-input/i.test(el.className || '') || el.hasAttribute('matchipinputfor')) return true;
    if (AF.closestDeep(AF.composedParent(el), 'mat-chip-grid,mat-chip-list,.mat-mdc-chip-grid,.mat-chip-list,.ng-select-multiple,.ant-select-multiple,.p-autocomplete-multiple')) return true;
    const prev = el.previousElementSibling;
    if (prev && /^(MAT-CHIP-GRID|MAT-CHIP-LIST)$/.test(prev.tagName)) return true;
    const root = AF.closestDeep(el, '.MuiAutocomplete-root');
    if (root && root.querySelector('.MuiChip-root')) return true;
    return false;
  };

  const kindOf = (el) => {
    const tag = el.tagName;
    const role = AF.roleOf(el);

    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'SELECT') return el.multiple ? 'multiselect' : 'select';
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'file') return 'file';
      if (t === 'range') return 'range';
      if (t === 'color') return 'color';
      if (['date', 'datetime-local', 'month', 'week', 'time'].includes(t)) return 'date';
      if (t === 'number') return 'number';
      if (t === 'text' || t === 'search' || !el.getAttribute('type')) {
        if (isDatepickerInput(el)) return 'datepicker';
        if (isAutocompleteInput(el)) return isMultiAutocomplete(el) ? 'multiselect-custom' : 'combobox';
      }
      return 'text';
    }
    if (el.isContentEditable) return 'editor';

    // widget custom
    const tagLower = tag.toLowerCase();
    if (/^(mat-select|p-dropdown|p-multiselect|nz-select|ng-select)$/.test(tagLower))
      return el.hasAttribute('multiple') || /multiselect/.test(tagLower) ? 'multiselect-custom' : 'combobox';
    if (/^(mat-checkbox|p-checkbox|nz-checkbox)$/.test(tagLower)) return 'checkbox-custom';
    if (/^(mat-slide-toggle|p-inputswitch|nz-switch)$/.test(tagLower)) return 'toggle';
    if (/^(mat-radio-group|nz-radio-group)$/.test(tagLower)) return 'radiogroup';
    if (/^(mat-datepicker-toggle|p-calendar)$/.test(tagLower)) return 'datepicker';

    if (role === 'combobox' || role === 'listbox') return 'combobox';
    if (role === 'checkbox' || role === 'switch') return 'checkbox-custom';
    if (role === 'radiogroup') return 'radiogroup';
    if (role === 'textbox') return 'text';

    return null;
  };

  /* ------------------------------------------------------------- context */

  const sectionOf = (el) => {
    const fs = AF.closestDeep(el, 'fieldset');
    if (fs) {
      const lg = fs.querySelector('legend');
      if (lg) return AF.norm(lg.textContent).slice(0, 120);
    }
    const card = AF.closestDeep(el, 'mat-card,section,.card,.panel,.ant-card,.MuiCard-root,[role="group"],[role="region"]');
    if (card) {
      const h = card.querySelector('mat-card-title,h1,h2,h3,h4,legend,.card-title,.panel-title,[role="heading"]');
      if (h) return AF.norm(h.textContent).slice(0, 120);
      const al = card.getAttribute('aria-label');
      if (al) return AF.norm(al).slice(0, 120);
    }
    // heading gan nhat phia tren
    const all = AF.deepQueryAll('h1,h2,h3,h4,legend');
    let best = null;
    const top = AF.rectOf(el).top;
    for (const h of all) {
      const r = AF.rectOf(h);
      if (r.top <= top && (!best || r.top > AF.rectOf(best).top)) best = h;
    }
    return best ? AF.norm(best.textContent).slice(0, 120) : '';
  };

  const helpTextOf = (el) => {
    const field = AF.closestDeep(el, 'mat-form-field,.mat-mdc-form-field,.form-group,.ant-form-item,.field,.MuiFormControl-root');
    if (!field) return '';
    const hint = field.querySelector('mat-hint,.mat-mdc-form-field-hint,.form-text,.ant-form-item-extra,.MuiFormHelperText-root,small');
    return hint ? AF.norm(hint.textContent).slice(0, 160) : '';
  };

  /* --------------------------------------------------- gia tri dang hien thi */

  /**
   * Voi dropdown custom (mat-select, p-dropdown, ng-select...) thi el.value
   * rong; gia tri that nam o phan text cua trigger. Doc no de con luu lai
   * duoc vao bo nho man hinh.
   */
  // Cac glyph mui ten / dau x cua dropdown, khong phai gia tri
  const CHROME_GLYPHS = /[▾▴▼▲⌄⌃✕×✖⨯]|arrow_drop_down|expand_more/gi;

  // "Chon...", "-- Chon --", "Select an option", "Vui long chon" ... la goi y,
  // khong phai gia tri nguoi dung da chon.
  const PLACEHOLDER_TEXT = /^(-+\s*)?(chon|vui long chon|select|choose|please select|none|khong chon)\b[\s.…-]*$/i;

  const triggerText = (el) => {
    const sel = [
      '.mat-mdc-select-value-text',
      '.mat-select-value-text',
      '.mat-mdc-select-trigger',
      '.mat-select-trigger',
      '.ng-value-label',
      '.p-dropdown-label',
      '.p-multiselect-label',
      '.ant-select-selection-item',
      '.ant-select-selection-item-content',
      '[class*="select"][class*="value"]',
      '[class*="value"]',
    ].join(',');
    const node = el.querySelector ? el.querySelector(sel) : null;
    let t = node ? AF.norm(node.textContent) : '';
    if (!t && el.querySelector) {
      const inner = el.querySelector('input');
      if (inner && inner.value) t = AF.norm(inner.value);
    }
    if (!t) t = AF.norm(el.textContent);
    t = AF.norm(t.replace(CHROME_GLYPHS, '')).slice(0, 200);

    // placeholder cua dropdown khong phai gia tri
    const ph = AF.norm(el.getAttribute?.('placeholder') || '');
    if (t && ph && AF.slug(t) === AF.slug(ph)) return '';
    // nhieu widget khong dung thuoc tinh placeholder ma in thang chu goi y
    if (PLACEHOLDER_TEXT.test(AF.slug(t))) return '';
    // nhan cua chinh no cung khong phai gia tri
    const name = AF.accessibleName(el);
    if (t && name && AF.slug(t) === AF.slug(name)) return '';
    return t;
  };
  AF.triggerText = triggerText;

  /* ---------------------------------------------------------- dinh dang ngay */

  /**
   * Doan dinh dang ngay cua mot o text: tu placeholder ("dd/mm/yyyy"), thuoc
   * tinh format, hoac gia tri dang co ("10/09/2026" -> dd/mm/yyyy theo chuan
   * Viet Nam). Tra ve chuoi token nhu "dd/mm/yyyy", "yyyy-mm-dd", hoac "".
   */
  AF.dateFormatOf = (el) => {
    if (!el || !el.getAttribute) return '';
    const hints = [
      el.getAttribute('placeholder'),
      el.getAttribute('data-format'),
      el.getAttribute('data-date-format'),
      el.getAttribute('format'),
      el.getAttribute('data-mask'),
      el.getAttribute('mask'),
    ]
      .filter(Boolean)
      .join(' ');
    let m = hints.match(/(dd|mm|yyyy)([\/.\-])(dd|mm|yyyy)\2(dd|mm|yyyy)/i);
    if (m) return `${m[1]}${m[2]}${m[3]}${m[2]}${m[4]}`.toLowerCase();
    // mask kieu 00/00/0000 hoac 99/99/9999 -> dd/mm/yyyy (VN)
    m = hints.match(/[09]{2}([\/.\-])[09]{2}\1[09]{4}/);
    if (m) return `dd${m[1]}mm${m[1]}yyyy`;
    m = hints.match(/[09]{4}([\/.\-])[09]{2}\1[09]{2}/);
    if (m) return `yyyy${m[1]}mm${m[1]}dd`;
    const v = String(el.value || '');
    m = v.match(/^\d{1,2}([\/.\-])\d{1,2}\1\d{4}$/);
    if (m) return `dd${m[1]}mm${m[1]}yyyy`;
    m = v.match(/^\d{4}([\/.\-])\d{2}\1\d{2}/);
    if (m) return `yyyy${m[1]}mm${m[1]}dd`;
    return '';
  };

  /* ------------------------------------------------------------- options */

  const nativeOptions = (el) =>
    [...el.options].map((o) => ({ value: o.value, label: AF.norm(o.textContent) })).filter((o) => o.label || o.value);

  const radioGroupOptions = (el) => {
    const name = el.name;
    const root = el.getRootNode();
    let sibs = [];
    if (name) {
      try {
        sibs = [...root.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)];
      } catch {
        /* noop */
      }
    }
    if (!sibs.length) {
      const grp = AF.closestDeep(el, '[role="radiogroup"],mat-radio-group,fieldset,.radio-group');
      if (grp) sibs = [...grp.querySelectorAll('input[type="radio"],mat-radio-button,[role="radio"]')];
    }
    return sibs.map((s) => ({ value: s.value ?? '', label: AF.accessibleName(s) || AF.norm(s.textContent) }));
  };

  /**
   * Option that su, khong phai: o tim kiem nam trong panel (ngx-mat-select-search
   * dat <input> trong mot mat-option), option disabled, hay dong "khong tim thay".
   */
  AF.isRealOption = (o) => {
    if (!o) return false;
    if (o.querySelector && o.querySelector('input,textarea')) return false;
    if (o.getAttribute('aria-disabled') === 'true' || o.disabled) return false;
    if (/mat-select-search|contains-mat-select-search|option-disabled|list-item--disabled|no-results|ng-option-disabled/i.test(o.className || '')) return false;
    const t = AF.slug(o.textContent || '');
    if (!t) return false;
    if (/^(khong (co|tim thay)|no (result|data|option|match)|not found|nothing found|khong co du lieu|dang tai|loading)/.test(t)) return false;
    return true;
  };

  const customOptions = (el) => {
    // Neu dropdown dang mo, doc option dang hien
    const id = el.getAttribute && (el.getAttribute('aria-owns') || el.getAttribute('aria-controls'));
    let list = null;
    if (id) {
      try {
        list = document.getElementById(id.split(/\s+/)[0]);
      } catch {
        /* noop */
      }
    }
    if (!list) {
      const panel = AF.deepQuery('.cdk-overlay-container [role="listbox"], .cdk-overlay-container mat-option, .ant-select-dropdown, .p-dropdown-panel');
      if (panel) list = panel.closest ? panel.closest('[role="listbox"],.ant-select-dropdown,.p-dropdown-panel') || panel : panel;
    }
    if (!list) return [];
    const opts = [...list.querySelectorAll('[role="option"],mat-option,.ant-select-item-option,.p-dropdown-item,li')];
    return opts
      .filter((o) => AF.isRealOption(o))
      .map((o) => ({ value: o.getAttribute('data-value') || '', label: AF.norm(o.textContent) }))
      .filter((o) => o.label)
      .slice(0, 200);
  };

  /* ---------------------------------------------------------------- scan */

  const describeField = (el) => {
    const kind = kindOf(el);
    if (!kind) return null;

    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (tag === 'input' && SKIP_TYPES.has(type)) return null;

    // Bo qua input an ben trong widget custom (mat-select co 1 select an)
    const visible = AF.isVisible(el);
    if (!visible && kind !== 'file' && !el.hasAttribute('aria-hidden')) {
      // van giu file input an, con lai bo
      if (kind !== 'file') return null;
    }

    const label = AF.accessibleName(el) || AF.labelTextOf(el);
    const r = AF.rectOf(el);

    let options = [];
    if (kind === 'select' || kind === 'multiselect') options = nativeOptions(el);
    else if (kind === 'radio' || kind === 'radiogroup') options = radioGroupOptions(el);
    else if (kind === 'combobox' || kind === 'multiselect-custom') options = customOptions(el);

    let currentValue = '';
    if (kind === 'checkbox' || kind === 'radio') currentValue = el.checked ? 'true' : 'false';
    else if (kind === 'checkbox-custom' || kind === 'toggle')
      currentValue = el.getAttribute('aria-checked') || (el.classList.contains('mat-mdc-checkbox-checked') ? 'true' : 'false');
    else if (kind === 'editor') currentValue = AF.norm(el.textContent).slice(0, 2000);
    else if (kind === 'file') currentValue = el.files && el.files.length ? `${el.files.length} file` : '';
    else if (kind === 'combobox' || kind === 'multiselect-custom') currentValue = triggerText(el).slice(0, 400);
    else if (kind === 'select' || kind === 'multiselect') {
      // Luu nhan cua option dang chon, de con so khop lai o lan sau.
      // Option placeholder ("-- Chon --", value rong) khong phai gia tri.
      const chosen = [...(el.selectedOptions || [])]
        .filter((o) => o.value !== '' && !o.disabled)
        .map((o) => AF.norm(o.textContent) || o.value);
      currentValue = chosen.join(' | ').slice(0, 400);
    } else currentValue = AF.norm(el.value).slice(0, kind === 'textarea' ? 2000 : 400);

    return {
      id: idFor(el),
      kind,
      tag,
      type,
      role: AF.roleOf(el) || '',
      label: label.slice(0, 140),
      name: (el.getAttribute && (el.getAttribute('formcontrolname') || el.getAttribute('name'))) || el.name || '',
      placeholder: (el.getAttribute && el.getAttribute('placeholder')) || '',
      testId:
        (el.getAttribute &&
          (el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy'))) ||
        '',
      required: !!(el.required || el.getAttribute?.('aria-required') === 'true' || AF.closestDeep(el, '.mat-mdc-form-field-required-marker')),
      disabled: !AF.isEnabled(el),
      maxLength: el.maxLength && el.maxLength > 0 ? el.maxLength : null,
      min: (el.getAttribute && el.getAttribute('min')) || '',
      max: (el.getAttribute && el.getAttribute('max')) || '',
      step: (el.getAttribute && el.getAttribute('step')) || '',
      pattern: (el.getAttribute && el.getAttribute('pattern')) || '',
      accept: (el.getAttribute && el.getAttribute('accept')) || '',
      multiple: !!el.multiple || kind === 'multiselect-custom',
      // o text nhap ngay: dinh dang de AI / du lieu thu ghi dung kieu
      dateFormat: kind === 'datepicker' || kind === 'text' ? AF.dateFormatOf(el) : '',
      currentValue,
      options: options.slice(0, 80),
      optionsKnown: options.length > 0 || kind === 'select' || kind === 'multiselect',
      section: sectionOf(el).slice(0, 100),
      help: helpTextOf(el),
      selector: cssPath(el),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      inShadow: el.getRootNode() instanceof ShadowRoot,
      visible,
    };
  };

  const CANDIDATE_SELECTOR = [
    'input',
    'textarea',
    'select',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    'mat-select',
    'mat-checkbox',
    'mat-slide-toggle',
    'mat-radio-group',
    'p-dropdown',
    'p-multiselect',
    'p-checkbox',
    'p-inputswitch',
    'p-calendar',
    'nz-select',
    'nz-switch',
    'ng-select',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="textbox"]',
    '[role="checkbox"]',
    '[role="switch"]',
    '[role="radiogroup"]',
    '[role="spinbutton"]',
  ].join(',');

  /** Gom radio cung name thanh 1 field duy nhat. */
  const dedupeRadios = (fields) => {
    const seen = new Set();
    return fields.filter((f) => {
      if (f.kind !== 'radio') return true;
      const key = `radio:${f.name || f.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      f.kind = 'radiogroup';
      f.currentValue = '';
      // Nhan cua ca nhom la legend / aria-label cua group, khong phai nhan cua radio dau tien
      const el = AF.registry.get(f.id);
      const grp = el && AF.closestDeep(el, 'fieldset,[role="radiogroup"],mat-radio-group,.radio-group');
      if (grp) {
        const lg = grp.querySelector('legend,.mat-mdc-form-field-label') || null;
        const t = lg ? AF.norm(lg.textContent) : AF.norm(grp.getAttribute('aria-label') || '');
        if (t) f.label = t.slice(0, 140);
        const on = grp.querySelector('input[type="radio"]:checked,[role="radio"][aria-checked="true"]');
        if (on) f.currentValue = (AF.accessibleName(on) || AF.norm(on.textContent) || on.value || '').slice(0, 200);
      } else if (el && el.checked) {
        f.currentValue = (AF.accessibleName(el) || el.value || '').slice(0, 200);
      }
      return true;
    });
  };

  AF.Scanner = {
    /** Quet nhanh (sync). */
    scan() {
      const els = AF.deepQueryAll(CANDIDATE_SELECTOR);
      const out = [];
      for (const el of els) {
        // bo input an ben trong mat-select / p-dropdown (host da duoc bat)
        if (AF.closestDeep(AF.composedParent(el), 'mat-select,p-dropdown,p-multiselect,nz-select,ng-select')) continue;
        // bo o tim kiem nam trong panel dropdown dang mo — no khong phai field cua form
        if (AF.closestDeep(AF.composedParent(el), '.cdk-overlay-container,.mat-mdc-select-panel,.mat-select-panel,.ant-select-dropdown,.p-dropdown-panel,.p-multiselect-panel,.ng-dropdown-panel,[role="listbox"]')) continue;
        if (/mat-select-search-input|select-search|dropdown-filter|p-dropdown-filter|p-multiselect-filter/i.test(el.className || '')) continue;
        try {
          const f = describeField(el);
          if (f) out.push(f);
        } catch (e) {
          AF.log('describeField loi', e);
        }
      }
      return dedupeRadios(out).slice(0, 400);
    },

    /**
     * Quet sau: mo tung dropdown custom de doc option that su, roi dong lai.
     * Cham hon nhung cho AI biet chinh xac cac lua chon co san.
     */
    async deepScan() {
      const fields = this.scan();
      for (const f of fields) {
        if ((f.kind === 'combobox' || f.kind === 'multiselect-custom') && !f.options.length) {
          const el = AF.registry.get(f.id);
          if (!el) continue;
          try {
            const opts = await AF.Actions.harvestOptions(el);
            if (opts.length) {
              f.options = opts.slice(0, 80);
              f.optionsKnown = true;
            }
          } catch {
            /* noop */
          }
        }
      }
      return fields;
    },

    /** Tom tat ngu canh trang cho AI. */
    pageContext() {
      const heads = AF.deepQueryAll('h1,h2,h3')
        .filter(AF.isVisible)
        .slice(0, 12)
        .map((h) => AF.norm(h.textContent))
        .filter(Boolean);
      const body = AF.norm(document.body ? document.body.innerText : '').slice(0, 1500);
      return {
        url: location.href,
        title: document.title,
        lang: document.documentElement.lang || '',
        headings: heads,
        text: body,
      };
    },
  };
})();
