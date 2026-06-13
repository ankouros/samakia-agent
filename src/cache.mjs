/**
 * Shared cache (Dragonfly) — locks, heartbeat, run dedup, generation semaphore.
 * Falls back gracefully if cache is unreachable.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const GEN_LOCK_KEY = 'agent:ollama:gen-lock';
const GEN_LOCK_TTL = 120;

export function createCache(url) {
  let redis = null;
  let connected = false;

  async function connect() {
    if (redis) return connected;
    try {
      const Redis = require('ioredis');
      redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true, connectTimeout: 3000 });
      await redis.connect();
      connected = true;
      redis.on('error', () => { connected = false; });
      redis.on('ready', () => { connected = true; });
    } catch { connected = false; }
    return connected;
  }

  async function safe(fn, fallback = null) {
    if (!connected) return fallback;
    try { return await fn(redis); } catch { return fallback; }
  }

  return {
    connect,
    get isConnected() { return connected; },

    async writeHeartbeat(repo) {
      return safe(r => r.set(`agent:${repo}:heartbeat`, JSON.stringify({ repo, ts: Date.now(), status: 'alive' }), 'EX', 90));
    },

    async acquireRunLock(repo, runId) {
      return safe(r => r.set(`agent:${repo}:run:${runId}`, Date.now().toString(), 'NX', 'EX', 300), false);
    },
    async releaseRunLock(repo, runId) { return safe(r => r.del(`agent:${repo}:run:${runId}`)); },

    async isRunning(repo) {
      const keys = await safe(r => r.keys(`agent:${repo}:run:*`), []);
      return keys && keys.length > 0;
    },

    async acquireGenLock(repo) {
      const val = JSON.stringify({ repo, since: Date.now() });
      return safe(r => r.set(GEN_LOCK_KEY, val, 'NX', 'EX', GEN_LOCK_TTL), null);
    },
    async releaseGenLock() { return safe(r => r.del(GEN_LOCK_KEY)); },

    async getIndexHashes(repo) {
      const raw = await safe(r => r.get(`agent:${repo}:index-hashes`));
      return raw ? JSON.parse(raw) : {};
    },
    async setIndexHashes(repo, hashes) {
      return safe(r => r.set(`agent:${repo}:index-hashes`, JSON.stringify(hashes)));
    },

    async getMemory(repo, key) {
      const raw = await safe(r => r.get(`agent:${repo}:memory:${key}`));
      return raw ? JSON.parse(raw) : null;
    },
    async setMemory(repo, key, data) {
      return safe(r => r.set(`agent:${repo}:memory:${key}`, JSON.stringify(data)));
    },

    async close() { if (redis) { redis.disconnect(); redis = null; connected = false; } },
  };
}
