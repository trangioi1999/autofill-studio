/* AI Autofill Studio — providers/openai.js
 * Bat ky endpoint tuong thich OpenAI Chat Completions:
 * OpenAI, OpenRouter, DeepSeek, Groq, Together, LM Studio, vLLM, Ollama (/v1),
 * hoac gateway noi bo cua doanh nghiep.
 */
import { parseJsonLoose } from '../lib/prompt.js';

export async function openaiComplete({ cfg, system, user, schema, signal }) {
  const base = (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');

  const body = {
    model: cfg.model,
    temperature: 0.4,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };

  if (schema) {
    // Structured Outputs neu server ho tro; neu khong, fallback json_object.
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'fill_plan', strict: false, schema },
    };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  // OpenRouter thich co 2 header nay
  headers['HTTP-Referer'] = 'chrome-extension://ai-autofill-studio';
  headers['X-Title'] = 'AI Autofill Studio';

  let res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok && schema) {
    // server khong hieu json_schema -> thu lai voi json_object
    body.response_format = { type: 'json_object' };
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`OpenAI-compat ${res.status}: ${t.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return { raw: text, json: parseJsonLoose(text), usage: data.usage || null };
}
