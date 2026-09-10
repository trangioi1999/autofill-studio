/* Autofill Studio — lib/dummy.js
 * Sinh du lieu thu KHONG can AI: dropdown chon ngau nhien, multi-select chon
 * n muc, so ngau nhien trong [min,max], ngay hop le, con o text thi lay ngay
 * nhan (label) lam gia tri — hoac mot gia tri hop le hon neu nhan noi ro
 * (email, dien thoai, ho ten, dia chi...).
 *
 * Dung cho:
 *   - che do "Ngau nhien" trong side panel (dien nhanh de test form)
 *   - dien bu nhung o co danh sach lua chon ma AI bo trong (fillGaps)
 *
 * Chay trong service worker (ESM), khong dung DOM.
 */

/* ------------------------------------------------------------------ utils */

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const between = (a, b) => a + rnd(b - a + 1);
const pad = (n) => String(n).padStart(2, '0');

/** Bo dau tieng Viet + thuong hoa, de so khop nhan. */
export const slug = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const FIRST = ['An', 'Bình', 'Chi', 'Dũng', 'Hà', 'Hùng', 'Khánh', 'Lan', 'Linh', 'Minh', 'Nam', 'Ngọc', 'Phương', 'Quân', 'Thảo', 'Trang', 'Tuấn', 'Vy'];
const MIDDLE = ['Văn', 'Thị', 'Minh', 'Thanh', 'Hữu', 'Ngọc', 'Quang', 'Hoàng'];
const LAST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ'];
const STREET = ['Nguyễn Huệ', 'Lê Lợi', 'Trần Hưng Đạo', 'Hai Bà Trưng', 'Điện Biên Phủ', 'Cách Mạng Tháng 8', 'Võ Văn Tần', 'Nguyễn Trãi'];
const CITY = ['TP. Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng', 'Cần Thơ', 'Hải Phòng', 'Bình Dương'];
const DISTRICT = ['Quận 1', 'Quận 3', 'Quận 7', 'Bình Thạnh', 'Phú Nhuận', 'Tân Bình'];
const COMPANY = ['Công ty TNHH Sao Mai', 'FPT Software', 'VNG', 'Tiki', 'MoMo', 'Công ty CP Công nghệ ABC'];
const TITLE = ['Frontend Developer', 'Senior Angular Developer', 'Backend Engineer', 'QA Engineer', 'Product Manager', 'Business Analyst'];
const WORDS = ['dữ liệu', 'thử nghiệm', 'biểu mẫu', 'kiểm tra', 'nội dung', 'mẫu', 'tự động', 'hợp lệ', 'thông tin', 'ví dụ'];

const fullName = () => `${pick(LAST)} ${pick(MIDDLE)} ${pick(FIRST)}`;
const sentence = (n = 8) => {
  const w = Array.from({ length: n }, () => pick(WORDS));
  w[0] = w[0][0].toUpperCase() + w[0].slice(1);
  return w.join(' ') + '.';
};
const digits = (n) => Array.from({ length: n }, (_, i) => (i === 0 ? between(1, 9) : rnd(10))).join('');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateBetween = (y1, y2) => new Date(between(y1, y2), rnd(12), between(1, 28));
const dateAround = (days) => new Date(Date.now() + between(-days, days) * 864e5);

/* ------------------------------------------------------------ heuristics */

/** Ghep text mo ta o (label, name, placeholder, help) de doan loai. */
const hintOf = (f) => slug([f.label, f.name, f.placeholder, f.help].filter(Boolean).join(' '));

const has = (h, ...res) => res.some((re) => re.test(h));

/** Truong tuyet doi khong dien du lieu thu: mat khau, OTP, the, captcha. */
export const isSensitive = (f) =>
  f.type === 'password' ||
  has(hintOf(f), /mat khau|password|passwd|\botp\b|ma xac (thuc|nhan)|cvv|cvc|so the|card ?number|captcha|secret|api ?key|token|\bpin\b/);

/** Option placeholder ("-- Chon --", "Select...") khong phai lua chon that. */
const isPlaceholderOption = (o) => {
  const l = slug(o.label || '');
  return o.value === '' && !o.label ? true : /^(-+|\.+|chon|select|choose|please|vui long|tat ca|all)\b/.test(l) || /^-+.*-+$/.test(l);
};

const realOptions = (f) => {
  const all = (f.options || []).filter((o) => o && (o.label || o.value));
  const good = all.filter((o) => !isPlaceholderOption(o));
  return good.length ? good : all;
};

const optLabel = (o) => o.label || o.value;

/** Chon k muc khac nhau. */
const sample = (arr, k) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
};

function numberFor(f, h) {
  const min = f.min !== '' && f.min != null && !isNaN(+f.min) ? +f.min : null;
  const max = f.max !== '' && f.max != null && !isNaN(+f.max) ? +f.max : null;
  const step = f.step && !isNaN(+f.step) && +f.step > 0 ? +f.step : null;
  let lo = min ?? 1;
  let hi = max ?? (min != null ? min + 100 : 100);
  const bounded = min != null || max != null;
  const isQty = has(h, /so luong|quantity|\bqty\b|so nguoi|count/);
  const isSalary = !isQty && has(h, /luong|salary|thu nhap|income/);
  // Chi thu hep khi field KHONG tu dat min/max — min/max cua form la luat
  if (!bounded) {
    if (has(h, /tuoi|\bage\b/)) [lo, hi] = [18, 60];
    else if (isQty) [lo, hi] = [1, 10];
    else if (isSalary) [lo, hi] = [10, 50];
    else if (has(h, /\bnam\b|year/)) [lo, hi] = [1990, new Date().getFullYear()];
  }
  if (hi < lo) hi = lo;
  let v = between(Math.ceil(lo), Math.floor(hi));
  if (step) v = Math.min(Math.round((v - lo) / step) * step + lo, hi);
  if (isSalary && !bounded) v *= 1000000;
  return String(v);
}

