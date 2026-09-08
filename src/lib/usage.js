/* Autofill Studio — lib/usage.js
 * Moi provider bao token mot kieu. Quy ve mot dang duy nhat de con cong don
 * va hien cho nguoi dung biet mot lan chay ton bao nhieu.
 */

/**
 * OpenAI-compat : { prompt_tokens, completion_tokens, total_tokens }
 * Anthropic     : { input_tokens, output_tokens, cache_read_input_tokens... }
 * Gemini        : { promptTokenCount, candidatesTokenCount, totalTokenCount }
 * Chrome AI     : khong bao gi
 * Bridge        : tuy CLI, thuong khong co
 */
export function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const num = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);

  const input =
    num(raw.prompt_tokens) ||
    num(raw.input_tokens) + num(raw.cache_read_input_tokens) + num(raw.cache_creation_input_tokens) ||
    num(raw.promptTokenCount);

  const output = num(raw.completion_tokens) || num(raw.output_tokens) || num(raw.candidatesTokenCount);

  const total = num(raw.total_tokens) || num(raw.totalTokenCount) || input + output;

  if (!total) return null;
  return { input, output, total };
}

/** Cong don nhieu luot lai — dung cho che do agent. */
export function addUsage(a, b) {
  if (!b) return a;
  if (!a) return { ...b, calls: 1 };
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    total: a.total + b.total,
    calls: (a.calls || 1) + 1,
  };
}

/** 1234 -> "1.2k" · 45678 -> "45.7k" */
export function fmtTokens(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}
