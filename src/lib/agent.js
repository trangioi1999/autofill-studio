/* Autofill Studio — lib/agent.js
 * Vong lap agent: chup trang -> model chon hanh dong -> chay -> chup lai.
 *
 * Model khong duoc nhin thay DOM. No chi thay mot ban do phang, moi dong mot
 * element kem ref (e1, e2...). Ref do service worker danh so lai sau moi lan
 * chup, va anh xa nguoc ve { frameId, afId } — model khong bao gio phai biet
 * frame hay selector la gi.
 */

export const MAX_STEPS_DEFAULT = 12;

export const TOOLS = [
  ['fill', 'ref, value', 'Dat gia tri cho o nhap lieu (xoa cai cu truoc)'],
  ['type', 'ref, value', 'Go tung ky tu — dung cho o co autocomplete/mask'],
  ['select', 'ref, value', 'Chon trong dropdown. Nhieu gia tri thi ngan bang |'],
  ['check', 'ref, value', 'Tick checkbox / toggle. value = "true" hoac "false"'],
  ['radio', 'ref, value', 'Chon mot lua chon trong nhom radio, value la nhan'],
  ['upload', 'ref, value', 'Nap file, value la ten file'],
  ['click', 'ref', 'Bam vao element'],
  ['press', 'key, ref', 'Go phim: Enter, Tab, Escape, ArrowDown...'],
  ['scroll', 'direction', 'Cuon trang: "down" hoac "up"'],
  ['navigate', 'url', 'Mo mot dia chi khac'],
  ['back', '', 'Quay lai trang truoc'],
  ['wait', 'text, ms', 'Cho toi khi thay doan chu, hoac cho ms mili giay'],
  ['read', 'query', 'Doc chu tren trang (loc theo query neu co)'],
];

export const AGENT_SCHEMA = {
  type: 'object',
  properties: {
    thought: { type: 'string', description: 'Mot cau ngan: dang o dau, dinh lam gi tiep' },
    actions: {
      type: 'array',
      description: 'Cac hanh dong chay lien tiep trong luot nay. De rong neu da xong.',
      items: {
        type: 'object',
        properties: {
          tool: { type: 'string', enum: TOOLS.map((t) => t[0]) },
          ref: { type: 'string', description: 'ref cua element, vi du "e7"' },
          value: { type: 'string' },
          key: { type: 'string' },
          url: { type: 'string' },
          direction: { type: 'string' },
          text: { type: 'string' },
          ms: { type: 'number' },
          query: { type: 'string' },
        },
        required: ['tool'],
      },
    },
    status: {
      type: 'string',
      enum: ['continue', 'done', 'blocked'],
      description: 'continue = con viec; done = xong muc tieu; blocked = khong the di tiep',
    },
    summary: { type: 'string', description: 'Bat buoc khi status la done hoac blocked' },
  },
  required: ['thought', 'actions', 'status'],
};

export const AGENT_SYSTEM = `Ban la mot agent dieu khien trinh duyet, chay ben trong mot extension Chrome.

Nguoi dung dua ban MUC TIEU. Ban khong nhin thay man hinh — ban chi thay mot ban do phang cua trang: moi dong la mot element, dang

  <ref>  <role>  "<ten>"  [co the co * neu bat buoc, = gia tri hien tai, -> link]

Moi luot, ban tra ve mot nhom hanh dong chay lien tiep, roi he thong chup lai trang va dua ban ban do moi. Cu the lap den khi xong.

CONG CU
${TOOLS.map(([n, a, d]) => `- ${n}(${a}) — ${d}`).join('\n')}

QUY TAC
1. Chi tra ve JSON dung schema. Khong markdown, khong giai thich ngoai JSON.
2. Chi dung ref CO THAT trong ban do o luot nay. Ref doi so sau moi lan chup — tuyet doi khong dung lai ref cua luot truoc.
3. Gom nhieu hanh dong vao mot luot khi chung doc lap (dien 8 o cung luc). Nhung neu mot hanh dong lam trang doi (click "Tiep tuc", mo dialog, navigate) thi de no la hanh dong CUOI cua luot.
4. Sau khi trang doi, doc ky ban do moi truoc khi lam tiep. Neu thay ERRORS thi sua cho sai roi thu lai.
5. Field co gia tri dung san thi bo qua, dung dien lai.
6. Khong tim thay thu can tim: thu scroll xuong, hoac read de doc noi dung, roi moi ket luan.
7. Xong muc tieu thi status = "done" kem summary. Khong the di tiep (can dang nhap, captcha, thieu du lieu) thi status = "blocked" kem ly do cu the.
8. Dung lap lai y het mot hanh dong da that bai hai lan — doi cach khac hoac bao blocked.

AN TOAN — khong the thuong luong
- KHONG dien mat khau, ma OTP, ma xac thuc, so the tin dung, CVV, PIN.
- KHONG tu bam cac nut gay hau qua that khong the hoan tac: thanh toan, dat hang, chuyen tien, xoa vinh vien, gui don chinh thuc — TRU KHI muc tieu cua nguoi dung noi ro rang phai lam viec do.
- KHONG tao thong tin gia mao mot nguoi that hoac to chuc that.
- Gap captcha thi bao blocked, dung co thu vuot qua.`;

