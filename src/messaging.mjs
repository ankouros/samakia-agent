/**
 * Inter-agent messaging — RabbitMQ pub/sub with filesystem fallback.
 * v5.2.0 dual-write: publishes to MQ AND filesystem for backward compat.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EXCHANGE, routingKey, queueName, validateMessage } from './events.mjs';

const require = createRequire(import.meta.url);
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];

export function createMessaging(agentDir, repoName, mqUrl) {
  const inboxDir = path.join(agentDir, 'inbox');
  const outboxDir = path.join(agentDir, 'outbox');
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.mkdirSync(outboxDir, { recursive: true });

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

    /** Publish a message to the exchange */
    async publish(type, payload = {}) {
      const msg = { type, repo: repoName, ts: new Date().toISOString(), ...payload };
      const key = routingKey(repoName, type);

      // MQ publish
      if (connected && channel) {
        try {
          channel.publish(EXCHANGE, key, Buffer.from(JSON.stringify(msg)), { persistent: true });
        } catch { /* fallback only */ }
      }

      // Filesystem fallback (dual-write)
      const id = `msg-${repoName}-${Date.now()}`;
      fs.writeFileSync(path.join(outboxDir, `${id}.json`), JSON.stringify(msg, null, 2));
      return { ok: true, id };
    },

    /** Subscribe to own queue (listen mode) */
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
          const valid = validateMessage(msg);
          if (valid.ok) onMessage(msg);
        } catch { /* skip malformed */ }
        channel.ack(raw);
      });
      return true;
    },

    /** Legacy filesystem send (kept for backward compat) */
    send(targetRepoPath, message) {
      const targetInbox = path.join(targetRepoPath, 'agent', 'inbox');
      if (!fs.existsSync(targetInbox)) return { ok: false, error: 'target inbox not found' };
      const id = `msg-${repoName}-${Date.now()}`;
      const msg = { id, from: repoName, ts: new Date().toISOString(), ...message };
      fs.writeFileSync(path.join(targetInbox, `${id}.json`), JSON.stringify(msg, null, 2));
      return { ok: true, id };
    },

    /** Read filesystem inbox (legacy) */
    receive() {
      return fs.readdirSync(inboxDir).filter(f => f.startsWith('msg-')).map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(inboxDir, f), 'utf8')); } catch { return null; }
      }).filter(Boolean);
    },

    ack(msgId) {
      const file = path.join(inboxDir, `${msgId}.json`);
      if (fs.existsSync(file)) { fs.unlinkSync(file); return true; }
      return false;
    },

    async close() {
      if (conn) { try { await conn.close(); } catch {} conn = null; channel = null; connected = false; }
    },
  };
}