function textFor(f, h) {
  const label = String(f.label || f.placeholder || f.name || '').trim();
  const type = String(f.type || '').toLowerCase();

  if (type === 'email' || has(h, /\bemail\b|e-mail|thu dien tu/)) {
    const n = slug(fullName()).replace(/ /g, '.');
    return `${n}${between(1, 99)}@example.com`;
  }
  if (type === 'tel' || has(h, /dien thoai|phone|mobile|\bsdt\b|\btel\b|so dt|hotline|zalo/)) return `09${digits(8)}`;
  if (type === 'url' || has(h, /website|\burl\b|\blink\b|trang web|linkedin|github|portfolio/)) {
    const host = has(h, /linkedin/) ? 'linkedin.com/in' : has(h, /github/) ? 'github.com' : 'example.com';
    return `https://${host}/${slug(pick(FIRST))}${between(1, 999)}`;
  }
  if (has(h, /ho va ten|ho ten|full ?name|^ten$|^name$|ten day du|nguoi lien he|contact name|ten nguoi/)) return fullName();
  if (has(h, /first ?name|^ten\b|ten goi/)) return pick(FIRST);
  if (has(h, /last ?name|^ho\b|ho dem|surname|family/)) return pick(LAST);
  if (has(h, /dia chi|address|street|duong/)) return `${between(1, 300)} ${pick(STREET)}, ${pick(DISTRICT)}`;
  if (has(h, /thanh pho|tinh|city|province/)) return pick(CITY);
  if (has(h, /quan|huyen|district|ward|phuong/)) return pick(DISTRICT);
  if (has(h, /quoc gia|country/)) return 'Việt Nam';
  if (has(h, /cong ty|company|doanh nghiep|employer|organi[sz]ation|to chuc/)) return pick(COMPANY);
  if (has(h, /chuc danh|chuc vu|job ?title|position|vi tri|role/)) return pick(TITLE);
  if (has(h, /ma buu|zip|postal/)) return digits(5);
  if (has(h, /ma so thue|tax/)) return digits(10);
  if (has(h, /cmnd|cccd|can cuoc|chung minh|identity|id ?number|passport|ho chieu/)) return digits(12);
  if (has(h, /tai khoan|account ?number|so tk|bank/)) return digits(12);
  if (has(h, /username|tai khoan|user ?name|ten dang nhap/)) return `${slug(pick(FIRST))}${between(100, 999)}`;
  if (has(h, /tuoi|\bage\b/)) return String(between(18, 60));
  if (has(h, /nam sinh|birth ?year/)) return String(between(1980, 2005));
  if (has(h, /ngay|date|\bdob\b|birthday/)) return isoDate(dateBetween(1980, 2005));
  if (has(h, /gio|time/)) return `${pad(between(8, 17))}:${pad(rnd(4) * 15)}`;
  if (has(h, /so luong|quantity|\bqty\b|so nguoi|kinh nghiem|years?/)) return String(between(1, 10));
  if (has(h, /luong|salary|thu nhap/)) return String(between(10, 50) * 1000000);
  if (has(h, /mo ta|description|ghi chu|note|noi dung|message|comment|gioi thieu|about|bio|cover|thu/))
    return `${label ? label + ': ' : ''}${sentence(10)}`;

  // pattern chi cho phep so -> sinh so
  if (f.pattern && /^\^?\\?\[?0-9|\\d/.test(f.pattern) && !/[a-z]/i.test(f.pattern.replace(/\\d|\\w|\[0-9\]|\[a-z\]|\[A-Z\]/g, ''))) {
    const m = f.pattern.match(/\{(\d+)(?:,(\d+))?\}/);
    return digits(m ? +(m[2] || m[1]) : f.maxLength || 6);
  }

  // mac dinh: lay ngay nhan lam gia tri, kem so de moi lan chay khac nhau
  return label ? `${label} ${between(1, 99)}` : `Test ${between(100, 999)}`;
}

/* -------------------------------------------------------------- public */

/**
 * Sinh gia tri thu cho mot field da quet. Tra ve { value, note } hoac null neu
 * nen bo qua (nhay cam, disabled, khong biet chon gi).
 * `value` la chuoi theo dung quy uoc cua plan AI (multi noi bang "|").
 */
export function dummyValue(f) {
  if (!f || f.disabled) return null;
  if (isSensitive(f)) return null;
  const h = hintOf(f);
  const kind = f.kind;

  if (kind === 'select' || kind === 'combobox') {
    const opts = realOptions(f);
    if (!opts.length) return null;
    return { value: optLabel(pick(opts)), note: `ngau nhien 1/${opts.length}` };
  }
  if (kind === 'multiselect' || kind === 'multiselect-custom') {
    const opts = realOptions(f);
    if (!opts.length) return null;
    const k = between(1, Math.min(3, opts.length));
    return { value: sample(opts, k).map(optLabel).join('|'), note: `ngau nhien ${k}/${opts.length}` };
  }
  if (kind === 'radio' || kind === 'radiogroup') {
    const opts = realOptions(f);
    if (!opts.length) return null;
    return { value: optLabel(pick(opts)), note: `ngau nhien 1/${opts.length}` };
  }
  if (kind === 'checkbox' || kind === 'checkbox-custom' || kind === 'toggle') {
    // dieu khoan / bat buoc -> tick; con lai tung dong xu
    const must = f.required || has(h, /dong y|agree|accept|terms|dieu khoan|xac nhan|confirm/);
    return { value: must || Math.random() < 0.5 ? 'true' : 'false', note: must ? 'bat buoc' : 'ngau nhien' };
  }
  if (kind === 'file') {
    const img = /image/.test(f.accept || '');
    return { value: `test-${between(1, 99)}.${img ? 'png' : 'pdf'}`, note: 'file thu' };
  }
  if (kind === 'number' || kind === 'range') return { value: numberFor(f, h), note: 'so ngau nhien' };
  if (kind === 'date') {
    const t = String(f.type || 'date');
    const d = has(h, /sinh|birth|dob/) ? dateBetween(1980, 2005) : dateAround(30);
    let v = isoDate(d);
    if (t === 'time') v = `${pad(between(8, 17))}:${pad(rnd(4) * 15)}`;
    else if (t === 'month') v = v.slice(0, 7);
    else if (t === 'datetime-local') v = `${v}T${pad(between(8, 17))}:00`;
    return { value: v, note: 'ngay ngau nhien' };
  }
  if (kind === 'color') return { value: `#${digits(6).replace(/\d/g, (c) => '0123456789abcdef'[+c])}`, note: 'mau ngau nhien' };
  if (kind === 'textarea' || kind === 'editor') {
    let v = `${f.label ? f.label + ': ' : ''}${sentence(12)}`;
    if (f.maxLength) v = v.slice(0, f.maxLength);
    return { value: v, note: 'theo nhan' };
  }

  // text va cac loai con lai
  let v = textFor(f, h);
  if (f.maxLength && v.length > f.maxLength) v = v.slice(0, f.maxLength);
  return { value: v, note: 'theo nhan' };
}

/**
 * Ke hoach dien toan bo form bang du lieu thu, cung dinh dang voi plan cua AI
 * de dua thang vao planToSteps(). O nhay cam va o khong doan duoc -> skipped.
 */
export function dummyPlan(fields) {
  const steps = [];
  const skipped = [];
  for (const f of fields) {
    const id = f.gid || f.id;
    if (f.disabled) continue;
    const v = dummyValue(f);
    if (!v) {
      skipped.push({ id, reason: isSensitive(f) ? 'nhay cam (mat khau / OTP / the)' : 'khong co lua chon de chon' });
      continue;
    }
    steps.push({ id, action: 'fill', value: v.value, source: 'random', note: v.note });
  }
  return { steps, skipped };
}

const matchesOption = (f, value) => {
  const opts = f.options || [];
  if (!opts.length) return true; // khong biet danh sach thi tin AI
  const parts = String(value ?? '')
    .split('|')
    .map((x) => slug(x))
    .filter(Boolean);
  if (!parts.length) return false;
  return parts.every((p) => opts.some((o) => slug(o.label) === p || slug(o.value) === p || slug(o.label).includes(p)));
};

const HAS_OPTIONS = new Set(['select', 'multiselect', 'combobox', 'multiselect-custom', 'radio', 'radiogroup']);

/**
 * Sau khi AI tra ve plan: nhung o co danh sach lua chon ma AI bo trong, hoac
 * AI dua gia tri khong khop option nao, thi chon ngau nhien. Sua plan tai cho,
 * tra ve so o da bu.
 */
export function fillGaps(plan, fields) {
  if (!plan || !Array.isArray(plan.steps)) return 0;
  let fixed = 0;
  const byId = new Map(plan.steps.map((s) => [String(s.id), s]));
  const skippedIds = new Set((plan.skipped || []).map((s) => String(s.id)));

  for (const f of fields) {
    if (!HAS_OPTIONS.has(f.kind) || f.disabled || isSensitive(f)) continue;
    const id = String(f.gid || f.id);
    const step = byId.get(id) || byId.get(String(f.id));

    if (step) {
      if (matchesOption(f, step.value)) continue;
      const v = dummyValue(f);
      if (!v) continue;
      const was = String(step.value ?? '').slice(0, 30);
      step.value = v.value;
      step.source = 'random';
      step.note = `AI dua "${was}" khong co trong danh sach -> ${v.note}`;
      fixed++;
      continue;
    }
    // AI bo qua vi da co gia tri thi ton trong
    if (f.currentValue) continue;
    const v = dummyValue(f);
    if (!v) continue;
    plan.steps.push({ id, action: 'fill', value: v.value, source: 'random', note: `AI bo trong -> ${v.note}` });
    if (skippedIds.has(id)) plan.skipped = plan.skipped.filter((s) => String(s.id) !== id);
    fixed++;
  }
  return fixed;
}
