/* AI Autofill Studio — providers/gemini.js
 * Ho tro 2 duong: API key (Generative Language API) va OAuth chinh chu (Vertex AI).
 */
import { parseJsonLoose } from '../lib/prompt.js';

const TOKEN_KEY = 'gemini_oauth_token';

/* ------------------------------------------------------------------ OAuth */

export async function geminiOAuthLogin(cfg) {
  if (!cfg.clientId) throw new Error('Chua cau hinh Google OAuth Client ID trong Cai dat.');
  const redirect = chrome.identity.getRedirectURL('oauth2');
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: cfg.clientId,
      response_type: 'token',
      redirect_uri: redirect,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      prompt: 'consent',
      include_granted_scopes: 'true',
    }).toString();

  const resp = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  const frag = new URLSearchParams((resp.split('#')[1] || '').replace(/^\?/, ''));
  const token = frag.get('access_token');
  if (!token) throw new Error('Khong lay duoc access token tu Google');
  const expiresAt = Date.now() + (Number(frag.get('expires_in') || 3500) - 60) * 1000;
  await chrome.storage.local.set({ [TOKEN_KEY]: { token, expiresAt } });
  return token;
}

export async function geminiOAuthToken(cfg, { interactive = false } = {}) {
  const cached = (await chrome.storage.local.get(TOKEN_KEY))[TOKEN_KEY];
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  if (!interactive) throw new Error('Token Google het han — bam "Dang nhap Google" trong Cai dat.');
  return geminiOAuthLogin(cfg);
}

export async function geminiOAuthLogout() {
  await chrome.storage.local.remove(TOKEN_KEY);
}

/* ----------------------------------------------------------------- request */

const buildBody = (system, user, schema) => ({
  systemInstruction: { parts: [{ text: system }] },
  contents: [{ role: 'user', parts: [{ text: user }] }],
  generationConfig: {
    temperature: 0.4,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json',
    ...(schema ? { responseSchema: toGeminiSchema(schema) } : {}),
  },
  safetySettings: [],
});

/** Gemini khong nhan mot so keyword cua JSON Schema — loc bot. */
function toGeminiSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (['additionalProperties', '$schema', 'default', 'examples'].includes(k)) continue;
    if (k === 'type') out.type = String(v).toUpperCase();
    else if (k === 'properties') {
      out.properties = {};
      for (const [pk, pv] of Object.entries(v)) out.properties[pk] = toGeminiSchema(pv);
    } else if (k === 'items') out.items = toGeminiSchema(v);
    else out[k] = v;
  }
  return out;
}

const textOf = (data) => {
  const cand = data?.candidates?.[0];
  const parts = cand?.content?.parts || [];
  return parts.map((p) => p.text || '').join('');
};

export async function geminiComplete({ cfg, system, user, schema, signal }) {
  let url;
  const headers = { 'Content-Type': 'application/json' };

  if (cfg.auth === 'oauth') {
    if (!cfg.project) throw new Error('Che do OAuth can Google Cloud Project ID.');
    const token = await geminiOAuthToken(cfg, { interactive: false });
    const loc = cfg.location || 'us-central1';
    url = `https://${loc}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(
      cfg.project
    )}/locations/${loc}/publishers/google/models/${encodeURIComponent(cfg.model)}:generateContent`;
    headers.Authorization = `Bearer ${token}`;
  } else {
    if (!cfg.apiKey) throw new Error('Chua nhap Gemini API key.');
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      cfg.model
    )}:generateContent`;
    headers['x-goog-api-key'] = cfg.apiKey;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildBody(system, user, schema)),
    signal,
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = textOf(data);
  return { raw: text, json: parseJsonLoose(text), usage: data.usageMetadata || null };
}
