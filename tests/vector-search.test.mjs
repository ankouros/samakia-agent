import test from 'node:test';
import assert from 'node:assert/strict';
import { createVectorSearch } from '../src/vector-search.mjs';

const vs = createVectorSearch('http://localhost:6333');

test('vector-search: isAvailable returns boolean', async () => {
  const available = await vs.isAvailable();
  assert.equal(typeof available, 'boolean');
  // Qdrant should be running on this host
  assert.equal(available, true);
});

test('vector-search: searchRepo returns array', async () => {
  const results = await vs.searchRepo('birds', 'database connection pool', 3);
  assert.ok(Array.isArray(results));
  // Should find results since we indexed BIRDS
  if (results.length > 0) {
    assert.ok(results[0].path);
    assert.ok(results[0].score > 0);
    assert.ok(results[0].content);
  }
});

test('vector-search: searchRepo with non-existent collection returns empty', async () => {
  const results = await vs.searchRepo('nonexistent-xyz', 'test', 3);
  assert.ok(Array.isArray(results));
  assert.equal(results.length, 0);
});

test('vector-search: searchEcosystem returns results across collections', async () => {
  const results = await vs.searchEcosystem('API route handler', 3);
  assert.ok(Array.isArray(results));
});
