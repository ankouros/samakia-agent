/**
 * Safety: Scope limiter + Quarantine mode
 */
import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from './utils.mjs';

export function createScopeLimiter(allowedGlobs = ['src/**', 'tests/**', 'docs/**', 'package.json', 'agent/**']) {
  return {
    isAllowed(filePath) {
      const rel = filePath.startsWith('/') ? filePath : filePath;
      return allowedGlobs.some(glob => minimatch(rel, glob));
    },
    filter(patches) {
      return patches.filter(p => {
        const target = p.path || p.target || '';
        return this.isAllowed(target);
      });
    },
  };
}

export function createQuarantine(memoryDir) {
  const file = path.join(memoryDir, 'quarantine.json');
  fs.mkdirSync(memoryDir, { recursive: true });

  function read() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { active: false, failures: 0, since: null }; } }
  function write(data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

  return {
    check() { return read(); },
    isQuarantined() { return read().active; },
    recordFailure() {
      const state = read();
      state.failures++;
      if (state.failures >= 3) { state.active = true; state.since = state.since || new Date().toISOString(); }
      write(state);
      return state;
    },
    recordSuccess() {
      write({ active: false, failures: 0, since: null });
    },
    reset() {
      write({ active: false, failures: 0, since: null });
    },
  };
}
