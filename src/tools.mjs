import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PROTECTED_FILES = ['package.json', 'package-lock.json', 'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.env', 'next.config.mjs', 'next.config.ts', 'next.config.js', 'tsconfig.json'];

export function createTools(repoRoot) {
  return {
    readFile(filePath, maxBytes = 10000) {
      const resolved = path.resolve(repoRoot, filePath);
      if (!resolved.startsWith(repoRoot)) return { ok: false, error: 'outside repo' };
      if (!fs.existsSync(resolved)) return { ok: false, error: 'not found' };
      return { ok: true, content: fs.readFileSync(resolved, 'utf8').slice(0, maxBytes) };
    },
    writeFile(filePath, content) {
      const resolved = path.resolve(repoRoot, filePath);
      if (!resolved.startsWith(repoRoot)) return { ok: false, error: 'outside repo' };
      const basename = path.basename(resolved);
      if (PROTECTED_FILES.includes(basename)) return { ok: false, error: `protected file: ${basename}` };
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, content, 'utf8');
      return { ok: true, path: resolved };
    },
    listDir(dirPath = '.', depth = 1) {
      const resolved = path.resolve(repoRoot, dirPath);
      if (!resolved.startsWith(repoRoot)) return { ok: false, error: 'outside repo' };
      const entries = [];
      function walk(dir, d) {
        if (d > depth) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue;
          entries.push({ name: path.relative(resolved, path.join(dir, e.name)), type: e.isDirectory() ? 'dir' : 'file' });
          if (e.isDirectory() && d < depth) walk(path.join(dir, e.name), d + 1);
        }
      }
      walk(resolved, 1);
      return { ok: true, entries: entries.slice(0, 200) };
    },
    exec(cmd, { timeout = 60000 } = {}) {
      try {
        const out = execSync(cmd, { cwd: repoRoot, encoding: 'utf8', timeout, stdio: 'pipe' });
        return { ok: true, output: out.slice(0, 5000) };
      } catch (err) { return { ok: false, error: (err.stderr || err.message || '').slice(0, 2000), exitCode: err.status }; }
    },
    git(cmd) {
      const allowed = ['add', 'commit', 'push', 'status', 'diff', 'log'];
      const verb = cmd.split(' ')[0];
      if (!allowed.includes(verb)) return { ok: false, error: `git ${verb} not allowed` };
      return this.exec(`git ${cmd}`);
    },
    curl(url) {
      try {
        const out = execSync(`curl -sk -o /dev/null -w "%{http_code}" "${url}"`, { encoding: 'utf8', timeout: 10000 });
        return { ok: true, status: parseInt(out.trim()) };
      } catch { return { ok: false, error: 'unreachable' }; }
    },
  };
}
