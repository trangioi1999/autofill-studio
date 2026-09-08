/* AI Autofill Studio — providers/chromeai.js
 * Chrome Built-in AI (Gemini Nano) qua Prompt API. Chay hoan toan tren may,
 * mien phi, khong can API key. Yeu cau Chrome >= 138 va model da tai ve.
 */
import { parseJsonLoose } from '../lib/prompt.js';

function api() {
  // Chrome 138+: self.LanguageModel. Ban cu hon: self.ai.languageModel.
  if (typeof self !== 'undefined' && self.LanguageModel) return self.LanguageModel;
  if (typeof self !== 'undefined' && self.ai && self.ai.languageModel) return self.ai.languageModel;
  return null;
}

export async function chromeaiAvailability() {
  const A = api();
  if (!A) return { ok: false, status: 'unavailable', reason: 'Trinh duyet nay chua co Prompt API (can Chrome 138+).' };
  try {
    const status = A.availability ? await A.availability() : await A.capabilities().then((c) => c.available);
    return { ok: status !== 'unavailable' && status !== 'no', status };
  } catch (e) {
    return { ok: false, status: 'error', reason: String(e && e.message) };
  }
}

export async function chromeaiComplete({ system, user, signal, onProgress }) {
  const A = api();
  if (!A) throw new Error('Chrome Built-in AI khong kha dung tren trinh duyet nay (can Chrome 138+).');

  const av = await chromeaiAvailability();
  if (!av.ok) throw new Error(`Built-in AI: ${av.status}. ${av.reason || ''}`);

  const session = await A.create({
    initialPrompts: [{ role: 'system', content: system }],
    temperature: 0.4,
    topK: 3,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => onProgress && onProgress(e.loaded));
    },
    signal,
  });

  try {
    const text = await session.prompt(
      user + '\n\nCHI tra ve JSON thuan, khong markdown, khong giai thich.',
      { signal }
    );
    return { raw: text, json: parseJsonLoose(text), usage: null };
  } finally {
    try {
      session.destroy();
    } catch {
      /* noop */
    }
  }
}
