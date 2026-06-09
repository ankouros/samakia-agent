import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { createScopeLimiter, createQuarantine } from '../src/safety.mjs';
import { createMessaging } from '../src/messaging.mjs';
import { generateDigest } from '../src/digest.mjs';
import { minimatch } from '../src/utils.mjs';

const tmpDir = path.join(os.tmpdir(), 'agent-safety-test-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });

// ─── Utils ──────────────────────────────────────────────────────────────────
test('minimatch: matches glob patterns', () => {
  assert.equal(minimatch('src/lib/db.ts', 'src/**'), true);
  assert.equal(minimatch('src/app/page.js', 'src/**'), true);
  assert.equal(minimatch('package.json', 'package.json'), true);
  assert.equal(minimatch('node_modules/x', 'src/**'), false);
  assert.equal(minimatch('.env', 'src/**'), false);
});

// ─── Scope Limiter ──────────────────────────────────────────────────────────
test('scopeLimiter: allows src/ files', () => {
  const limiter = createScopeLimiter();
  assert.equal(limiter.isAllowed('src/lib/db.ts'), true);
  assert.equal(limiter.isAllowed('tests/foo.test.mjs'), true);
});

test('scopeLimiter: blocks disallowed paths', () => {
  const limiter = createScopeLimiter(['src/**']);
  assert.equal(limiter.isAllowed('.env'), false);
  assert.equal(limiter.isAllowed('node_modules/x'), false);
});

test('scopeLimiter: filter removes blocked patches', () => {
  const limiter = createScopeLimiter(['src/**']);
  const patches = [{ path: 'src/x.js' }, { path: '.env' }, { path: 'src/y.js' }];
  assert.equal(limiter.filter(patches).length, 2);
});

// ─── Quarantine ─────────────────────────────────────────────────────────────
test('quarantine: not active initially', () => {
  const q = createQuarantine(path.join(tmpDir, 'q1'));
  assert.equal(q.isQuarantined(), false);
});

test('quarantine: activates after 3 failures', () => {
  const q = createQuarantine(path.join(tmpDir, 'q2'));
  q.recordFailure();
  q.recordFailure();
  assert.equal(q.isQuarantined(), false);
  q.recordFailure();
  assert.equal(q.isQuarantined(), true);
});

test('quarantine: resets on success', () => {
  const q = createQuarantine(path.join(tmpDir, 'q3'));
  q.recordFailure(); q.recordFailure(); q.recordFailure();
  assert.equal(q.isQuarantined(), true);
  q.recordSuccess();
  assert.equal(q.isQuarantined(), false);
});

// ─── Messaging ──────────────────────────────────────────────────────────────
test('messaging: send and receive', () => {
  const repo1 = path.join(tmpDir, 'repo1');
  const repo2 = path.join(tmpDir, 'repo2');
  fs.mkdirSync(path.join(repo1, 'agent', 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(repo2, 'agent', 'inbox'), { recursive: true });

  const m1 = createMessaging(path.join(repo1, 'agent'), 'repo1');
  const m2 = createMessaging(path.join(repo2, 'agent'), 'repo2');

  m1.send(repo2, { type: 'breaking_change', change: 'API v3 updated' });
  const msgs = m2.receive();
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].from, 'repo1');
  assert.equal(msgs[0].type, 'breaking_change');
});

test('messaging: ack removes message', () => {
  const repo = path.join(tmpDir, 'repo-ack');
  fs.mkdirSync(path.join(repo, 'agent', 'inbox'), { recursive: true });
  const m = createMessaging(path.join(repo, 'agent'), 'test');
  fs.writeFileSync(path.join(repo, 'agent', 'inbox', 'msg-x-123.json'), '{"id":"msg-x-123"}');
  assert.equal(m.receive().length, 1);
  m.ack('msg-x-123');
  assert.equal(m.receive().length, 0);
});

// ─── Digest ─────────────────────────────────────────────────────────────────
test('digest: generates summary from empty memory', () => {
  const memDir = path.join(tmpDir, 'digest-mem');
  fs.mkdirSync(memDir, { recursive: true });
  const d = generateDigest(memDir);
  assert.equal(d.summary.totalActions, 0);
  assert.ok(d.generatedAt);
});

test('digest: counts recent actions', () => {
  const memDir = path.join(tmpDir, 'digest-mem2');
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, 'actions.json'), JSON.stringify([
    { ts: new Date().toISOString(), type: 'commit', key: 'x' },
    { ts: new Date().toISOString(), type: 'compliance_fix', key: 'y' },
  ]));
  const d = generateDigest(memDir);
  assert.equal(d.summary.commits, 1);
  assert.equal(d.summary.fixes, 1);
  assert.equal(d.highlights.length, 2);
});

test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });
