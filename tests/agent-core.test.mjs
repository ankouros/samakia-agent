import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { createTools } from '../src/tools.mjs';
import { createMemory } from '../src/memory.mjs';
import { createPersonas } from '../src/personas.mjs';
import { parseJSON } from '../src/ollama.mjs';
import { scoreConfidence } from '../src/reasoning.mjs';

const tmpDir = path.join(os.tmpdir(), 'samakia-agent-test-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'world');
fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), '// app');

// ─── Tools ──────────────────────────────────────────────────────────────────
test('tools: readFile reads existing', () => {
  const t = createTools(tmpDir);
  assert.equal(t.readFile('hello.txt').ok, true);
  assert.equal(t.readFile('hello.txt').content, 'world');
});

test('tools: readFile blocks outside repo', () => {
  const t = createTools(tmpDir);
  assert.equal(t.readFile('../../etc/passwd').ok, false);
});

test('tools: writeFile creates file', () => {
  const t = createTools(tmpDir);
  const r = t.writeFile('new.txt', 'created');
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(path.join(tmpDir, 'new.txt'), 'utf8'), 'created');
});

test('tools: listDir returns entries', () => {
  const t = createTools(tmpDir);
  const r = t.listDir('.', 1);
  assert.equal(r.ok, true);
  assert.ok(r.entries.some(e => e.name === 'hello.txt'));
  assert.ok(r.entries.some(e => e.name === 'src'));
});

test('tools: exec runs commands', () => {
  const t = createTools(tmpDir);
  const r = t.exec('echo hello');
  assert.equal(r.ok, true);
  assert.ok(r.output.includes('hello'));
});

test('tools: git blocks disallowed verbs', () => {
  const t = createTools(tmpDir);
  assert.equal(t.git('reset --hard').ok, false);
  assert.equal(t.git('push --force').ok, false);
});

// ─── Memory ─────────────────────────────────────────────────────────────────
test('memory: logAction + getActions', () => {
  const agentDir = path.join(tmpDir, 'agent-mem');
  const m = createMemory(agentDir);
  m.logAction({ key: 'test-1', type: 'build' });
  const actions = m.getActions();
  assert.ok(actions.length > 0);
  assert.equal(actions[actions.length - 1].key, 'test-1');
});

test('memory: wasRecentlyDone', () => {
  const agentDir = path.join(tmpDir, 'agent-mem');
  const m = createMemory(agentDir);
  m.logAction({ key: 'recent-test', type: 'x' });
  assert.equal(m.wasRecentlyDone('recent-test', 5), true);
  assert.equal(m.wasRecentlyDone('never-done', 5), false);
});

test('memory: updateContext', () => {
  const agentDir = path.join(tmpDir, 'agent-mem');
  const m = createMemory(agentDir);
  const ctx = m.updateContext({ lastBuild: true });
  assert.equal(ctx.lastBuild, true);
  assert.ok(ctx.lastRun);
});

// ─── Personas ───────────────────────────────────────────────────────────────
test('personas: creates 7 personas', () => {
  const p = createPersonas('test-project');
  assert.equal(Object.keys(p).length, 7);
  for (const id of ['planner', 'designer', 'implementer', 'builder', 'tester', 'deployer', 'fixer']) {
    assert.ok(p[id].system.includes('Output'), `${id} missing Output schema`);
  }
});

// ─── Ollama parseJSON ───────────────────────────────────────────────────────
test('parseJSON: direct json', () => { assert.deepEqual(parseJSON('{"x":1}').data, { x: 1 }); });
test('parseJSON: markdown block', () => { assert.equal(parseJSON('```json\n{"y":2}\n```').data.y, 2); });
test('parseJSON: empty fails', () => { assert.equal(parseJSON('').ok, false); });

// ─── Confidence ─────────────────────────────────────────────────────────────
test('confidence: scores valid patches high', () => {
  assert.ok(scoreConfidence({ path: 'src/x.js', content: 'const x = 1;\nexport default x;', reason: 'fix' }) >= 70);
});
test('confidence: scores empty patches low', () => {
  assert.ok(scoreConfidence({ path: '', content: '' }) < 30);
});

// Cleanup
test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });
