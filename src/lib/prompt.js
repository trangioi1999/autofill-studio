/* Autofill Studio — lib/prompt.js
 * Bien danh sach field + ngu canh trang thanh prompt, va dinh nghia schema
 * JSON ma model phai tra ve.
 */

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'id cua field lay tu danh sach FIELDS' },
          action: {
            type: 'string',
            enum: ['fill', 'type', 'select', 'check', 'radio', 'upload', 'click', 'press'],
          },
          value: { type: 'string', description: 'Gia tri can dien. Voi multi-select dung dau | de ngan cach.' },
          source: {
            type: 'string',
            enum: ['profile', 'request', 'page', 'invented'],
            description:
              'Gia tri nay tu dau ra: profile = HO SO nguoi dung; request = nguoi dung viet trong yeu cau; page = suy ra tu noi dung trang; invented = ban tu nghi ra',
          },
          note: { type: 'string', description: 'Ly do ngan gon' },
        },
        required: ['id', 'action', 'value', 'source'],
      },
    },
    skipped: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, reason: { type: 'string' } },
        required: ['id', 'reason'],
      },
    },
  },
  required: ['steps'],
};

export const SYSTEM_PROMPT = `Ban la mot tro ly dien form tu dong, chay ben trong mot extension trinh duyet.

Nhiem vu: doc danh sach cac o nhap lieu (FIELDS) da duoc quet tu trang web, doc ngu canh trang (PAGE) va yeu cau cua nguoi dung (REQUEST), roi tra ve mot KE HOACH dien du lieu.

QUY TAC BAT BUOC
1. Chi tra ve JSON dung schema. Khong giai thich ngoai JSON, khong dung markdown code fence.
2. Moi step phai tham chieu "id" co that trong FIELDS. Tuyet doi khong bia id.
3. Chon "action" theo "kind" cua field:
   - text, textarea, number, date, editor  -> "fill"
   - text co goi y/autocomplete (kind=combobox nhung khong co options) -> "type"
   - select, multiselect, combobox, multiselect-custom -> "select"
   - checkbox, checkbox-custom, toggle -> "check" (value la "true" hoac "false")
   - radio, radiogroup -> "radio" (value la nhan cua lua chon)
   - file -> "upload"
4. Neu field co "options", value BAT BUOC phai la mot trong cac nhan do, copy chinh xac. Voi multi-select, noi nhieu nhan bang dau "|".
5. Voi field kind=file, value la ten file goi y, vi du "cv-nguyen-van-a.pdf". Extension se tu tao file placeholder.
6. Bo qua (dua vao "skipped") cac field: da co san gia tri dung, disabled, hoac la captcha / OTP / mat khau / so the tin dung / CVV.
7. Ton trong "maxLength", "pattern", "required" va "help" cua tung field.
8. Ngay thang: dung dinh dang YYYY-MM-DD tru khi field noi ro khac.
9. Uu tien dien HET cac field "required": true.
10. Noi dung phai thuc te, nhat quan voi nhau (vi du email khop voi ten, tinh/thanh khop voi dia chi) va phu hop ngu canh trang.

DU LIEU LAY TU DAU — quan trong
11. Thu tu uu tien tuyet doi: HO SO NGUOI DUNG > REQUEST > ngu canh trang > tu nghi ra.
12. Neu HO SO co du lieu khop voi field, BAT BUOC copy nguyen van, khong sua, khong "lam dep", khong doi dinh dang tru khi field ep dinh dang khac. Dat source = "profile".
13. Neu gia tri nam trong REQUEST cua nguoi dung, dung dung nhu vay. Dat source = "request".
14. Chi tu nghi ra khi ca HO SO lan REQUEST deu khong noi gi ve field do. Khi do dat source = "invented" — nguoi dung se thay ro cho nao la du lieu that, cho nao la du lieu ban bia.
15. Tuyet doi khong bia thong tin dinh danh that (so CMND/CCCD, ma so thue, so tai khoan, bien so xe, ma nhan vien). Nhung field do dua vao "skipped" neu HO SO khong co.

AN TOAN
- Khong tao thong tin gia mao mot nguoi that hoac to chuc that.
- Khong dien vao truong thanh toan, mat khau, ma OTP, ma xac thuc.
- Neu REQUEST yeu cau lam nhung viec tren, dua field do vao "skipped" voi ly do.`;

