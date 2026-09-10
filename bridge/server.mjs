#!/usr/bin/env node
/* Autofill Studio — Local Bridge
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
 *         node bridge/server.mjs --backend gemini
 *         node bridge/server.mjs --backend ollama:qwen2.5:7b --port 8765 --token bimat
 *         node bridge/server.mjs --list
 *
 * Co dong lenh giong nhau tren moi shell (bash, PowerShell, cmd). Bien moi
 * truong AF_* van dung duoc, co dong lenh se de len bien moi truong.
 */

import http from 'node:http';
import { spawn } from 'node:child_process';

const VERSION = '0.3.0';

/* ------------------------------------------------------------------- args */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));

if (ARGS.help || ARGS.h) {
  console.log(`Autofill Studio — Local Bridge v${VERSION}

Cach dung:
  node bridge/server.mjs [tuy chon]

Tuy chon (co dong lenh de len bien moi truong):
  --backend <ten[:model]>  Backend mac dinh khi extension de "Tu chon".
                           VD: claude · claude:sonnet · gemini · kiro · ollama:qwen2.5:7b
                           (AF_BACKEND)
  --port <so>              Cong lang nghe, mac dinh 8765            (AF_PORT)
  --host <dia chi>         Mac dinh 127.0.0.1                         (AF_HOST)
  --token <chuoi>          Bat buoc extension gui dung token nay    (AF_TOKEN)
  --timeout <ms>           Thoi gian cho CLI tra loi, mac dinh 120000 (AF_TIMEOUT)
  --ollama <url>           Dia chi Ollama, mac dinh http://127.0.0.1:11434 (AF_OLLAMA)
  --cmd "<lenh>"           Lenh tuy y nhan prompt qua stdin          (AF_CMD)
  --list                   Chi in danh sach backend tim thay roi thoat
  --help                   In huong dan nay

Trong extension: Cai dat -> Provider = Local Bridge. Bridge tu tim CLI tren
PATH; muon doi backend thi chon trong dropdown cua extension hoac dung --backend.`);
  process.exit(0);
}

const opt = (flag, env, fallback) => {
  const v = ARGS[flag];
  if (v != null && v !== true) return String(v);
  if (process.env[env]) return process.env[env];
  return fallback;
};

const PORT = Number(opt('port', 'AF_PORT', 8765));
const HOST = opt('host', 'AF_HOST', '127.0.0.1');
const TOKEN = opt('token', 'AF_TOKEN', '');
const OLLAMA = opt('ollama', 'AF_OLLAMA', 'http://127.0.0.1:11434').replace(/\/$/, '');
const TIMEOUT = Number(opt('timeout', 'AF_TIMEOUT', 120000));
const CUSTOM_CMD = opt('cmd', 'AF_CMD', '');
const DEFAULT_BACKEND = opt('backend', 'AF_BACKEND', '');
const ALLOW_ANY_ORIGIN = !!(ARGS['allow-any-origin'] || process.env.AF_ALLOW_ANY_ORIGIN);

/* ------------------------------------------------------------------ utils */

/**
 * Chi nhan request tu extension (chrome-extension://...) hoac tu cong cu
 * dong lenh (khong co Origin). Trang web bat ky mo trong trinh duyet KHONG
 * duoc goi bridge — neu khong, mot trang xau co the dung subscription cua
 * ban ma ban khong biet.
 */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (ALLOW_ANY_ORIGIN) return true;
  return /^(chrome|moz|safari-web)-extension:\/\//i.test(origin);
}

const corsHeaders = (req) => ({
  'Access-Control-Allow-Origin': req.headers.origin || '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Bridge-Token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '600',
});

