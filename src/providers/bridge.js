/* Autofill Studio — providers/bridge.js
 * Goi toi Local Bridge chay tren may cua ban (bridge/server.mjs).
 * Bridge se chuyen tiep sang CLI ban da dang nhap san: Claude Code, Gemini CLI,
 * Kiro / Amazon Q, hoac Ollama. Nho vay khong can dan API key vao extension,
 * va van la tai khoan chinh chu — khong dung lai cookie cua web app.
 */
import { parseJsonLoose } from '../lib/prompt.js';

const baseOf = (cfg) => (cfg.url || 'http://127.0.0.1:8765').replace(/\/$/, '');

/** Dich ma loi HTTP cua bridge sang cau nguoi dung lam duoc ngay. */
function explain(status, body, base) {
  let msg = '';
  try {
    msg = JSON.parse(body)?.error || '';
  } catch {
    msg = body;
  }
  if (status === 401) return 'Bridge yeu cau token. Dan dung token (--token khi chay bridge) vao Cai dat -> Local Bridge -> Token.';
  if (status === 403) return 'Bridge tu choi origin nay. Chay bridge phien ban moi (bridge/server.mjs trong repo).';
  return `Bridge ${status}: ${String(msg).slice(0, 300)} (${base})`;
}

export async function bridgeComplete({ cfg, system, user, schema, signal }) {
  const base = baseOf(cfg);
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.token) headers['X-Bridge-Token'] = cfg.token;

  let res;
  try {
    res = await fetch(`${base}/v1/complete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: cfg.model || 'default', system, user, schema }),
      signal,
    });
  } catch (e) {
    throw new Error(
      `Khong ket noi duoc Local Bridge tai ${base}. Mo terminal trong thu muc extension, chay "node bridge/server.mjs" roi thu lai. (${e.message})`
    );
  }

  if (!res.ok) throw new Error(explain(res.status, await res.text().catch(() => ''), base));

  const data = await res.json();
  const text = typeof data === 'string' ? data : data.text || data.output || JSON.stringify(data.json || {});
  return {
    raw: text,
    json: data.json || parseJsonLoose(text),
    usage: data.usage || null,
    // Backend that su da tra loi — de panel hien "Bridge -> claude"
    backend: data.backend || '',
    model: data.model || '',
    bin: data.bin || '',
  };
}

/**
 * Hoi /health. Tra ve { ok, backends, bins, detail, default, auth, error }.
 * Bridge cu (v0.2) khong co detail/default — UI phai chiu duoc thieu.
 */
export async function bridgeHealth(cfg) {
  const base = baseOf(cfg);
  try {
    const res = await fetch(`${base}/health`, {
      headers: cfg.token ? { 'X-Bridge-Token': cfg.token } : {},
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { ok: false, status: res.status, error: explain(res.status, await res.text().catch(() => ''), base) };
    return { ok: true, ...(await res.json()) };
  } catch (e) {
    const timeout = e?.name === 'TimeoutError';
    return {
      ok: false,
      offline: true,
      error: timeout
        ? `Bridge tai ${base} khong tra loi sau 3s.`
        : `Chua co bridge nao chay tai ${base}. Chay "node bridge/server.mjs" trong thu muc extension.`,
    };
  }
}