const compactField = (f) => {
  const o = {
    // gid = "<frameId>:<id>" — bat buoc, vi id chi duy nhat TRONG mot frame.
    // Neu dung f.id thi field cua iframe se de len field cung so thu tu o frame chinh.
    id: f.gid || f.id,
    kind: f.kind,
    label: f.label || undefined,
    name: f.name || undefined,
    placeholder: f.placeholder || undefined,
    section: f.section || undefined,
    help: f.help || undefined,
    required: f.required || undefined,
    maxLength: f.maxLength || undefined,
    pattern: f.pattern || undefined,
    accept: f.accept || undefined,
    multiple: f.multiple || undefined,
    current: f.currentValue || undefined,
  };
  if (f.options && f.options.length) o.options = f.options.map((x) => x.label || x.value).slice(0, 60);
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
};

export function buildUserPrompt({ fields, context, request, persona, language = 'vi' }) {
  const usable = fields.filter((f) => !f.disabled);
  const payload = {
    PAGE: {
      url: context?.url,
      title: context?.title,
      headings: (context?.headings || []).slice(0, 10),
      excerpt: (context?.text || '').slice(0, 1200),
    },
    FIELDS: usable.map(compactField),
  };

  return [
    `NGON NGU TRA LOI CHO NOI DUNG DIEN: ${language === 'vi' ? 'Tieng Viet' : language}`,
    persona ? `HO SO NGUOI DUNG (uu tien dung du lieu nay khi field khop):\n${persona}` : '',
    `REQUEST: ${request || 'Dien toan bo form bang du lieu hop ly, that te, phu hop ngu canh trang.'}`,
    '',
    'DU LIEU TRANG (JSON):',
    JSON.stringify(payload),
    '',
    'Tra ve JSON theo schema: { "steps": [ { "id", "action", "value", "note" } ], "skipped": [ { "id", "reason" } ] }',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Chuyen ke hoach cua AI thanh step ma content script hieu. */
export function planToSteps(plan, fields) {
  // Khoa theo gid (duy nhat toan tab); van chap nhan id thuan de tuong thich nguoc
  const byId = new Map();
  for (const f of fields) {
    byId.set(f.gid || f.id, f);
    if (!byId.has(f.id)) byId.set(f.id, f);
  }
  const steps = [];
  for (const s of plan?.steps || []) {
    const f = byId.get(s.id);
    if (!f) continue;
    let value = s.value;
    let action = s.action;

    if (f.kind === 'multiselect' || f.kind === 'multiselect-custom') {
      value = String(value).split('|').map((x) => x.trim()).filter(Boolean);
      action = 'select';
    } else if (f.kind === 'select' || f.kind === 'combobox') {
      action = 'select';
    } else if (f.kind === 'checkbox' || f.kind === 'checkbox-custom' || f.kind === 'toggle') {
      action = 'check';
      value = !/^(false|0|no|khong|off)$/i.test(String(value).trim());
    } else if (f.kind === 'radio' || f.kind === 'radiogroup') {
      action = 'radio';
    } else if (f.kind === 'file') {
      action = 'upload';
      const names = String(value).split('|').map((x) => x.trim()).filter(Boolean);
      value = names.map((n) => ({ name: n }));
    } else if (action !== 'type') {
      action = 'fill';
    }

    steps.push({
      afId: f.id,
      action,
      value,
      source: s.source || 'invented', // 'random' khi do fillGaps / dummyPlan sinh ra
      kind: f.kind,
      multiple: f.kind === 'multiselect' || f.kind === 'multiselect-custom',
      note: s.note || '',
      label: f.label,
      frameId: f.frameId,
    });
  }
  return steps;
}

/** Tach JSON ra khoi text co the lan markdown fence. */
export function parseJsonLoose(text) {
  if (!text) throw new Error('Model tra ve rong');
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    /* thu tim khoi { } dai nhat */
  }
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const slice = t.slice(first, last + 1);
    return JSON.parse(slice);
  }
  throw new Error('Khong parse duoc JSON tu model: ' + t.slice(0, 200));
}
