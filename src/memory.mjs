import fs from 'node:fs';
import path from 'node:path';

export function createMemory(agentDir) {
  const memDir = path.join(agentDir, 'memory');
  fs.mkdirSync(memDir, { recursive: true });

  function read(file) { try { return JSON.parse(fs.readFileSync(path.join(memDir, file), 'utf8')); } catch { return null; } }
  function write(file, data) { fs.writeFileSync(path.join(memDir, file), JSON.stringify(data, null, 2)); }

  return {
    getActions(limit = 50) { return (read('actions.json') || []).slice(-limit); },
    logAction(action) { const a = this.getActions(200); a.push({ ts: new Date().toISOString(), ...action }); write('actions.json', a.slice(-200)); },
    wasRecentlyDone(key, minutes = 120) { return this.getActions(50).some(a => a.key === key && Date.now() - new Date(a.ts).getTime() < minutes * 60000); },

    getBuildHistory() { return read('builds.json') || []; },
    logBuild(result) { const h = this.getBuildHistory().slice(-50); h.push({ ts: new Date().toISOString(), ...result }); write('builds.json', h); },

    getContext() { return read('context.json') || { lastRun: null, trend: 'stable' }; },
    updateContext(data) { const c = this.getContext(); Object.assign(c, data, { lastRun: new Date().toISOString() }); write('context.json', c); return c; },

    getCodebaseMap() { return read('codebase-map.json') || {}; },
    updateCodebaseMap(map) { write('codebase-map.json', map); },
  };
}
