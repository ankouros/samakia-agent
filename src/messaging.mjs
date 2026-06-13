/**
 * Inter-agent messaging — RabbitMQ pub/sub.
 * v6.0.0: MQ-only. No filesystem fallback.
 */
import { createRequire } from 'node:module';
import { EXCHANGE, routingKey, queueName, validateMessage } from './events.mjs';

const require = createRequire(import.meta.url);
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];

export function createMessaging(agentDir, repoName, mqUrl) {
  let conn = null;
  let channel = null;
  let connected = false;
  let attempt = 0;

  async function connectMQ() {
    if (!mqUrl) return false;
    try {
      const amqp = require('amqplib');
      conn = await amqp.connect(mqUrl);
      conn.on('close', () => { connected = false; reconnect(); });
      conn.on('error', () => {});
      channel = await conn.createConfirmChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      connected = true;
      attempt = 0;
      return true;
    } catch { connected = false; return false; }
  }

  function reconnect() {
    const delay = RECONNECT_DELAYS[Math.min(attempt++, RECONNECT_DELAYS.length - 1)];
    setTimeout(() => connectMQ(), delay);
  }

  return {
    get isConnected() { return connected; },
    connect: connectMQ,

    async publish(type, payload = {}) {
      const msg = { type, repo: repoName, ts: new Date().toISOString(), ...payload };
      const key = routingKey(repoName, type);
      if (connected && channel) {
        channel.publish(EXCHANGE, key, Buffer.from(JSON.stringify(msg)), { persistent: true });
      }
      return { ok: connected, id: `msg-${repoName}-${Date.now()}` };
    },

    async subscribe(onMessage) {
      if (!connected || !channel) return false;
      const q = queueName(repoName);
      await channel.assertQueue(q, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
      await channel.bindQueue(q, EXCHANGE, `agent.${repoName}.*`);
      await channel.bindQueue(q, EXCHANGE, 'agent.broadcast.*');
      channel.consume(q, (raw) => {
        if (!raw) return;
        try {
          const msg = JSON.parse(raw.content.toString());
          if (validateMessage(msg).ok) onMessage(msg);
        } catch { /* skip malformed */ }
        channel.ack(raw);
      });
      return true;
    },

    async close() {
      if (conn) { try { await conn.close(); } catch {} conn = null; channel = null; connected = false; }
    },
  };
}
