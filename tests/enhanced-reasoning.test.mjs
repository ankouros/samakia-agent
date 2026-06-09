import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { loadErrorContext, formatContextForPrompt, verifyAndRetry, createErrorMemory, buildProjectContext, enhancedFixerPrompt } from '../src/enhanced-reasoning.mjs';
import { createTools } from '../src/tools.mjs';

const tmpDir = path.join(os.tmpdir(), 'agent-enhanced-test-' + Date.now());
fs.mkdirSync(path.join(tmpDir, 'src', 'lib'), { recursive: true });
fs.mkdirSync(path.join(tmpDir, 'src', 'app'), { recursive: true });
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"dependencies":{"next":"15.5.9","react":"19.2.3","mysql2":"^3.0.0"},"devDependencies":{"typescript":"^5","@playwright/test":"^1.60.0"}}');
fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}');
fs.writeFileSync(path.join(tmpDir, 'src', 'lib', 'utils.ts'), 'export function hello() { return "hi"; }');
fs.writeFileSync(path.join(tmpDir, 'src', 'app', 'page.ts'), "import { getDb } from '@/lib/db';\nimport { hello } from '@/lib/utils';");

// ─── Enhancement 1: Context Loading ────────────────────────────────────────

test('loadErrorContext finds importers of missing module', () => {
  const tools = createTools(tmpDir);
  const ctx = loadErrorContext(tools, "Module not found: Can't resolve '@/lib/db'");
  assert.ok(ctx.length > 0);
  const importer = ctx.find(c => c.type === 'importer');
  assert.ok(importer, 'should find a file that imports @/lib/db');
});

test('loadErrorContext reads tsconfig for path aliases', () => {
  const tools = createTools(tmpDir);
  const ctx = loadErrorContext(tools, "Module not found: '@/lib/db'");
  const config = ctx.find(c => c.type === 'config');
  assert.ok(config);
  assert.ok(config.snippet.includes('@/*'));
});

test('formatContextForPrompt produces readable string', () => {
  const ctx = [{ type: 'importer', path: 'app/page.ts', snippet: "import { getDb } from '@/lib/db'" }];
  const result = formatContextForPrompt(ctx);
  assert.ok(result.includes('PROJECT CONTEXT'));
  assert.ok(result.includes('getDb'));
});

// ─── Enhancement 2: Verification-in-Loop ───────────────────────────────────

test('verifyAndRetry passes immediately if build succeeds', () => {
  const tools = createTools(tmpDir);
  const result = verifyAndRetry(tools, 'echo ok', () => false);
  assert.equal(result.ok, true);
  assert.equal(result.retries, 0);
});

test('verifyAndRetry retries on failure', () => {
  const tools = createTools(tmpDir);
  let callCount = 0;
  const result = verifyAndRetry(tools, 'exit 1', (err, i) => { callCount++; return false; }, 2);
  assert.equal(result.ok, false);
  assert.ok(callCount >= 1); // fix callback was called at least once
});

// ─── Enhancement 3: Error Pattern Memory ───────────────────────────────────

test('errorMemory records and retrieves patterns', () => {
  const memDir = path.join(tmpDir, 'mem');
  const mem = createErrorMemory(memDir);
  mem.record('mod_not_found', 'added import', false);
  mem.record('mod_not_found', 'created file', true);
  assert.deepEqual(mem.getFailedFixes('mod_not_found'), ['added import']);
  assert.equal(mem.getSuccessfulFix('mod_not_found'), 'created file');
});

test('errorMemory.errorKey normalizes errors', () => {
  const mem = createErrorMemory(path.join(tmpDir, 'mem2'));
  const k1 = mem.errorKey("Error in /home/user/src/lib/db.ts:42");
  const k2 = mem.errorKey("Error in /home/other/src/lib/db.ts:99");
  assert.equal(k1, k2); // paths and numbers normalized
});

// ─── Enhancement 4: Project-Specific Personas ──────────────────────────────

test('buildProjectContext detects stack from package.json', () => {
  const tools = createTools(tmpDir);
  const ctx = buildProjectContext(tools);
  assert.ok(ctx.includes('Next.js'));
  assert.ok(ctx.includes('MariaDB'));
  assert.ok(ctx.includes('Playwright'));
  assert.ok(ctx.includes('TypeScript'));
});

test('enhancedFixerPrompt includes error + context + failed fixes', () => {
  const prompt = enhancedFixerPrompt(
    "Module not found '@/lib/db'",
    'Next.js 15, TypeScript',
    '\n\nPROJECT CONTEXT:\n[importer: page.ts]\nimport { getDb }',
    ['tried creating empty file']
  );
  assert.ok(prompt.includes("Module not found"));
  assert.ok(prompt.includes('PROJECT CONTEXT'));
  assert.ok(prompt.includes('ALREADY TRIED'));
  assert.ok(prompt.includes('tried creating empty file'));
});

// Cleanup
test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });
