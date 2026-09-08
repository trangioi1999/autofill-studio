/* Autofill Studio — lib/screen.js
 * Nhan dang "man hinh" (screen) va so khop field giua hai lan quet khac nhau.
 *
 * Van de: afId cua field duoc sinh moi moi lan load trang, nen khong the dung
 * lam khoa luu tru. Ta phai mo ta field bang cac dac diem ben vung (name,
 * data-testid, nhan, section, selector) roi so khop lai bang diem so.
 */

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/* --------------------------------------------------------------- screen key */

// /users/12345/edit -> /users/:id/edit  ·  /order/8f3c-...-9a -> /order/:id
const genericSegment = (seg) => {
  if (/^\d+$/.test(seg)) return ':id';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id';
  if (/^[0-9a-f]{16,}$/i.test(seg)) return ':id';
  if (/^\d{4}-\d{2}-\d{2}$/.test(seg)) return ':date';
  if (seg.length > 24 && /\d/.test(seg) && /[a-z]/i.test(seg)) return ':id';
  return seg;
};

/**
 * Khoa dinh danh mot man hinh. Bo query va hash vi cung mot form thuong duoc
 * mo voi query khac nhau (?tab=2, ?ref=...), nhung van la man hinh do.
 */
export function screenKey(url) {
  try {
    const u = new URL(url);
    const path = u.pathname
      .split('/')
      .filter(Boolean)
      .map(genericSegment)
      .join('/');
    return `${u.host}/${path}`.replace(/\/$/, '');
  } catch {
    return String(url || '').slice(0, 200);
  }
}

export function screenLabel(url, title) {
  const t = String(title || '').trim();
  if (t) return t.slice(0, 80);
  return screenKey(url);
}

/* ------------------------------------------------------------------ secrets */

const SECRET_RE = /(pass\s*word|matkhau|mat khau|otp|cvv|cvc|securitycode|creditcard|the tin dung|so the|card\s*number|secret|token|api[\s_-]?key|pin\b|captcha)/i;

/** Khong bao gio luu cac o nhay cam vao bo nho tren dia. */
export function isSecret(f) {
  if (!f) return true;
  if (f.type === 'password') return true;
  const hay = `${f.name} ${f.label} ${f.placeholder} ${f.testId} ${f.help}`;
  return SECRET_RE.test(hay);
}

/* ---------------------------------------------------------------- signature */

/** Mo ta ben vung cua mot field, dung de so khop o lan quet sau. */
export function signatureOf(f) {
  return {
    name: f.name || '',
    testId: f.testId || '',
    label: slug(f.label),
    placeholder: slug(f.placeholder),
    section: slug(f.section),
    kind: f.kind || '',
    selector: f.selector || '',
    frameId: f.frameId ?? 0,
  };
}

/** Diem giong nhau giua chu ky da luu va mot field dang co tren trang. */
export function scoreMatch(sig, f) {
  const s = signatureOf(f);
  let score = 0;

  if (sig.name && s.name && sig.name === s.name) score += 100;
  if (sig.testId && s.testId && sig.testId === s.testId) score += 90;
  if (sig.selector && s.selector && sig.selector === s.selector) score += 60;
  if (sig.label && s.label && sig.label === s.label) score += 45;
  if (sig.placeholder && s.placeholder && sig.placeholder === s.placeholder) score += 25;
  if (sig.section && s.section && sig.section === s.section) score += 15;
  if (sig.kind && s.kind === sig.kind) score += 15;
  if (sig.frameId === s.frameId) score += 5;

  // Khac han loai thi gan nhu chac chan khong phai cung mot o
  const groupOf = (k) =>
    /checkbox|toggle/.test(k) ? 'bool' : /radio/.test(k) ? 'radio' : /select|combobox/.test(k) ? 'choice' : /file/.test(k) ? 'file' : 'text';
  if (groupOf(sig.kind) !== groupOf(s.kind)) score -= 40;

  return score;
}

export const MATCH_THRESHOLD = 55;

/**
 * Ghep cac entry da luu vao cac field dang co tren trang.
 * Tham lam theo diem giam dan, moi field chi duoc nhan mot entry.
 * -> { pairs: [{ entry, field, score }], missing: [entry] }
 */
export function matchEntries(entries, fields) {
  const usable = fields.filter((f) => !f.disabled);
  const cands = [];
  for (const entry of entries || []) {
    for (const f of usable) {
      const score = scoreMatch(entry.sig || {}, f);
      if (score >= MATCH_THRESHOLD) cands.push({ entry, field: f, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);

  const usedField = new Set();
  const usedEntry = new Set();
  const pairs = [];
  for (const c of cands) {
    const fid = c.field.gid || c.field.id;
    if (usedField.has(fid) || usedEntry.has(c.entry.sig?.selector + '|' + c.entry.label)) continue;
    usedField.add(fid);
    usedEntry.add(c.entry.sig?.selector + '|' + c.entry.label);
    pairs.push(c);
  }

  const matched = new Set(pairs.map((p) => p.entry));
  const missing = (entries || []).filter((e) => !matched.has(e));
  return { pairs, missing };
}
