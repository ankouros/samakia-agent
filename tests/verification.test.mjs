import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { createVerificationPipeline, CHECK_TYPES } from '../src/verification.mjs';
import { createTools } from '../src/tools.mjs';

const tmpDir = path.join(os.tmpdir(), 'agent-verify-test-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');

test('CHECK_TYPES has all expected checks', () => {
  assert.ok(CHECK_TYPES.includes('lint'));
  assert.ok(CHECK_TYPES.includes('build'));
  assert.ok(CHECK_TYPES.includes('api'));
  assert.ok(CHECK_TYPES.includes('test'));
  assert.ok(CHECK_TYPES.includes('accessibility'));
  assert.ok(CHECK_TYPES.includes('availability'));
  assert.ok(CHECK_TYPES.includes('metrics'));
  assert.ok(CHECK_TYPES.includes('deploy'));
});

test('pipeline skips checks without cmd or url', () => {
  const tools = createTools(tmpDir);
  const pipeline = createVerificationPipeline(tools, {});
  const results = pipeline.runAll();
  const skipped = results.filter(r => r.status === 'skipped');
  assert.ok(skipped.length > 0);
});

test('pipeline passes for valid command', () => {
  const tools = createTools(tmpDir);
  const pipeline = createVerificationPipeline(tools, { lintCmd: 'echo ok', buildCmd: 'echo ok' });
  const results = pipeline.runAll();
  const lint = results.find(r => r.id === 'lint');
  const build = results.find(r => r.id === 'build');
  assert.equal(lint.status, 'pass');
  assert.equal(build.status, 'pass');
});

test('pipeline detects failure', () => {
  const tools = createTools(tmpDir);
  const pipeline = createVerificationPipeline(tools, { lintCmd: 'exit 1', buildCmd: 'echo ok' });
  const results = pipeline.runAll();
  const lint = results.find(r => r.id === 'lint');
  assert.equal(lint.status, 'fail');
  assert.equal(lint.fixable, true);
});

test('getFixableFailures returns only fixable fails', () => {
  const tools = createTools(tmpDir);
  const pipeline = createVerificationPipeline(tools, { lintCmd: 'exit 1', buildCmd: 'echo ok', healthUrl: 'http://127.0.0.1:99999' });
  const results = pipeline.runAll();
  const fixable = pipeline.getFixableFailures(results);
  assert.ok(fixable.every(r => r.fixable === true));
  assert.ok(fixable.every(r => r.status === 'fail'));
});

test('summarize counts correctly', () => {
  const tools = createTools(tmpDir);
  const pipeline = createVerificationPipeline(tools, { lintCmd: 'echo ok', buildCmd: 'exit 1' });
  const results = pipeline.runAll();
  const summary = pipeline.summarize(results);
  assert.equal(summary.total, 8);
  assert.ok(summary.passed >= 1);
  assert.ok(summary.failed >= 1);
});

test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });
