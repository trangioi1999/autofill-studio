/* Autofill Studio — content/30-actions.js
 * Action engine: fill / type / select / check / upload / click / press,
 * co auto-wait va cac chien luoc rieng cho Angular, React, Vue, Material,
 * PrimeNG, Ant Design, MUI.
 */
(() => {
  const AF = window.__AF__;
  if (!AF || AF.Actions) return;

  /* ---------------------------------------------------- native value setter */

  const protoSetter = (el) => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    return d && d.set ? d.set : null;
  };

  /**
   * Set value bang native setter de React/Vue/Angular khong ghi de nguoc lai.
   * React theo doi `_valueTracker`, phai reset no.
   */
  const setNativeValue = (el, value) => {
    const tracker = el._valueTracker;
    const setter = protoSetter(el);
    if (setter) setter.call(el, value);
    else el.value = value;
    if (tracker && typeof tracker.setValue === 'function') tracker.setValue('');
  };

  const fire = (el, type, init = {}) => {
    const Ctor =
      type === 'input' || type === 'beforeinput'
        ? InputEvent
        : /^(key)/.test(type)
        ? KeyboardEvent
        : /^(mouse|click|dbl|pointer|contextmenu)/.test(type)
        ? MouseEvent
        : Event;
    let ev;
    try {
      ev = new Ctor(type, { bubbles: true, cancelable: true, composed: true, ...init });
    } catch {
      ev = new Event(type, { bubbles: true, cancelable: true, composed: true });
    }
    el.dispatchEvent(ev);
    return ev;
  };
  AF.fire = fire;

  /** Chuoi event day du de moi framework deu nhan duoc thay doi. */
  const commit = (el, value) => {
    fire(el, 'beforeinput', { inputType: 'insertText', data: value });
    fire(el, 'input', { inputType: 'insertText', data: value });
    fire(el, 'change');
    // Angular danh dau `touched` khi blur -> validator chay
    fire(el, 'blur');
    fire(el, 'focusout');
  };

  /* ------------------------------------------------------------- primitives */

  async function focus(el) {
    await AF.scrollIntoView(el);
    try {
      el.focus({ preventScroll: true });
    } catch {
      try {
        el.focus();
      } catch {
        /* noop */
      }
    }
    fire(el, 'focus');
    fire(el, 'focusin');
    await AF.sleep(10);
  }

  async function clickEl(el, { pointer = true } = {}) {
    await AF.scrollIntoView(el);
    await AF.waitStable(el, { timeout: 600 });
    const r = AF.rectOf(el);
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: 1 };
    if (pointer && window.PointerEvent) {
      const pe = (t, o = {}) =>
        el.dispatchEvent(new PointerEvent(t, { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, ...o }));
      pe('pointerover');
      pe('pointerenter');
      pe('pointerdown');
    }
    el.dispatchEvent(new MouseEvent('mouseover', base));
    el.dispatchEvent(new MouseEvent('mousemove', base));
    el.dispatchEvent(new MouseEvent('mousedown', base));
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* noop */
    }
    el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    if (pointer && window.PointerEvent)
      el.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0, pointerId: 1, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
    await AF.sleep(30);
    return true;
  }

  const KEY_MAP = {
    Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
    Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
    Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    Space: { key: ' ', code: 'Space', keyCode: 32 },
  };

  async function press(el, keyName) {
    const k = KEY_MAP[keyName] || { key: keyName, code: keyName, keyCode: 0 };
    const target = el || document.activeElement || document.body;
    for (const t of ['keydown', 'keypress', 'keyup']) {
      if (t === 'keypress' && k.key.length !== 1) continue;
      target.dispatchEvent(
        new KeyboardEvent(t, {
          key: k.key,
          code: k.code,
          keyCode: k.keyCode,
          which: k.keyCode,
          bubbles: true,
          cancelable: true,
          composed: true,
        })
      );
    }
    await AF.sleep(20);
    return true;
  }

  /* ------------------------------------------------------------- fill text */

  async function fillText(el, value) {
    await focus(el);
    if (el.isContentEditable) return fillEditor(el, value);

    // xoa gia tri cu
    setNativeValue(el, '');
    fire(el, 'input', { inputType: 'deleteContentBackward' });

    setNativeValue(el, String(value ?? ''));
    commit(el, String(value ?? ''));
    return el.value === String(value ?? '');
  }

  /** Go tung ky tu — bat buoc voi autocomplete / input co mask. */
  async function typeText(el, value, { delay = 25 } = {}) {
    await focus(el);
    if (el.isContentEditable) return fillEditor(el, value, { type: true });
    setNativeValue(el, '');
    fire(el, 'input', { inputType: 'deleteContentBackward' });
    const str = String(value ?? '');
    for (const ch of str) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, composed: true }));
      setNativeValue(el, el.value + ch);
      fire(el, 'input', { inputType: 'insertText', data: ch });
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true, composed: true }));
      if (delay) await AF.sleep(delay);
    }
    fire(el, 'change');
    return true;
  }

  /** contenteditable: Quill / ProseMirror / Draft / TinyMCE inline / CKEditor. */
  async function fillEditor(el, value, { type = false } = {}) {
    await focus(el);
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    // execCommand tao ra beforeinput/input dung chuan -> editor nhan duoc
    let ok = false;
    try {
      ok = document.execCommand('insertText', false, String(value ?? ''));
    } catch {
      ok = false;
    }
    if (!ok) {
      el.textContent = String(value ?? '');
      fire(el, 'input', { inputType: 'insertText', data: String(value ?? '') });
    }
    fire(el, 'change');
    fire(el, 'blur');
    return true;
  }

  /* ---------------------------------------------------------- native select */

  const bestOption = (options, want) => {
    const w = AF.slug(want);
    let exact = options.find((o) => AF.slug(o.label) === w || AF.slug(o.value) === w);
    if (exact) return exact;
    let starts = options.find((o) => AF.slug(o.label).startsWith(w) && w);
    if (starts) return starts;
    let incl = options.find((o) => w && (AF.slug(o.label).includes(w) || AF.slug(o.value).includes(w)));
    return incl || null;
  };
  AF.bestOption = bestOption;

  async function selectNative(el, values) {
    const wants = Array.isArray(values) ? values : [values];
    const opts = [...el.options].map((o, i) => ({ i, value: o.value, label: AF.norm(o.textContent) }));
    let hit = 0;
    if (el.multiple) [...el.options].forEach((o) => (o.selected = false));
    for (const w of wants) {
      const m = bestOption(opts, w);
      if (!m) continue;
      if (el.multiple) el.options[m.i].selected = true;
      else {
        el.selectedIndex = m.i;
      }
      hit++;
    }
    fire(el, 'input');
    fire(el, 'change');
    fire(el, 'blur');
    return hit > 0;
  }

  /* ------------------------------------------------- checkbox / radio / toggle */

  const isChecked = (el) => {
    if (typeof el.checked === 'boolean' && el.tagName === 'INPUT') return el.checked;
    const a = el.getAttribute('aria-checked');
    if (a != null) return a === 'true';
    return /(^|\s)(mat-mdc-checkbox-checked|mat-checked|ant-checkbox-checked|is-checked|checked)(\s|$)/.test(
      el.className || ''
    );
  };

  async function setChecked(el, want) {
    const target = !!want;
    // widget custom: click vao phan tu ben trong co the click
    let clickTarget = el;
    if (el.tagName !== 'INPUT') {
      clickTarget =
        el.querySelector('input[type="checkbox"],input[type="radio"]') ||
        el.querySelector('label,.mdc-checkbox,.mat-mdc-checkbox-touch-target,[role="checkbox"],[role="switch"]') ||
        el;
    }
    for (let i = 0; i < 3; i++) {
      if (isChecked(el) === target) return true;
      if (clickTarget.tagName === 'INPUT') {
        // .click() native tu toggle + phat input/change dung chuan.
        // KHONG dispatch click thu cong sau khi set .checked — no se toggle nguoc lai.
        try {
          clickTarget.click();
        } catch {
          clickTarget.checked = target;
          fire(clickTarget, 'input');
          fire(clickTarget, 'change');
        }
        if (isChecked(el) !== target) {
          clickTarget.checked = target;
          fire(clickTarget, 'input');
          fire(clickTarget, 'change');
        }
      } else {
        await clickEl(clickTarget);
      }
      await AF.sleep(80);
    }
    return isChecked(el) === target;
  }

  async function selectRadio(el, want) {
    // el co the la 1 radio bat ky trong nhom, hoac chinh group
    let group = [];
    if (el.tagName === 'INPUT' && el.type === 'radio' && el.name) {
      try {
        group = [...el.getRootNode().querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)];
      } catch {
        /* noop */
      }
    }
    if (!group.length) {
      const g = AF.closestDeep(el, '[role="radiogroup"],mat-radio-group,fieldset') || el;
      group = [...g.querySelectorAll('input[type="radio"],mat-radio-button,[role="radio"]')];
    }
    const items = group.map((g) => ({ el: g, label: AF.accessibleName(g) || AF.norm(g.textContent), value: g.value ?? '' }));
    const m = bestOption(items, want);
    if (!m) return false;
    const t = m.el;
    if (t.tagName === 'INPUT') {
      t.checked = true;
      fire(t, 'click');
      fire(t, 'input');
      fire(t, 'change');
    } else {
      await clickEl(t.querySelector('input,label,.mdc-radio') || t);
    }
    return true;
  }

  /* -------------------------------------------------------- custom dropdown */

  const OVERLAY_SELECTOR =
    '.cdk-overlay-container [role="listbox"], .cdk-overlay-pane [role="listbox"], mat-option, ' +
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden), .p-dropdown-panel, .p-multiselect-panel, ' +
    '.ng-dropdown-panel, [role="listbox"]:not([hidden]), .MuiAutocomplete-popper, ul[role="listbox"]';

  const OPTION_SELECTOR =
    'mat-option, [role="option"], .ant-select-item-option, .p-dropdown-item, .p-multiselect-item, ' +
    '.ng-option, .MuiAutocomplete-option, li[role="option"]';

  const openPanel = () => {
    const panels = AF.deepQueryAll(OVERLAY_SELECTOR).filter((p) => AF.isVisible(p));
    if (!panels.length) return null;
    // lay panel co option
    for (const p of panels.reverse()) {
      const host = p.closest
        ? p.closest('.cdk-overlay-pane,.ant-select-dropdown,.p-dropdown-panel,.p-multiselect-panel,.ng-dropdown-panel,[role="listbox"]') || p
        : p;
      if (host.querySelector(OPTION_SELECTOR) || host.matches(OPTION_SELECTOR)) return host;
    }
    return panels[0];
  };

  const readOptions = (panel) => {
    if (!panel) return [];
    let nodes = [...panel.querySelectorAll(OPTION_SELECTOR)];
    if (!nodes.length && panel.matches && panel.matches(OPTION_SELECTOR)) nodes = [panel];
    return nodes
      .filter((n) => AF.isRealOption(n) && AF.isVisible(n))
      .map((n) => ({ el: n, value: n.getAttribute('data-value') || '', label: AF.norm(n.textContent) }))
      .filter((o) => o.label);
  };

  /** O tim kiem cua dropdown: trong panel (ngx-mat-select-search, PrimeNG filter), hoac chinh input autocomplete. */
  const searchBoxFor = (el) => {
    if (el.tagName === 'INPUT') return el;
    return (
      AF.deepQuery(
        '.cdk-overlay-container input:not([type="checkbox"]):not([type="radio"]), .mat-mdc-select-panel input, .ant-select-dropdown input, .p-dropdown-filter, .p-multiselect-filter, .ng-dropdown-panel input'
      ) ||
      (el.querySelector ? el.querySelector('input.ng-input input, input:not([type="hidden"])') : null)
    );
  };

  const isOpenOption = (o, chosen) => !chosen.has(AF.slug(o.label)) && o.el.getAttribute('aria-selected') !== 'true';

  const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const triggerOf = (el) => {
    if (el.tagName === 'MAT-SELECT') return el.querySelector('.mat-mdc-select-trigger,[role="combobox"]') || el;
    if (/^(P-DROPDOWN|P-MULTISELECT)$/.test(el.tagName))
      return el.querySelector('.p-dropdown,.p-multiselect') || el;
    if (el.tagName === 'NZ-SELECT' || el.tagName === 'NG-SELECT')
      return el.querySelector('.ant-select-selector,.ng-select-container') || el;
    return el;
  };

  async function openDropdown(el) {
    const trig = triggerOf(el);
    let panel = openPanel();
    if (panel) return panel;
    // input autocomplete thuong chi hien panel sau khi go -> khong cho lau,
    // ensurePanelWithOptions se go thu ngay sau do
    const isInput = el.tagName === 'INPUT';
    await clickEl(trig);
    panel = await AF.waitFor(() => openPanel(), { timeout: isInput ? 450 : 3000, interval: 60 });
    if (!panel) {
      // thu ban phim
      await press(trig, 'ArrowDown');
      panel = await AF.waitFor(() => openPanel(), { timeout: isInput ? 350 : 1500 });
    }
    return panel;
  }

  async function closeDropdown(el) {
    const panel = openPanel();
    if (!panel) return;
    await press(document.activeElement || el, 'Escape');
    await AF.sleep(80);
    if (openPanel()) {
      const bd = AF.deepQuery('.cdk-overlay-backdrop,.p-component-overlay');
      if (bd) await clickEl(bd);
      else document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    await AF.sleep(80);
  }

  /** Mo dropdown, doc danh sach option, dong lai — dung cho deepScan. */
  async function harvestOptions(el) {
    // matAutocomplete: danh sach chi hien khi go, va phu thuoc chuoi go ->
    // khong doc truoc duoc; luc dien se mo panel va chon tai cho.
    if (el.tagName === 'INPUT') return [];
    const panel = await openDropdown(el);
    const opts = readOptions(panel).map((o) => ({ value: o.value, label: o.label }));
    await closeDropdown(el);
    return opts;
  }

  /**
   * Mo panel; voi input autocomplete thi panel thuong chi hien sau khi go,
   * nen go thu vai ky tu (seed) de no hien option.
   */
  async function ensurePanelWithOptions(el, seed) {
    let panel = await openDropdown(el);
    let opts = readOptions(openPanel() || panel);
    if (opts.length || el.tagName !== 'INPUT') return { panel, opts };
    for (const ch of seed) {
      await typeText(el, ch, { delay: 10 });
      panel = await AF.waitFor(() => (readOptions(openPanel()).length ? openPanel() : null), { timeout: 1200, interval: 80 });
      opts = readOptions(panel);
      if (opts.length) break;
    }
    return { panel: panel || openPanel(), opts };
  }

  /**
   * Chon trong dropdown custom. values = nhan muon chon (chuoi hoac mang).
   * random = true: khong biet chon gi, mo panel roi chon ngau nhien `count`
   * option — dung cho autocomplete ma danh sach chi hien sau khi mo/go.
   */
  async function selectCustom(el, values, { multiple = false, random = false, count = 0 } = {}) {
    const wants = random ? [] : (Array.isArray(values) ? values : [values]).filter((v) => v != null && String(v).trim() !== '');
    const isInput = el.tagName === 'INPUT';

    if (random || !wants.length) {
      const { panel, opts } = await ensurePanelWithOptions(el, ['a', 'e', 'n']);
      if (!panel) return { ok: false, error: 'Khong mo duoc dropdown' };
      if (!opts.length) {
        await closeDropdown(el);
        return { ok: false, error: 'Panel mo nhung khong co option nao de chon' };
      }
      const chosen = new Set();
      const want = multiple ? Math.max(1, Math.min(count || 1 + Math.floor(Math.random() * 3), opts.length)) : 1;
      let hit = 0;
      for (let i = 0; i < want; i++) {
        let cur = readOptions(openPanel() || panel).filter((o) => isOpenOption(o, chosen));
        if (!cur.length && isInput) {
          // chip autocomplete: sau khi chon, input trong va panel dong -> go lai
          const again = await ensurePanelWithOptions(el, ['a', 'e', 'n', 'i']);
          cur = again.opts.filter((o) => isOpenOption(o, chosen));
        }
        if (!cur.length) break;
        const m = pickRandom(cur);
        chosen.add(AF.slug(m.label));
        await clickEl(m.el);
        hit++;
        await AF.sleep(120);
        if (!multiple) break;
        if (!openPanel()) await openDropdown(el);
      }
      await closeDropdown(el);
      return { ok: hit > 0, filled: hit, random: true, picked: [...chosen] };
    }

    let panel = await openDropdown(el);
    if (!panel && isInput) {
      // autocomplete: go 1-2 ky tu dau cua gia tri de panel hien
      panel = (await ensurePanelWithOptions(el, [String(wants[0]).slice(0, 1)])).panel;
    }
    if (!panel) return { ok: false, error: 'Khong mo duoc dropdown' };

    let hit = 0;
    const missed = [];
    for (const w of wants) {
      // panel co the la virtual scroll / autocomplete -> go de loc neu co o tim kiem
      let opts = readOptions(openPanel() || panel);
      let m = bestOption(opts, w);

      if (!m) {
        const search = searchBoxFor(el);
        if (search) {
          await typeText(search, w, { delay: 15 });
          await AF.waitFor(() => readOptions(openPanel() || panel).length, { timeout: 1500, interval: 80 });
          opts = readOptions(openPanel() || panel);
          m = bestOption(opts, w);
          if (!m && opts.length && opts.length <= 3) m = opts[0]; // da loc con rat it -> lay cai dau
          if (!m && search === el && opts.length === 0) {
            // go ca chuoi khong ra gi (autocomplete khop tung phan) -> thu voi 3 ky tu dau
            await typeText(search, String(w).slice(0, 3), { delay: 15 });
            await AF.waitFor(() => readOptions(openPanel() || panel).length, { timeout: 1500, interval: 80 });
            opts = readOptions(openPanel() || panel);
            m = bestOption(opts, w) || opts[0];
          }
        }
      }

      if (!m) {
        missed.push(w);
        continue;
      }
      await clickEl(m.el);
      hit++;
      await AF.sleep(120);
      if (!multiple) break;
      if (!openPanel()) {
        // panel dong sau moi lan chon -> mo lai
        await openDropdown(el);
      }
    }

    await closeDropdown(el);
    return { ok: hit > 0, filled: hit, missed };
  }

  /* --------------------------------------------------------------- upload */

  const b64ToBytes = (b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  };

  /**
   * files = [{ name, mime, text? , base64?, dataUrl? }]
   * Neu khong co noi dung, tao file placeholder (txt/png 1x1) de form van pass.
   */
  function buildFiles(specs) {
    const out = [];
    for (const s of specs) {
      const name = s.name || 'file.txt';
      const mime = s.mime || (/\.png$/i.test(name) ? 'image/png' : /\.pdf$/i.test(name) ? 'application/pdf' : 'text/plain');
      let parts;
      if (s.dataUrl && /^data:/.test(s.dataUrl)) {
        const [, b64] = s.dataUrl.split(',');
        parts = [b64ToBytes(b64)];
      } else if (s.base64) parts = [b64ToBytes(s.base64)];
      else if (s.text != null) parts = [s.text];
      else if (mime === 'image/png')
        parts = [
          b64ToBytes(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
          ),
        ];
      else parts = [`Generated by Autofill Studio\n${new Date().toISOString()}\n`];
      out.push(new File(parts, name, { type: mime, lastModified: Date.now() }));
    }
    return out;
  }

  async function uploadFiles(el, specs) {
    const files = buildFiles(specs);
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));

    // Truong hop 1: chinh la <input type=file>
    let input = el;
    if (!AF.isFileInput(input)) {
      input =
        (el.querySelector && el.querySelector('input[type="file"]')) ||
        AF.closestDeep(el, 'label')?.control ||
        null;
      if (!input) {
        // dropzone: tim file input gan nhat trong cung container
        const box = AF.closestDeep(el, 'form,section,div');
        if (box) input = box.querySelector('input[type="file"]');
      }
    }

    if (input && AF.isFileInput(input)) {
      try {
        input.files = dt.files;
      } catch {
        Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
      }
      fire(input, 'input');
      fire(input, 'change');
      return { ok: input.files.length > 0, filled: input.files.length };
    }

    // Truong hop 2: dropzone thuan (react-dropzone, ngx-dropzone)
    const zone = el;
    const opts = { bubbles: true, cancelable: true, composed: true };
    zone.dispatchEvent(new DragEvent('dragenter', { ...opts, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent('dragover', { ...opts, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent('drop', { ...opts, dataTransfer: dt }));
    return { ok: true, filled: files.length, viaDrop: true };
  }

  /* ------------------------------------------------------------ date input */

  const toDateValue = (v, type) => {
    const s = String(v).trim();
    // da dung dinh dang
    if (/^\d{4}-\d{2}-\d{2}$/.test(s) && type === 'date') return s;
    // dd/mm/yyyy phai check TRUOC new Date() — nếu khong Chrome hieu theo kieu My (mm/dd).
    let d;
    const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (m) {
      const [, a, b2, y] = m;
      // >12 thi chac chan la ngay; con lai theo chuan Viet Nam: dd/mm/yyyy
      d = +a > 12 || +b2 <= 12 ? new Date(+y, +b2 - 1, +a) : new Date(+y, +a - 1, +b2);
    } else {
      d = new Date(s);
    }
    if (isNaN(d)) return s;
    const p = (n) => String(n).padStart(2, '0');
    if (type === 'date') return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    if (type === 'datetime-local')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    if (type === 'month') return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
    if (type === 'time') return `${p(d.getHours())}:${p(d.getMinutes())}`;
    return s;
  };

  /* ------------------------------------------------------ ngay dang text */

  const DATE_HINT = /ngay|date|birthday|\bdob\b|sinh nhat|thoi gian|deadline|han\b/i;

  /** Chuoi ngay bat ky (ISO, dd/mm/yyyy...) -> Date, hoac null. */
  const parseAnyDate = (v) => {
    const s = String(v ?? '').trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) {
      const [, a, b, y] = m;
      return +a > 12 || +b <= 12 ? new Date(+y, +b - 1, +a) : new Date(+y, +a - 1, +b);
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  };

  /** Date -> chuoi theo token "dd/mm/yyyy" | "mm-dd-yyyy" | "yyyy-mm-dd"... */
  const formatDate = (d, fmt) => {
    const p = (n) => String(n).padStart(2, '0');
    return fmt
      .replace(/yyyy/i, String(d.getFullYear()))
      .replace(/yy(?!yy)/i, String(d.getFullYear()).slice(2))
      .replace(/mm/i, p(d.getMonth() + 1))
      .replace(/dd/i, p(d.getDate()));
  };
  AF.formatDate = formatDate;
  AF.parseAnyDate = parseAnyDate;

  /**
   * O text nhap ngay (matDatepicker, mask...): AI va du lieu thu hay dua ISO
   * "2026-09-10", nhung o do hien "10/09/2026". Doi sang dung dinh dang cua o
   * (doan tu placeholder / gia tri dang co; mac dinh dd/mm/yyyy theo VN).
   */
  const toTextDate = (el, value, kind) => {
    const s = String(value ?? '').trim();
    if (!s) return s;
    const isDateField = kind === 'datepicker' || DATE_HINT.test(`${AF.accessibleName(el)} ${el.getAttribute('placeholder') || ''} ${el.name || ''}`);
    if (!isDateField) return s;
    const d = parseAnyDate(s);
    if (!d) return s;
    const fmt = AF.dateFormatOf(el) || 'dd/mm/yyyy';
    // gia tri da dung dinh dang thi giu nguyen
    const already = formatDate(d, fmt);
    return already;
  };

  /* ---------------------------------------------------------- dispatcher */

  /**
   * step = { action, locator|afId, value, options }
   * action: fill | type | select | check | radio | upload | click | press | wait | scroll
   */
  async function runStep(step) {
    const t0 = performance.now();
    const loc = step.locator || (step.afId ? { afId: step.afId } : null);
    const label = AF.Locator.describe(loc);

    if (step.action === 'wait') {
      await AF.sleep(Math.min(step.value ? +step.value : 500, 10000));
      return { ok: true, action: 'wait', label, ms: performance.now() - t0 };
    }

    let el = null;
    if (loc) {
      el = await AF.Locator.wait(loc, { timeout: step.timeout ?? 5000, state: 'attached' });
      if (!el) return { ok: false, action: step.action, label, error: 'Khong tim thay element' };
      const ready = await AF.Locator.ready(el, { timeout: step.timeout ?? 5000 });
      if (!ready && step.action !== 'upload')
        return { ok: false, action: step.action, label, error: 'Element chua san sang (an/disabled)' };
      // Cuon toi o (chi khi no ngoai khung nhin) roi truot con tro toi do,
      // de nguoi dung thay engine dang o dau.
      await AF.scrollIntoView(el);
      if (AF.Picker) AF.Picker.cursor(el);
    }

    let res;
    try {
      switch (step.action) {
        case 'fill': {
          const kind = step.kind || '';
          if (el.tagName === 'SELECT') res = { ok: await selectNative(el, step.value) };
          else if (el.tagName === 'INPUT' && ['date', 'datetime-local', 'month', 'week', 'time'].includes(el.type))
            res = { ok: await fillText(el, toDateValue(step.value, el.type)) };
          else if (kind === 'combobox' || kind === 'multiselect-custom' || el.tagName === 'MAT-SELECT')
            res = await selectCustom(el, step.value, { multiple: kind === 'multiselect-custom', random: !!step.random, count: step.count });
          else if (el.tagName === 'INPUT' && (kind === 'datepicker' || kind === 'text' || !kind))
            res = { ok: await fillText(el, toTextDate(el, step.value, kind)) };
          else res = { ok: await fillText(el, step.value) };
          break;
        }
        case 'type':
          res = { ok: await typeText(el, el.tagName === 'INPUT' ? toTextDate(el, step.value, step.kind) : step.value, { delay: step.delay ?? 25 }) };
          break;
        case 'select':
          if (el.tagName === 'SELECT') res = { ok: await selectNative(el, step.value) };
          else res = await selectCustom(el, step.value, { multiple: !!step.multiple, random: !!step.random, count: step.count });
          break;
        case 'check':
          res = { ok: await setChecked(el, step.value === false || step.value === 'false' ? false : true) };
          break;
        case 'radio':
          res = { ok: await selectRadio(el, step.value) };
          break;
        case 'upload':
          res = await uploadFiles(el, Array.isArray(step.value) ? step.value : [step.value]);
          break;
        case 'click':
          res = { ok: await clickEl(el) };
          break;
        case 'press':
          res = { ok: await press(el, step.value || 'Enter') };
          break;
        case 'scroll':
          await AF.scrollIntoView(el);
          res = { ok: true };
          break;
        default:
          res = { ok: false, error: `action khong ho tro: ${step.action}` };
      }
    } catch (e) {
      res = { ok: false, error: AF.err(e) };
    }

    if (el && res.ok) AF.Picker && AF.Picker.flash(el, true);
    if (el && !res.ok) AF.Picker && AF.Picker.flash(el, false);

    return { action: step.action, label, ms: Math.round(performance.now() - t0), ...res };
  }

  AF.Actions = {
    setNativeValue,
    fire,
    focus,
    clickEl,
    press,
    fillText,
    typeText,
    fillEditor,
    selectNative,
    setChecked,
    selectRadio,
    selectCustom,
    openDropdown,
    closeDropdown,
    harvestOptions,
    uploadFiles,
    buildFiles,
    toDateValue,
    runStep,

    async runPlan(steps, { stopOnError = false, stepDelay = 60 } = {}) {
      const results = [];
      // Nhip deu giua cac buoc de mat theo kip; reduced-motion thi chay nhanh
      const gap = AF.reducedMotion() ? Math.min(stepDelay, 30) : Math.max(stepDelay, 140);
      try {
        for (const s of steps) {
          const r = await runStep(s);
          results.push({ ...r, step: s });
          if (!r.ok && stopOnError) break;
          if (gap) await AF.sleep(gap);
        }
      } finally {
        if (AF.Picker) AF.Picker.cursorOff();
      }
      return results;
    },
  };
})();
