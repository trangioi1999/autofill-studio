/* Autofill Studio — lib/storage.js */

export const DEFAULTS = {
  provider: 'gemini',

  gemini: {
    apiKey: '',
    model: 'gemini-2.5-flash',
    auth: 'apikey', // 'apikey' | 'oauth'
    project: '', // bat buoc khi auth = oauth (Vertex AI)
    location: 'us-central1',
    clientId: '', // OAuth Client ID kieu "Chrome Extension" hoac "Web"
  },

  anthropic: {
    apiKey: '',
    model: 'claude-sonnet-4-6',
    baseUrl: 'https://api.anthropic.com',
  },

  openai: {
    // Dung chung cho OpenAI, OpenRouter, DeepSeek, Groq, LM Studio, Kiro gateway...
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  },

  bridge: {
    url: 'http://127.0.0.1:8765',
    model: 'default',
    token: '',
  },

  chromeai: {
    model: 'builtin',
  },

  // Hanh vi
  language: 'vi',
  persona: '',
  deepScan: true,
  cdpMode: false, // dung chrome.debugger de gui event "trusted"
  typeDelay: 20,
  stopOnError: false,
  maxFields: 120,
  // O co danh sach lua chon (dropdown / multi / radio) ma AI bo trong hoac dua
  // gia tri khong khop -> tu chon ngau nhien, de form khong bi thieu
  randomGaps: true,
  // Sau khi dien, quet lai: o vua duoc mo khoa (phu thuoc o khac) thi dien tiep, toi da 2 luot
  fillDependents: true,

  // Agent
  agentMaxSteps: 12,

  // Bo nho theo man hinh
  autoSaveSnapshot: true, // tu luu lai gia tri sau moi lan autofill thanh cong
  autoSuggestSnapshot: true, // tu goi y ban luu khi mo mot trang da tung dien

  lastPrompt: '',
  history: [],
};

const deepMerge = (base, over) => {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
};

export async function getSettings() {
  const stored = await chrome.storage.local.get('settings');
  return deepMerge(DEFAULTS, stored.settings || {});
}

export async function setSettings(patch) {
  const cur = await getSettings();
  const next = deepMerge(cur, patch);
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function resetSettings() {
  await chrome.storage.local.set({ settings: {} });
  return DEFAULTS;
}

export async function pushHistory(entry) {
  const s = await getSettings();
  const history = [{ at: Date.now(), ...entry }, ...(s.history || [])].slice(0, 30);
  await setSettings({ history });
  return history;
}
