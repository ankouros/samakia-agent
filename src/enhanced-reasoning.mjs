/**
 * Enhanced reasoning — context loading, verification loop, error memory, project personas.
 */
import fs from 'node:fs';
import path from 'node:path';

// ─── Enhancement 1: Context Loading ────────────────────────────────────────

export function loadErrorContext(tools, error) {
  const context = [];

  // Extract file paths from error message
  const pathMatches = error.match(/['"](@\/[^'"]+)['"]/g) || [];
  const missingModules = pathMatches.map(m => m.replace(/['"]/g, ''));

  // For "Module not found" — find files that import the missing module
  for (const mod of missingModules) {
    const srcPath = mod.replace('@/', 'src/');
    // Find importers
    const srcDir = tools.listDir('src', 3);
    if (srcDir.ok) {
      for (const entry of srcDir.entries.filter(e => e.type === 'file' && (e.name.endsWith('.ts') || e.name.endsWith('.tsx') || e.name.endsWith('.js')))) {
        const file = tools.readFile(path.join('src', entry.name), 2000);
        if (file.ok && file.content.includes(mod)) {
          context.push({ type: 'importer', path: entry.name, snippet: extractImportLines(file.content, mod) });
        }
      }
    }
    // Read similar files in same directory for pattern matching
    const dir = path.dirname(srcPath);
    const dirList = tools.listDir(dir, 1);
    if (dirList.ok) {
      for (const entry of dirList.entries.filter(e => e.type === 'file').slice(0, 3)) {
        const file = tools.readFile(path.join(dir, entry.name), 1500);
        if (file.ok) context.push({ type: 'sibling', path: entry.name, snippet: file.content.slice(0, 500) });
      }
    }
  }

  // Read tsconfig/jsconfig for path aliases
  for (const cfg of ['tsconfig.json', 'jsconfig.json']) {
    const f = tools.readFile(cfg, 500);
    if (f.ok) { context.push({ type: 'config', path: cfg, snippet: f.content }); break; }
  }

  return context;
}

function extractImportLines(content, mod) {
  return content.split('\n').filter(l => l.includes(mod) || l.includes('import')).slice(0, 5).join('\n');
}

export function formatContextForPrompt(context) {
  if (!context.length) return '';
  return '\n\nPROJECT CONTEXT:\n' + context.map(c =>
    `[${c.type}: ${c.path}]\n${c.snippet}`
  ).join('\n\n').slice(0, 3000);
}

// ─── Enhancement 2: Verification-in-Loop ───────────────────────────────────

export function verifyAndRetry(tools, buildCmd, applyFix, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const result = tools.exec(buildCmd);
    if (result.ok) return { ok: true, retries: i };
    const fixed = applyFix(result.error, i);
    if (!fixed) return { ok: false, retries: i, error: result.error };
  }
  const final = tools.exec(buildCmd);
  return { ok: final.ok, retries: maxRetries, error: final.ok ? null : final.error };
}

// ─── Enhancement 3: Error Pattern Memory ───────────────────────────────────

export function createErrorMemory(memoryDir) {
  const file = path.join(memoryDir, 'error-patterns.json');
  fs.mkdirSync(memoryDir, { recursive: true });

  function read() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } }
  function write(data) { fs.writeFileSync(file, JSON.stringify(data.slice(-200), null, 2)); }

  return {
    record(errorKey, fix, worked) {
      const patterns = read();
      patterns.push({ errorKey, fix, worked, ts: new Date().toISOString() });
      write(patterns);
    },
    getFailedFixes(errorKey) {
      return read().filter(p => p.errorKey === errorKey && !p.worked).map(p => p.fix);
    },
    getSuccessfulFix(errorKey) {
      const match = read().find(p => p.errorKey === errorKey && p.worked);
      return match?.fix || null;
    },
    errorKey(error) {
      // Normalize error to a stable key
      return error.replace(/\/[^\s:]+/g, '<path>').replace(/\d+/g, 'N').slice(0, 100);
    },
  };
}

// ─── Enhancement 4: Project-Specific Personas ──────────────────────────────

export function buildProjectContext(tools) {
  const info = { stack: [], conventions: [], structure: [] };

  // Detect stack
  const pkg = tools.readFile('package.json', 50000);
  if (pkg.ok) {
    try {
      const p = JSON.parse(pkg.content);
      if (p.dependencies?.next) info.stack.push(`Next.js ${p.dependencies.next}`);
      if (p.dependencies?.react) info.stack.push(`React ${p.dependencies.react}`);
      if (p.dependencies?.mysql2) info.stack.push('MariaDB (mysql2)');
      if (p.dependencies?.redis) info.stack.push('Redis/Dragonfly');
      if (p.dependencies?.minio) info.stack.push('MinIO object storage');
      if (p.devDependencies?.['@playwright/test']) info.stack.push('Playwright E2E tests');
      if (p.devDependencies?.typescript) info.stack.push('TypeScript');
    } catch {}
  }

  // Detect conventions
  const tsconfig = tools.readFile('tsconfig.json', 500);
  if (tsconfig.ok && tsconfig.content.includes('"@/*"')) info.conventions.push('@/ alias maps to src/ or project root');

  const srcDir = tools.listDir('src', 1);
  if (srcDir.ok) {
    const dirs = srcDir.entries.filter(e => e.type === 'dir').map(e => e.name);
    info.structure = dirs;
    if (dirs.includes('lib')) info.conventions.push('Business logic in src/lib/');
    if (dirs.includes('app')) info.conventions.push('Next.js app router in src/app/');
    if (dirs.includes('components')) info.conventions.push('UI components in src/components/');
  }

  return `Tech stack: ${info.stack.join(', ') || 'unknown'}
Conventions: ${info.conventions.join('; ') || 'standard'}
Structure: src/${info.structure.join(', src/') || '(flat)'}`;
}

export function enhancedFixerPrompt(error, projectContext, errorContext, failedFixes) {
  let prompt = `Fix this build error in a ${projectContext} project.\n\nERROR:\n${error.slice(0, 1000)}`;
  if (errorContext) prompt += errorContext;
  if (failedFixes.length > 0) {
    prompt += `\n\nALREADY TRIED (failed — do NOT repeat):\n${failedFixes.map(f => `- ${f}`).join('\n')}`;
  }
  prompt += '\n\nProduce a minimal fix. Output JSON: {"patches":[{"path":"relative/path","content":"full file content","reason":"why"}]}';
  return prompt;
}
