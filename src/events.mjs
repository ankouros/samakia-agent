/**
 * Event schemas and routing key helpers for MQ-based inter-agent messaging.
 */

const VALID_TYPES = ['directive', 'report', 'indexed', 'breaking_change', 'coordinated', 'error'];

export function validateMessage(msg) {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'not an object' };
  if (!VALID_TYPES.includes(msg.type)) return { ok: false, error: `invalid type: ${msg.type}` };
  if (!msg.ts) return { ok: false, error: 'missing ts' };
  return { ok: true };
}

export function routingKey(repo, type) {
  if (type === 'coordinated' || type === 'change') return `agent.broadcast.${type}`;
  return `agent.${repo}.${type}`;
}

export function makeMessage(type, repo, payload = {}) {
  return { type, repo, ts: new Date().toISOString(), ...payload };
}

export function queueName(repo) { return `q.agent.${repo}`; }
export const EXCHANGE = 'samakia.agents';
