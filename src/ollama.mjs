import { createOllamaClient } from '@samakia/ollama-client';

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://192.168.11.30:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen3-coder:latest';
const TIMEOUT_MS = 180_000;

const client = createOllamaClient(OLLAMA_BASE);

export async function generate({ model = DEFAULT_MODEL, system, prompt, format = 'json' }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const data = await client.generate({ model, system, prompt, options: { format } });
    return { ok: true, response: data.response, model: data.model };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally { clearTimeout(timer); }
}

export async function health() {
  const ok = await client.health();
  return { ok };
}

export function parseJSON(raw) {
  if (!raw) return { ok: false, error: 'empty' };
  try { return { ok: true, data: JSON.parse(raw) }; } catch {}
  const m = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (m) try { return { ok: true, data: JSON.parse(m[1]) }; } catch {}
  const b = raw.match(/\{[\s\S]*\}/);
  if (b) try { return { ok: true, data: JSON.parse(b[0]) }; } catch {}
  return { ok: false, error: 'parse_failed' };
}