/* ------------------------------------------------------- ve ban do cho model */

const roleWidth = 9;

/** Danh so ref e1..eN va tra ve ca ban do chu lan bang tra nguoc. */
export function renderSnapshot(frames) {
  const refMap = new Map(); // "e7" -> { frameId, afId }
  const lines = [];
  let n = 0;

  for (const fr of frames) {
    if (fr.frameId !== 0 && fr.nodes.length) lines.push(`  --- iframe: ${short(fr.url)} ---`);
    for (const node of fr.nodes) {
      if (node.kind === 'text') {
        lines.push(`      ${node.role.padEnd(roleWidth)} "${node.name}"`);
        continue;
      }
      const ref = `e${++n}`;
      refMap.set(ref, { frameId: fr.frameId, afId: node.afId, name: node.name, role: node.role });

      let line = `${ref.padEnd(5)} ${node.role.padEnd(roleWidth)} "${node.name}"`;
      if (node.required) line += ' *';
      if (node.value) line += ` = "${node.value}"`;
      if (node.href) line += ` -> ${short(node.href, 60)}`;
      if (node.disabled) line += ' [disabled]';
      lines.push(line);
    }
  }

  return { text: lines.join('\n') || '(trang khong co element nao doc duoc)', refMap, count: n };
}

const short = (s, n = 70) => (String(s || '').length > n ? String(s).slice(0, n) + '…' : String(s || ''));

export function renderState(state) {
  const bits = [
    `URL: ${short(state.url, 110)}`,
    `TIEU DE: ${short(state.title, 90)}`,
    state.scrollMax ? `CUON: ${state.scrollY}/${state.scrollMax}` : '',
    state.dialogOpen ? 'DANG MO DIALOG' : '',
  ].filter(Boolean);
  if (state.errors?.length) bits.push(`LOI TREN TRANG: ${state.errors.join(' | ')}`);
  return bits.join('\n');
}

/* ------------------------------------------------------------------ prompt */

export function buildAgentPrompt({ goal, persona, language = 'vi', state, map, history, step, maxSteps }) {
  return [
    `MUC TIEU: ${goal}`,
    persona ? `\nHO SO NGUOI DUNG (dung khi field khop):\n${persona}` : '',
    `\nNGON NGU NOI DUNG DIEN: ${language === 'vi' ? 'Tieng Viet' : language}`,
    `\nLUOT ${step}/${maxSteps}`,
    history ? `\nDA LAM:\n${history}` : '\nDA LAM: (chua co gi)',
    `\nTRANG THAI TRANG:\n${state}`,
    `\nBAN DO TRANG:\n${map}`,
    '\nTra ve JSON: { "thought", "actions": [...], "status", "summary" }',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Nen lich su lai cho khoi ton token: chi giu ket qua, bo chi tiet. */
export function compactHistory(turns, keep = 6) {
  return turns
    .slice(-keep)
    .map((t, i) => {
      const idx = turns.length - Math.min(turns.length, keep) + i + 1;
      const acts = t.results
        .map((r) => `${r.tool}${r.target ? ` "${r.target}"` : ''}${r.ok ? '' : ` → LOI: ${r.error}`}`)
        .join('; ');
      return `${idx}. ${t.thought ? t.thought + ' — ' : ''}${acts || '(khong lam gi)'}`;
    })
    .join('\n');
}

/** Hanh dong nao lam trang doi thi phai chup lai ngay. */
export const MUTATING = new Set(['click', 'navigate', 'back', 'press']);

/** Doi hanh dong cua model thanh step ma content script hieu. */
export function actionToStep(action, target) {
  const { tool, value } = action;
  const base = { afId: target.afId, frameId: target.frameId, label: target.name || target.afId };

  switch (tool) {
    case 'fill':
      return { ...base, action: 'fill', value: String(value ?? '') };
    case 'type':
      return { ...base, action: 'type', value: String(value ?? '') };
    case 'select': {
      const parts = String(value ?? '').split('|').map((x) => x.trim()).filter(Boolean);
      return { ...base, action: 'select', value: parts.length > 1 ? parts : parts[0] || '', multiple: parts.length > 1 };
    }
    case 'check':
      return { ...base, action: 'check', value: !/^(false|0|no|khong|off)$/i.test(String(value ?? 'true').trim()) };
    case 'radio':
      return { ...base, action: 'radio', value: String(value ?? '') };
    case 'upload':
      return {
        ...base,
        action: 'upload',
        value: String(value ?? '').split('|').map((x) => ({ name: x.trim() })).filter((x) => x.name),
      };
    case 'click':
      return { ...base, action: 'click' };
    case 'press':
      return { ...base, action: 'press', value: action.key || 'Enter' };
    default:
      return null;
  }
}
