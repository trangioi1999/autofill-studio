#!/usr/bin/env node
/* AI Autofill Studio — Local Bridge
 *
 * Chay tren may cua ban, lam cau noi giua extension va cac cong cu AI ban DA
 * dang nhap san bang tai khoan chinh chu:
 *   - Claude Code CLI   (`claude`)
 *   - Gemini CLI        (`gemini`)
 *   - Kiro CLI          (`kiro`, hoac `q` neu con ban Amazon Q Developer cu)
 *   - Ollama            (http://127.0.0.1:11434)
 *   - Lenh tuy y        (bien moi truong AF_CMD)
 *
 * Nho vay ban khong phai dan API key vao trinh duyet, va cung khong phai
 * muon cookie cua web app — moi thu di qua CLI hop le cua chinh ban.
 *
 * Chay:   node bridge/server.mjs
 *         AF_PORT=8765 AF_TOKEN=bimat node bridge/server.mjs
 */

import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.AF_PORT || 8765);
const HOST = process.env.AF_HOST || '127.0.0.1';
const TOKEN = process.env.AF_TOKEN || '';
const OLLAMA = process.env.AF_OLLAMA || 'http://127.0.0.1:11434';
const TIMEOUT = Number(process.env.AF_TIMEOUT || 120000);

/* ------------------------------------------------------------------ utils */

const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Bridge-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5e6) reject(new Error('Body qua lon'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error(`${cmd} qua ${TIMEOUT}ms khong tra loi`));
    }, TIMEOUT);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Khong chay duoc "${cmd}": ${e.message}`));
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`${cmd} thoat voi ma ${code}: ${(err || out).slice(0, 500)}`));
    });
    if (input != null) {
      p.stdin.write(input);
      p.stdin.end();
    }
  });
}

const which = async (cmd) => {
  try {
    await run(process.platform === 'win32' ? 'where' : 'which', [cmd]);
    return true;
  } catch {
    return false;
  }
};

/* ------------------------------------------------------- binary resolution
 * Mot backend logic co the mang nhieu ten binary khac nhau tuy phien ban.
 * Vi du Amazon Q Developer CLI (`q`) da doi ten thanh Kiro CLI (`kiro`), nen
 * ta thu lan luot va dung cai nao co that tren may.
 */

const BIN_CANDIDATES = {
  claude: ['claude'],
  gemini: ['gemini'],
  kiro: ['kiro', 'kiro-cli', 'q'], // Kiro CLI moi truoc, Amazon Q Developer cu sau
};

const BIN_TTL = 15000;
const binCache = new Map(); // logical -> { bin, at }

async function resolveBin(logical) {
  const hit = binCache.get(logical);
  if (hit && Date.now() - hit.at < BIN_TTL) return hit.bin;
  let bin = null;
  for (const c of BIN_CANDIDATES[logical] || [logical]) {
    if (await which(c)) {
      bin = c;
      break;
    }
  }
  binCache.set(logical, { bin, at: Date.now() });
  return bin;
}

async function runBin(logical, args, input) {
  const bin = await resolveBin(logical);
  if (!bin) {
    const tried = (BIN_CANDIDATES[logical] || [logical]).join(', ');
    throw new Error(`Khong tim thay CLI cho "${logical}" tren PATH (da thu: ${tried})`);
  }
  return run(bin, args, input);
}

/** Danh sach backend dang co, kem ten binary that su. */
async function availableBackends() {
  const out = [];
  for (const logical of Object.keys(BIN_CANDIDATES)) {
    const bin = await resolveBin(logical);
    if (bin) out.push({ name: logical, bin });
  }
  try {
    const r = await fetch(`${OLLAMA}/api/tags`);
    if (r.ok) out.push({ name: 'ollama', bin: OLLAMA });
  } catch {
    /* noop */
  }
  return out;
}

/* --------------------------------------------------------------- backends */

const stripFence = (t) =>
  String(t || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

const backends = {
  async claude({ system, user }) {
    // Claude Code CLI o che do headless
    return runBin('claude', ['-p', '--output-format', 'text', '--append-system-prompt', system], user);
  },

  async gemini({ system, user }) {
    return runBin('gemini', ['-p', `${system}\n\n---\n\n${user}`]);
  },

  async kiro({ system, user }) {
    // Kiro CLI (`kiro`) — truoc day la Amazon Q Developer CLI (`q`).
    // Ca hai deu nhan cung bo co: chat --no-interactive --trust-all-tools
    return runBin('kiro', ['chat', '--no-interactive', '--trust-all-tools'], `${system}\n\n---\n\n${user}`);
  },

  async ollama({ system, user, model }) {
    const name = model.includes(':') ? model.split(':').slice(1).join(':') : 'qwen2.5:7b';
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: name,
        stream: false,
        format: 'json',
        options: { temperature: 0.4 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data?.message?.content || '';
  },

  async custom({ system, user }) {
    const cmd = process.env.AF_CMD;
    if (!cmd) throw new Error('Chua dat bien moi truong AF_CMD');
    const [bin, ...args] = cmd.split(' ');
    return run(bin, args, `${system}\n\n---\n\n${user}`);
  },
};

const ALIASES = {
  q: 'kiro',
  'amazon-q': 'kiro',
  amazonq: 'kiro',
  'kiro-cli': 'kiro',
  'claude-code': 'claude',
  default: null,
};

async function pickBackend(model) {
  const key = String(model || 'default').toLowerCase();
  const name = ALIASES[key] !== undefined ? ALIASES[key] : key.split(':')[0];
  if (name && backends[name]) return name;
  // tu do: uu tien CLI co san, cuoi cung moi den Ollama
  const found = await availableBackends();
  if (found.length) return found[0].name;
  throw new Error(
    'Khong tim thay backend nao (claude / gemini / kiro / q / ollama). Cai 1 trong so do hoac dat AF_CMD.'
  );
}

/* ----------------------------------------------------------------- server */

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});

  if (TOKEN && req.headers['x-bridge-token'] !== TOKEN) return json(res, 401, { error: 'Sai token' });

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/health') {
    const found = await availableBackends();
    return json(res, 200, {
      ok: true,
      version: '0.2.0',
      backends: found.map((b) => b.name),
      // ten binary that su, de UI hien "kiro (q)" khi may con ban Amazon Q cu
      bins: Object.fromEntries(found.map((b) => [b.name, b.bin])),
    });
  }

  if (url.pathname === '/v1/complete' && req.method === 'POST') {
    try {
      const { system = '', user = '', model = 'default' } = await readBody(req);
      const name = await pickBackend(model);
      const t0 = Date.now();
      const text = stripFence(await backends[name]({ system, user, model }));
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        const a = text.indexOf('{');
        const b = text.lastIndexOf('}');
        if (a >= 0 && b > a) {
          try {
            parsed = JSON.parse(text.slice(a, b + 1));
          } catch {
            /* noop */
          }
        }
      }
      return json(res, 200, { ok: true, backend: name, ms: Date.now() - t0, text, json: parsed });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  return json(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, async () => {
  const found = await availableBackends();
  const label = found.map((b) => (b.name === b.bin ? b.name : `${b.name} (binary: ${b.bin})`)).join(', ');
  console.log(`Autofill Studio Bridge dang chay tai http://${HOST}:${PORT}`);
  console.log(`  Backend tim thay: ${label || '(khong co CLI nao — se thu Ollama)'}`);
  if (TOKEN) console.log('  Token: da bat');
  console.log('  Trong extension: Cai dat -> Provider = Local Bridge');
});
