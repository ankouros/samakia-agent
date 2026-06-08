import { generate, parseJSON } from './ollama.mjs';

export async function treeOfThoughts(persona, prompt, { branches = 2, model } = {}) {
  const results = [];
  for (let i = 0; i < branches; i++) {
    const p = `${prompt}\n\nVariant ${i + 1}/${branches}. ${i === 0 ? 'Most conservative.' : 'More thorough.'}`;
    const r = await generate({ model, system: persona.system, prompt: p });
    if (r.ok) { const parsed = parseJSON(r.response); if (parsed.ok) results.push({ id: i, data: parsed.data }); }
  }
  return results.length > 0 ? { ok: true, branches: results, winner: results[0] } : { ok: false };
}

export async function selfReflect(output, context, model) {
  const r = await generate({ model, system: 'Review this output for errors. Output: {"approved":true,"issues":[]}', prompt: `Context: ${context}\nOutput: ${JSON.stringify(output).slice(0, 2000)}` });
  if (!r.ok) return { approved: true, issues: [] };
  const p = parseJSON(r.response);
  return p.ok ? p.data : { approved: true, issues: [] };
}

export function scoreConfidence(patch) {
  let s = 50;
  if (patch.content?.length > 10) s += 20;
  if (patch.reason) s += 10;
  if (patch.path?.includes('test')) s += 10;
  if (!patch.path || !patch.content) s -= 30;
  return Math.max(0, Math.min(100, s));
}
