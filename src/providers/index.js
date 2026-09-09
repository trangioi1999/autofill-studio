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
  return { ok: true, ms: Date.now() - t0, sample: r.raw.slice(0, 120), backend: r.backend || '', model: r.model || '' };
}

/**
 * Provider hien tai da san sang chua? Khong goi model, chi kiem tra cau hinh
 * (co key chua, bridge co chay khong, Chrome AI co san khong). Dung cho the
 * "ket noi AI" trong side panel de nguoi dung biet phai lam gi tiep.
 *
 * Tra ve { provider, ready, reason, hint, bridge?, chromeai? }
 */
export async function setupStatus(settings) {
  const p = settings.provider;
  const cfg = settings[p] || {};
  const out = { provider: p, ready: false, reason: '', hint: '' };

  if (p === 'gemini') {
    if (cfg.auth === 'oauth') {
      try {
        await geminiOAuthToken(cfg, { interactive: false });
        out.ready = !!cfg.project;
        if (!out.ready) out.reason = 'Thieu Google Cloud Project ID';
      } catch (e) {
        out.reason = e.message;
      }
    } else if (!cfg.apiKey) out.reason = 'Chua dan Gemini API key';
    else out.ready = true;
    return out;
  }
  if (p === 'anthropic' || p === 'openai') {
    if (cfg.apiKey) out.ready = true;
    else if (p === 'openai' && /127\.0\.0\.1|localhost/.test(cfg.baseUrl || '')) out.ready = true; // server local thuong khong can key
    else out.reason = `Chua dan ${p === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key`;
    return out;
  }
  if (p === 'chromeai') {
    const av = await chromeaiAvailability();
    out.chromeai = av;
    out.ready = av.ok && av.status !== 'downloadable' && av.status !== 'after-download';
    if (!av.ok) out.reason = av.reason || `Chrome AI: ${av.status}`;
    else if (!out.ready) out.reason = 'Gemini Nano chua tai ve — bam "Test ket noi" trong Cai dat de Chrome bat dau tai (~2GB)';
    return out;
  }
  if (p === 'bridge') {
    const h = await bridgeHealth(cfg);
    out.bridge = h;
    if (!h.ok) {
      out.reason = h.error;
      return out;
    }
    const names = h.backends || [];
    if (!names.length) {
      out.reason = 'Bridge dang chay nhung khong tim thay CLI nao (claude / gemini / kiro / ollama)';
      return out;
    }
    const want = String(cfg.model || 'default').split(':')[0].toLowerCase();
    const chosen = want && want !== 'default' && want !== 'auto' ? want : h.default?.name || names[0];
    if (chosen && !names.includes(chosen) && !['q', 'kiro-cli', 'amazon-q'].includes(chosen)) {
      out.reason = `Backend "${chosen}" khong co tren may. Co: ${names.join(', ')}`;
      out.hint = 'Doi backend trong Cai dat -> Local Bridge';
      return out;
    }
    out.ready = true;
    out.backend = chosen;
    return out;
  }
  out.reason = `Provider khong hop le: ${p}`;
  return out;
}

export { geminiOAuthLogin, geminiOAuthLogout, geminiOAuthToken, chromeaiAvailability, bridgeHealth };
