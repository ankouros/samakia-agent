import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { createPlanEngine } from '../src/plan-engine.mjs';
import { createTools } from '../src/tools.mjs';
import { createMemory } from '../src/memory.mjs';

const tmpDir = path.join(os.tmpdir(), 'agent-plan-test-' + Date.now());
fs.mkdirSync(path.join(tmpDir, 'agent', 'memory', 'plans'), { recursive: true });
fs.writeFileSync(path.join(tmpDir, 'agent', 'config.json'), '{}');
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'world');

const tools = createTools(tmpDir);
const memory = createMemory(path.join(tmpDir, 'agent'));
const logs = [];
const logFn = (level, msg, data) => logs.push({ level, msg, data });

test('plan-engine: executeStep read succeeds for existing file', async () => {
  const engine = createPlanEngine(tools, memory, null, logFn);
  const r = await engine.executeStep({ action: 'read', target: 'hello.txt' }, false);
  assert.equal(r.ok, true);
});

test('plan-engine: executeStep read fails for missing file', async () => {
  const engine = createPlanEngine(tools, memory, null, logFn);
  const r = await engine.executeStep({ action: 'read', target: 'nope.txt' }, false);
  assert.equal(r.ok, false);
});

test('plan-engine: executeStep exec succeeds', async () => {
  const engine = createPlanEngine(tools, memory, null, logFn);
  const r = await engine.executeStep({ action: 'exec', target: 'echo hello' }, false);
  assert.equal(r.ok, true);
  assert.ok(r.output.includes('hello'));
});

test('plan-engine: executeStep exec fails', async () => {
  const engine = createPlanEngine(tools, memory, null, logFn);
  const r = await engine.executeStep({ action: 'exec', target: 'exit 1' }, false);
  assert.equal(r.ok, false);
});

test('plan-engine: executeStep write with content', async () => {
  const engine = createPlanEngine(tools, memory, null, logFn);
  const r = await engine.executeStep({ action: 'write', target: 'test-out.txt', content: 'written by plan', description: 'test write' }, false);
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(path.join(tmpDir, 'test-out.txt'), 'utf8'), 'written by plan');
});

test('plan-engine: executePlan runs steps in order', async () => {
  const engine = createPlanEngine(tools, memory, null, logFn);
  const plan = {
    id: 'test-plan-1', task: 'test', status: 'ready', steps: [
      { id: 1, action: 'exec', target: 'echo step1', status: 'pending', depends_on: [] },
      { id: 2, action: 'exec', target: 'echo step2', status: 'pending', depends_on: [1] },
    ], createdAt: new Date().toISOString(),
  };
  const result = await engine.executePlan(plan, { dryRun: false });
  assert.equal(result.ok, true);
  assert.equal(plan.steps[0].status, 'done');
  assert.equal(plan.steps[1].status, 'done');
  assert.equal(plan.status, 'completed');
});

test('plan-engine: executePlan stops on failure', async () => {
  const engine = createPlanEngine(tools, memory, null, logFn);
  const plan = {
    id: 'test-plan-2', task: 'fail test', status: 'ready', steps: [
      { id: 1, action: 'exec', target: 'echo ok', status: 'pending', depends_on: [] },
      { id: 2, action: 'exec', target: 'exit 1', status: 'pending', depends_on: [1] },
      { id: 3, action: 'exec', target: 'echo never', status: 'pending', depends_on: [2] },
    ], createdAt: new Date().toISOString(),
  };
  const result = await engine.executePlan(plan, { dryRun: false, maxRetries: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.failedStep, 2);
  assert.equal(plan.steps[2].status, 'pending');
});

test('plan-engine: getProgress calculates correctly', () => {
  const engine = createPlanEngine(tools, memory, null, logFn);
  const plan = { steps: [{ status: 'done' }, { status: 'done' }, { status: 'pending' }], status: 'running' };
  const p = engine.getProgress(plan);
  assert.equal(p.total, 3);
  assert.equal(p.done, 2);
  assert.equal(p.pct, 67);
});

test('plan-engine: dryRun skips actual execution', async () => {
  const engine = createPlanEngine(tools, memory, null, logFn);
  const plan = {
    id: 'test-dry', task: 'dry', status: 'ready', steps: [
      { id: 1, action: 'write', target: 'should-not-exist.txt', content: 'x', description: 'dry', status: 'pending', depends_on: [] },
    ], createdAt: new Date().toISOString(),
  };
  await engine.executePlan(plan, { dryRun: true });
  assert.equal(fs.existsSync(path.join(tmpDir, 'should-not-exist.txt')), false);
});

test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });
