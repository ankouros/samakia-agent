/**
 * Agent memory — Dragonfly-backed with local JSON filesystem fallback.
 * Dual-write: always writes to filesystem, reads from cache if available.
 */
import fs from 'node:fs';
import path from 'node:path';

export function createMemory(agentDir, cache, repoName) {
  const memDir = path.join(agentDir, 'memory');
  fs.mkdirSync(memDir, { recursive: true });

  function readLocal(file) { try { return JSON.parse(fs.readFileSync(path.join(memDir, file), 'utf8')); } catch { return null; } }
  function writeLocal(file, data) { fs.writeFileSync(path.join(memDir, file), JSON.stringify(data, null, 2)); }

  async function readCached(key, file) {
    if (cache?.isConnected && repoName) {
      const val = await cache.getMemory(repoName, key);
      if (val) return val;
    }
    return readLocal(file);
  }

  async function writeDual(key, file, data) {
    writeLocal(file, data);
    if (cache?.isConnected && repoName) await cache.setMemory(repoName, key, data);
  }

  return {
    getActions(limit = 50) { return (readLocal('actions.json') || []).slice(-limit); },
    logAction(action) { const a = this.getActions(200); a.push({ ts: new Date().toISOString(), ...action }); writeLocal('actions.json', a.slice(-200)); if (cache?.isConnected && repoName) cache.setMemory(repoName, 'actions', a.slice(-200)).catch(() => {}); },
    wasRecentlyDone(key, minutes = 120) { return this.getActions(50).some(a => a.key === key && Date.now() - new Date(a.ts).getTime() < minutes * 60000); },

    getBuildHistory() { return readLocal('builds.json') || []; },
    logBuild(result) { const h = this.getBuildHistory().slice(-50); h.push({ ts: new Date().toISOString(), ...result }); writeLocal('builds.json', h); if (cache?.isConnected && repoName) cache.setMemory(repoName, 'builds', h).catch(() => {}); },

    getContext() { return readLocal('context.json') || { lastRun: null, trend: 'stable' }; },
    updateContext(data) { const c = this.getContext(); Object.assign(c, data, { lastRun: new Date().toISOString() }); writeLocal('context.json', c); if (cache?.isConnected && repoName) cache.setMemory(repoName, 'context', c).catch(() => {}); return c; },

    getCodebaseMap() { return readLocal('codebase-map.json') || {}; },
    updateCodebaseMap(map) { writeLocal('codebase-map.json', map); },
  };
}
