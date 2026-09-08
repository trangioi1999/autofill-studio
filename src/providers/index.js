/* Autofill Studio — providers/index.js */
import { geminiComplete, geminiOAuthLogin, geminiOAuthLogout, geminiOAuthToken } from './gemini.js';
import { anthropicComplete } from './anthropic.js';
import { openaiComplete } from './openai.js';
import { chromeaiComplete, chromeaiAvailability } from './chromeai.js';
import { bridgeComplete, bridgeHealth } from './bridge.js';

export const PROVIDERS = {
  gemini: { label: 'Google Gemini', needsKey: true },
  anthropic: { label: 'Anthropic Claude', needsKey: true },
  openai: { label: 'OpenAI-compatible (OpenAI / OpenRouter / DeepSeek / LM Studio / Kiro gateway)', needsKey: true },
  chromeai: { label: 'Chrome Built-in AI (Gemini Nano — offline, mien phi)', needsKey: false },
  bridge: { label: 'Local Bridge (Claude CLI / Gemini CLI / Kiro / Ollama)', needsKey: false },
};

export async function complete({ settings, system, user, schema, signal, onProgress }) {
  const p = settings.provider;
  switch (p) {
    case 'gemini':
      return geminiComplete({ cfg: settings.gemini, system, user, schema, signal });
    case 'anthropic':
      return anthropicComplete({ cfg: settings.anthropic, system, user, schema, signal });
    case 'openai':
      return openaiComplete({ cfg: settings.openai, system, user, schema, signal });
    case 'chromeai':
      return chromeaiComplete({ system, user, signal, onProgress });
    case 'bridge':
      return bridgeComplete({ cfg: settings.bridge, system, user, schema, signal });
    default:
      throw new Error(`Provider khong hop le: ${p}`);
  }
}

/** Kiem tra ket noi tung provider — dung cho nut "Test" trong Cai dat. */
export async function testProvider(settings) {
  const system = 'Ban la mot API tra ve JSON.';
  const user = 'Tra ve chinh xac JSON nay va khong gi khac: {"ok":true}';
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };

  if (settings.provider === 'chromeai') {
    const av = await chromeaiAvailability();
    if (!av.ok) return { ok: false, error: `${av.status}: ${av.reason || ''}` };
  }
  if (settings.provider === 'bridge') {
    const h = await bridgeHealth(settings.bridge);
    if (!h.ok) return { ok: false, error: h.error };
  }

  const t0 = Date.now();
  const r = await complete({ settings, system, user, schema });
  return { ok: true, ms: Date.now() - t0, sample: r.raw.slice(0, 120) };
}

export { geminiOAuthLogin, geminiOAuthLogout, geminiOAuthToken, chromeaiAvailability, bridgeHealth };
