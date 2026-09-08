/* AI Autofill Studio — providers/anthropic.js
 * Goi Claude Messages API truc tiep tu extension.
 * Header `anthropic-dangerous-direct-browser-access` la bat buoc khi goi tu trinh duyet.
 * Dung tool-use de ep model tra ve JSON dung schema.
 */
import { parseJsonLoose } from '../lib/prompt.js';

export async function anthropicComplete({ cfg, system, user, schema, signal }) {
  if (!cfg.apiKey) throw new Error('Chua nhap Anthropic API key.');

  const useTool = !!schema;
  const body = {
    model: cfg.model,
    max_tokens: 8192,
    temperature: 0.4,
    system,
    messages: [{ role: 'user', content: user }],
  };

  if (useTool) {
    body.tools = [
      {
        name: 'submit_fill_plan',
        description: 'Nop ke hoach dien form',
        input_schema: schema,
      },
    ];
    body.tool_choice = { type: 'tool', name: 'submit_fill_plan' };
  }

  const res = await fetch(`${(cfg.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`);
  }

  const data = await res.json();
  const blocks = data.content || [];

  const toolBlock = blocks.find((b) => b.type === 'tool_use');
  if (toolBlock) return { raw: JSON.stringify(toolBlock.input), json: toolBlock.input, usage: data.usage };

  const text = blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return { raw: text, json: parseJsonLoose(text), usage: data.usage };
}