const json = (req, res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...corsHeaders(req),
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

const IS_WIN = process.platform === 'win32';

/** Boc doi so cho cmd.exe. Chi dung khi buoc phai di qua shim .cmd/.bat. */
const winQuote = (a) => `"${String(a).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    // Tren Windows, CLI cai bang npm thuong la shim .cmd/.bat — Node chi chay
    // duoc chung qua cmd.exe. Con lai luon spawn truc tiep (shell: false) de
    // noi dung trang khong bao gio bi shell dien giai.
    let bin = cmd;
    let argv = args;
    let opts = { stdio: ['pipe', 'pipe', 'pipe'] };

    if (IS_WIN && /\.(cmd|bat)$/i.test(cmd)) {
      if (args.some((a) => /[\r\n]/.test(String(a)))) {
        return reject(
          new Error(
            `"${cmd}" la shim .cmd nen doi so khong duoc chua xuong dong. ` +
              'Dat AF_CMD tro thang toi file .exe, hoac dung backend khac.'
          )
        );
      }
      bin = process.env.ComSpec || 'cmd.exe';
      // Co /s cua cmd.exe cat dau nhay DAU va CUOI cua ca chuoi sau /c. Neu
      // khong boc them mot cap nhay ngoai cung, `"x.cmd" "a" "b"` bien thanh
      // `x.cmd" "a" "b` va cmd bao "is not recognized". Node (shell: true)
      // cung lam dung nhu vay: /d /s /c "<lenh>".
      const line = [winQuote(cmd), ...args.map(winQuote)].join(' ');
      argv = ['/d', '/s', '/c', `"${line}"`];
      opts.windowsVerbatimArguments = true;
    }

    const p = spawn(bin, argv, opts);
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

/**
 * Tra ve duong dan day du cua lenh, hoac null.
 * Duong dan day du quan trong tren Windows: ta can biet no la .exe hay .cmd
 * de quyet dinh co phai di qua cmd.exe hay khong.
 */
/**
 * Tren Windows, `where claude` thuong tra ve nhieu dong:
 *   C:\Users\x\AppData\Roaming\npm\claude        <- script bash cho Git Bash, Node KHONG spawn duoc (ENOENT)
 *   C:\Users\x\AppData\Roaming\npm\claude.cmd    <- cai chay duoc
 * Nen phai chon dong co duoi thuc thi (.exe > .com > .cmd > .bat theo PATHEXT),
 * khong lay dong dau tien.
 */
function pickWinBinary(lines) {
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  // .exe truoc .cmd: chay truc tiep, khong phai qua cmd.exe
  const order = ['.exe', '.com', '.cmd', '.bat', ...exts];
  for (const ext of order) {
    const hit = lines.find((l) => l.toLowerCase().endsWith(ext));
    if (hit) return hit;
  }
  return lines[0] || null;
}

const which = async (cmd) => {
  try {
    const out = await run(IS_WIN ? 'where' : 'which', [cmd]);
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return IS_WIN ? pickWinBinary(lines) : lines[0] || null;
  } catch {
    return null;
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
  // kiro-cli.exe truoc: do la CLI that. `kiro.cmd` tren Windows co the chi la
  // shim mo IDE Kiro, khong nhan `chat`. `q` la ban Amazon Q Developer cu.
  kiro: ['kiro-cli', 'kiro', 'q'],
};

/** Ten hien thi + cach dang nhap, de bao loi cho dung cho. */
const BACKEND_INFO = {
  claude: { label: 'Claude Code CLI', login: 'chay `claude` roi go /login' },
  gemini: { label: 'Gemini CLI', login: 'chay `gemini` roi go /auth' },
  kiro: { label: 'Kiro CLI (Amazon Q)', login: 'chay `kiro login` (hoac `q login`)' },
  ollama: { label: 'Ollama', login: 'chay `ollama serve` va `ollama pull <model>`' },
  custom: { label: 'Lenh tuy y (AF_CMD)', login: '' },
};

const BIN_TTL = 15000;
const binCache = new Map(); // logical -> { bin, name, at }

async function resolveBin(logical) {
  const hit = binCache.get(logical);
  if (hit && Date.now() - hit.at < BIN_TTL) return hit.bin;
  let bin = null;
  let name = null;
  for (const c of BIN_CANDIDATES[logical] || [logical]) {
    const found = await which(c);
    if (found) {
      bin = found;
      name = c;
      break;
    }
  }
  binCache.set(logical, { bin, name, at: Date.now() });
  return bin;
}

/** Ten ngan de hien thi (claude, kiro...) thay vi ca duong dan. */
async function resolveName(logical) {
  await resolveBin(logical);
  return binCache.get(logical)?.name || null;
}

async function runBin(logical, args, input) {
  const bin = await resolveBin(logical);
  if (!bin) {
    const tried = (BIN_CANDIDATES[logical] || [logical]).join(', ');
    throw new Error(`Khong tim thay CLI cho "${logical}" tren PATH (da thu: ${tried})`);
  }
  try {
    return await run(bin, args, input);
  } catch (e) {
    // CLI chua dang nhap thi bao thang cach dang nhap, thay vi in stderr kho hieu
    if (/log ?in|auth|credential|unauthori[sz]ed|api key|sign ?in/i.test(e.message)) {
      const how = BACKEND_INFO[logical]?.login;
      throw new Error(`${e.message}\n→ Co ve ${logical} chua dang nhap. ${how ? 'Hay ' + how + '.' : ''}`);
    }
    throw e;
  }
}

/** Danh sach model Ollama dang co, hoac null neu Ollama khong chay. */
let ollamaCache = { at: 0, models: null };
async function ollamaModels() {
  if (Date.now() - ollamaCache.at < BIN_TTL) return ollamaCache.models;
  let models = null;
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) {
      const data = await r.json();
      models = (data?.models || []).map((m) => m.name).filter(Boolean);
    }
  } catch {
    /* Ollama khong chay */
  }
  ollamaCache = { at: Date.now(), models };
  return models;
}

/** Danh sach backend dang co, kem ten binary that su. */
async function availableBackends() {
  const out = [];
  for (const logical of Object.keys(BIN_CANDIDATES)) {
    const bin = await resolveBin(logical);
    if (bin) {
      out.push({
        name: logical,
        label: BACKEND_INFO[logical].label,
        bin: (await resolveName(logical)) || bin,
        path: bin,
      });
    }
  }
  const models = await ollamaModels();
  if (models) out.push({ name: 'ollama', label: BACKEND_INFO.ollama.label, bin: OLLAMA, models });
  if (CUSTOM_CMD) out.push({ name: 'custom', label: BACKEND_INFO.custom.label, bin: CUSTOM_CMD });
  return out;
}

/**
 * Tach mot dong lenh thanh [bin, ...args], ton trong dau nhay.
 * Can thiet tren Windows vi duong dan hay co dau cach:
 *   AF_CMD='"C:\\Program Files\\ai\\cli.exe" --json'
 */
function tokenize(line) {
  const out = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (const ch of String(line)) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
    }
  }
  if (cur || has) out.push(cur);
  return out;
}

/* --------------------------------------------------------------- backends */

const stripFence = (t) =>
  String(t || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

const joinPrompt = (system, user) => `${system}\n\n---\n\n${user}`;

/**
 * Moi backend nhan { system, user, model } trong do `model` la phan sau dau
 * hai cham cua backend spec (VD "claude:sonnet" -> "sonnet"), co the rong.
 */
const backends = {
  async claude({ system, user, model }) {
    // Claude Code CLI o che do headless.
    // System prompt di qua stdin chu khong qua argv: no dai va co xuong dong,
    // ma argv nhieu dong thi vo tren Windows (va la duong cho noi dung trang
    // lot vao dong lenh).
    const args = ['-p', '--output-format', 'text'];
    if (model) args.push('--model', model);
    return runBin('claude', args, joinPrompt(system, user));
  },

  async gemini({ system, user, model }) {
    const args = ['-p', joinPrompt(system, user)];
    if (model) args.push('-m', model);
    return runBin('gemini', args);
  },

  async kiro({ system, user, model }) {
    // Kiro CLI (`kiro`) — truoc day la Amazon Q Developer CLI (`q`).
    // Ca hai deu nhan cung bo co: chat --no-interactive --trust-all-tools
    const args = ['chat', '--no-interactive', '--trust-all-tools'];
    if (model) args.push('--model', model);
    return runBin('kiro', args, joinPrompt(system, user));
  },

  async ollama({ system, user, model }) {
    let name = model;
    if (!name) {
      // Khong chi dinh model thi lay model dau tien dang co tren may
      const list = await ollamaModels();
      name = list?.[0] || 'qwen2.5:7b';
    }
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
    return { text: data?.message?.content || '', model: name };
  },

  async custom({ system, user }) {
    if (!CUSTOM_CMD) throw new Error('Chua dat bien moi truong AF_CMD (hoac --cmd)');
    const [bin, ...args] = tokenize(CUSTOM_CMD);
    if (!bin) throw new Error('AF_CMD rong');
    return run(bin, args, joinPrompt(system, user));
  },
};

const ALIASES = {
  q: 'kiro',
  'amazon-q': 'kiro',
  amazonq: 'kiro',
  'kiro-cli': 'kiro',
  'claude-code': 'claude',
  auto: null,
  default: null,
  '': null,
};

/**
 * "claude:sonnet" -> { name: 'claude', model: 'sonnet' }
 * "ollama:qwen2.5:7b" -> { name: 'ollama', model: 'qwen2.5:7b' }
 * "default" / "" -> { name: null }
 */
function parseSpec(spec) {
  const raw = String(spec || '').trim();
  const i = raw.indexOf(':');
  const head = (i >= 0 ? raw.slice(0, i) : raw).toLowerCase();
  const model = i >= 0 ? raw.slice(i + 1).trim() : '';
  const name = ALIASES[head] !== undefined ? ALIASES[head] : head;
  return { name, model };
}

/**
 * Thu tu uu tien:
 *   1. extension chi dinh ro (VD "gemini")
 *   2. --backend / AF_BACKEND khi khoi dong server
 *   3. tu chon: CLI dau tien tim thay, cuoi cung moi den Ollama
 */
async function pickBackend(requested) {
  const fromReq = parseSpec(requested);
  if (fromReq.name) {
    if (!backends[fromReq.name]) throw new Error(`Backend "${fromReq.name}" khong ton tai (co: ${Object.keys(backends).join(', ')})`);
    return { ...fromReq, why: 'extension' };
  }
  const fromFlag = parseSpec(DEFAULT_BACKEND);
  if (fromFlag.name) {
    if (!backends[fromFlag.name]) throw new Error(`--backend "${fromFlag.name}" khong ton tai (co: ${Object.keys(backends).join(', ')})`);
    return { ...fromFlag, why: 'flag' };
  }
  const found = await availableBackends();
  if (found.length) return { name: found[0].name, model: '', why: 'auto' };
  throw new Error(
    'Khong tim thay backend nao (claude / gemini / kiro / q / ollama). Cai 1 trong so do, dang nhap, roi chay lai bridge.'
  );
}

/** Ten backend ma "Tu chon" se dung — de extension hien cho nguoi dung biet. */
async function defaultBackend() {
  try {
    const p = await pickBackend('');
    return { name: p.name, model: p.model, why: p.why };
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- server */

async function healthPayload() {
  const found = await availableBackends();
  const def = await defaultBackend();
  return {
    ok: true,
    version: VERSION,
    // Giu 2 truong cu de extension ban cu van chay
    backends: found.map((b) => b.name),
    bins: Object.fromEntries(found.map((b) => [b.name, b.bin])),
    // Chi tiet cho UI moi: label, duong dan, model (Ollama)
    detail: found,
    default: def, // { name, model, why: 'flag' | 'auto' } hoac null
    auth: TOKEN ? 'token' : 'none',
    platform: process.platform,
  };
}

const server = http.createServer(async (req, res) => {
  if (!originAllowed(req)) {
    return json(req, res, 403, {
      error: `Origin "${req.headers.origin}" khong duoc phep. Bridge chi nhan request tu extension.`,
    });
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }

  if (TOKEN && req.headers['x-bridge-token'] !== TOKEN) {
    return json(req, res, 401, {
      error: 'Sai token. Bridge dang chay voi --token; dan dung token vao Cai dat -> Local Bridge -> Token.',
      auth: 'token',
    });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/health') return json(req, res, 200, await healthPayload());

  if (url.pathname === '/v1/complete' && req.method === 'POST') {
    let picked = null;
    try {
      const { system = '', user = '', model = 'default' } = await readBody(req);
      picked = await pickBackend(model);
      const t0 = Date.now();
      const out = await backends[picked.name]({ system, user, model: picked.model });
      const text = stripFence(typeof out === 'string' ? out : out.text);
      const usedModel = typeof out === 'string' ? picked.model : out.model || picked.model;
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
      const bin = (await resolveName(picked.name)) || picked.name;
      console.log(`  ${new Date().toLocaleTimeString()}  ${picked.name}${usedModel ? ':' + usedModel : ''}  ${Date.now() - t0}ms  (${picked.why})`);
      return json(req, res, 200, {
        ok: true,
        backend: picked.name,
        bin,
        model: usedModel || '',
        why: picked.why,
        ms: Date.now() - t0,
        text,
        json: parsed,
      });
    } catch (e) {
      console.log(`  ${new Date().toLocaleTimeString()}  ${picked?.name || '?'}  LOI: ${e.message.split('\n')[0]}`);
      return json(req, res, 500, { error: e.message, backend: picked?.name || null });
    }
  }

  return json(req, res, 404, { error: 'Not found' });
});

/** In danh sach backend ra console, danh dau cai mac dinh. */
async function printBackends() {
  const found = await availableBackends();
  const def = await defaultBackend();
  if (!found.length) {
    console.log('  Backend: (khong tim thay CLI nao tren PATH, Ollama cung khong chay)');
    console.log('  → Cai va dang nhap 1 trong: claude · gemini · kiro · ollama, roi chay lai.');
    return;
  }
  console.log('  Backend tim thay:');
  for (const b of found) {
    const star = def && def.name === b.name ? '★' : ' ';
    let extra = '';
    if (b.models) extra = b.models.length ? `  model: ${b.models.slice(0, 6).join(', ')}${b.models.length > 6 ? '…' : ''}` : '  (chua pull model nao)';
    else if (b.bin !== b.name) extra = `  (binary: ${b.bin})`;
    console.log(`   ${star} ${b.name.padEnd(8)} ${b.label}${extra}`);
  }
  if (def) {
    const src = def.why === 'flag' ? 'theo --backend' : 'tu chon: cai dau tien tim thay';
    console.log(`  ★ Mac dinh: ${def.name}${def.model ? ':' + def.model : ''}  (${src})`);
    if (found.length > 1 && def.why !== 'flag') {
      console.log(`  Doi mac dinh:  node bridge/server.mjs --backend ${found.find((b) => b.name !== def.name)?.name || 'gemini'}`);
      console.log('  Hoac chon truc tiep trong extension: Cai dat -> Local Bridge -> Backend.');
    }
  }
}

if (ARGS.list) {
  await printBackends();
  process.exit(0);
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Cong ${PORT} dang bi chiem (co the bridge khac dang chay). Thu: node bridge/server.mjs --port ${PORT + 1}`);
  } else console.error(`Khong mo duoc server: ${e.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, async () => {
  console.log(`Autofill Studio Bridge v${VERSION} dang chay tai http://${HOST}:${PORT}`);
  await printBackends();
  console.log(TOKEN ? '  Token: BAT — extension phai dan dung token nay' : '  Token: tat (chi extension tren may nay goi duoc)');
  console.log('  Trong extension: Cai dat -> Provider = Local Bridge -> Test ket noi');
  console.log('');
});
