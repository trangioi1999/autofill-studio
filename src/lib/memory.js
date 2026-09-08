/* Autofill Studio — lib/memory.js
 * Bo nho theo man hinh: luu lai gia tri da dien tren mot form, de lan sau vao
 * lai la dien duoc ngay, khong ton mot lan goi AI nao.
 *
 * Luu o chrome.storage.local key rieng ("snapshots") chu khong nhet vao
 * "settings", vi du lieu nay to va thay doi thuong xuyen.
 */
import { screenKey, screenLabel, signatureOf, matchEntries, isSecret } from './screen.js';
import { planToSteps } from './prompt.js';

const KEY = 'snapshots';
const MAX_SNAPSHOTS = 200;
const MAX_ENTRIES = 300;
const MAX_VALUE = 4000;

const uid = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

async function readAll() {
  const r = await chrome.storage.local.get(KEY);
  return Array.isArray(r[KEY]) ? r[KEY] : [];
}

async function writeAll(list) {
  const trimmed = list
    .slice()
    .sort((a, b) => (b.usedAt || b.at || 0) - (a.usedAt || a.at || 0))
    .slice(0, MAX_SNAPSHOTS);
  await chrome.storage.local.set({ [KEY]: trimmed });
  return trimmed;
}

/* ------------------------------------------------------------------ doc/ghi */

export async function listSnapshots() {
  return readAll();
}

/** Cac ban luu hop voi trang dang mo, moi nhat truoc. */
export async function snapshotsFor(url) {
  const key = screenKey(url);
  return (await readAll())
    .filter((s) => s.key === key)
    .sort((a, b) => (b.usedAt || b.at || 0) - (a.usedAt || a.at || 0));
}

/**
 * Chuyen ket qua quet thanh cac entry co the luu.
 * Chi lay field co gia tri that, bo qua field nhay cam va field disabled.
 */
export function entriesFromFields(fields) {
  const out = [];
  for (const f of fields || []) {
    if (f.disabled || isSecret(f)) continue;
    const v = String(f.currentValue ?? '').trim();
    if (!v) continue;
    // checkbox chua tick thi khong co gi de luu
    if (/checkbox|toggle/.test(f.kind) && /^(false|0|off|no)$/i.test(v)) continue;
    out.push({
      label: f.label || f.name || f.placeholder || '',
      kind: f.kind,
      value: v.slice(0, MAX_VALUE),
      sig: signatureOf(f),
    });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

/** Luu (hoac ghi de) mot ban chup man hinh. */
export async function saveSnapshot({ url, title, name, entries, id, auto = false }) {
  if (!entries || !entries.length) throw new Error('Khong co gia tri nao de luu — hay dien form truoc da.');
  const list = await readAll();
  const now = Date.now();
  const key = screenKey(url);

  if (id) {
    const i = list.findIndex((s) => s.id === id);
    if (i < 0) throw new Error('Khong tim thay ban luu');
    list[i] = { ...list[i], entries, at: now, usedAt: now, name: name || list[i].name, url, title };
    await writeAll(list);
    return list[i];
  }

  const snap = {
    id: uid(),
    key,
    url,
    title: title || '',
    name: (name || '').trim() || defaultName(url, title, list.filter((s) => s.key === key).length),
    auto,
    at: now,
    usedAt: now,
    entries,
  };
  list.unshift(snap);
  await writeAll(list);
  return snap;
}

function defaultName(url, title, existing) {
  const base = screenLabel(url, title);
  return existing ? `${base} (${existing + 1})` : base;
}

export async function renameSnapshot(id, name) {
  const list = await readAll();
  const s = list.find((x) => x.id === id);
  if (!s) throw new Error('Khong tim thay ban luu');
  s.name = String(name || '').slice(0, 80) || s.name;
  await writeAll(list);
  return s;
}

export async function deleteSnapshot(id) {
  const list = await readAll();
  await writeAll(list.filter((s) => s.id !== id));
  return { ok: true };
}

export async function clearSnapshots() {
  await chrome.storage.local.set({ [KEY]: [] });
  return { ok: true };
}

async function touch(id) {
  const list = await readAll();
  const s = list.find((x) => x.id === id);
  if (s) {
    s.usedAt = Date.now();
    s.uses = (s.uses || 0) + 1;
    await writeAll(list);
  }
}

/* ------------------------------------------------------------------- ap dung */

/**
 * Ghep ban luu vao cac field dang co tren trang -> danh sach step chay duoc.
 * Khong goi AI. Tra ve ca phan khop lan phan khong tim thay o, de UI noi ro.
 */
export function snapshotToSteps(snapshot, fields) {
  const { pairs, missing } = matchEntries(snapshot.entries, fields);
  const plan = {
    steps: pairs.map((p) => ({
      id: p.field.gid || p.field.id,
      action: 'fill',
      value: p.entry.value,
      note: `Tu bo nho · ${p.score >= 100 ? 'khop chac' : 'khop gan dung'}`,
    })),
  };
  const steps = planToSteps(plan, fields);
  return {
    steps,
    matched: pairs.length,
    missing: missing.map((e) => ({ id: e.label, reason: 'Khong tim thay o tuong ung tren trang nay' })),
  };
}

export async function useSnapshot(id, fields) {
  const list = await readAll();
  const snap = list.find((s) => s.id === id);
  if (!snap) throw new Error('Khong tim thay ban luu');
  await touch(id);
  return { snapshot: snap, ...snapshotToSteps(snap, fields) };
}
