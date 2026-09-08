/* AI Autofill Studio — providers/bridge.js
 * Goi toi Local Bridge chay tren may cua ban (bridge/server.mjs).
 * Bridge se chuyen tiep sang CLI ban da dang nhap san: Claude Code, Gemini CLI,
 * Kiro / Amazon Q, hoac Ollama. Nho vay khong can dan API key vao extension,
 * va van la tai khoan chinh chu — khong dung lai cookie cua web app.
 */
import { parseJsonLoose } from '../lib/prompt.js';

export async function bridgeComplete({ cfg, system, user, schema, signal }) {
  const base = (cfg.url || 'http://127.0.0.1:8765').replace(/\/$/, '');
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
      `Khong ket noi duoc Local Bridge tai ${base}. Chay "node bridge/server.mjs" roi thu lai. (${e.message})`
    );
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Bridge ${res.status}: ${t.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = typeof data === 'string' ? data : data.text || data.output || JSON.stringify(data.json || {});
  return { raw: text, json: data.json || parseJsonLoose(text), usage: data.usage || null };
}

export async function bridgeHealth(cfg) {
  const base = (cfg.url || 'http://127.0.0.1:8765').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/health`, { headers: cfg.token ? { 'X-Bridge-Token': cfg.token } : {} });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, ...(await res.json()) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
