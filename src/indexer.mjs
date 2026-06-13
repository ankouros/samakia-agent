/**
 * Self-indexing: content-hash diff, batch embed via Ollama, upsert to Qdrant.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const BATCH_SIZE = 4;
const EMBED_MODEL = 'nomic-embed-text';
const MAX_TEXT = 8000;

function hash(content) { return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16); }

function walkFiles(dir, extensions, ignore) {
  const results = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      const rel = path.relative(dir, full);
      if (ignore.some(p => rel.startsWith(p) || entry.name === p)) continue;
      if (entry.isDirectory()) walk(full);
      else if (extensions.some(e => entry.name.endsWith(e))) results.push(full);
    }
  }
  walk(dir);
  return results;
}

function getGitChanged(repoRoot) {
  try {
    const out = execSync('git diff --name-only HEAD~1 HEAD', { cwd: repoRoot, encoding: 'utf8', timeout: 5000 });
    return out.split('\n').filter(Boolean).map(f => path.join(repoRoot, f));
  } catch { return []; }
}

async function embed(text, ollamaUrl) {
  try {
    const r = await fetch(`${ollamaUrl}/api/embeddings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, MAX_TEXT) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    return (await r.json()).embedding;
  } catch { return null; }
}

async function batchEmbed(files, ollamaUrl) {
  const results = [];
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const vectors = await Promise.all(batch.map(f => embed(f.content, ollamaUrl)));
    for (let j = 0; j < batch.length; j++) {
      if (vectors[j]) results.push({ ...batch[j], vector: vectors[j] });
    }
  }
  return results;
}

async function upsertQdrant(qdrantUrl, collection, points) {
  if (!points.length) return;
  // Ensure collection exists
  await fetch(`${qdrantUrl}/collections/${collection}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vectors: { size: 768, distance: 'Cosine' } }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});

  const body = { points: points.map((p, i) => ({ id: parseInt(hash(p.path), 16) % 2147483647, vector: p.vector, payload: { path: p.path, repo: p.repo, content: p.content.slice(0, 2000), type: path.extname(p.path) } })) };
  await fetch(`${qdrantUrl}/collections/${collection}/points?wait=true`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
}

export function createIndexer(config, cache, messaging) {
  const { repoRoot, projectName, indexCollection, indexExtensions = ['.ts', '.tsx', '.js', '.mjs', '.md', '.yaml', '.yml'], indexIgnore = ['node_modules', '.next', '.git', 'dist', 'build'], ollamaUrl = 'http://192.168.11.30:11434', qdrantUrl = 'http://localhost:6333' } = config;
  const collection = indexCollection || `code-${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

  return {
    async index({ changedOnly = false } = {}) {
      const files = changedOnly ? getGitChanged(repoRoot) : walkFiles(repoRoot, indexExtensions, indexIgnore);
      const validFiles = files.filter(f => indexExtensions.some(e => f.endsWith(e)) && fs.existsSync(f));
      if (!validFiles.length) return { indexed: 0 };

      // Load content and compute hashes
      const prevHashes = cache?.isConnected ? await cache.getIndexHashes(projectName) : {};
      const changed = [];
      const newHashes = { ...prevHashes };

      for (const fp of validFiles) {
        try {
          const content = fs.readFileSync(fp, 'utf8');
          const h = hash(content);
          const rel = path.relative(repoRoot, fp);
          if (prevHashes[rel] !== h) {
            changed.push({ path: rel, content, repo: projectName });
            newHashes[rel] = h;
          }
        } catch { /* skip unreadable */ }
      }

      if (!changed.length) return { indexed: 0 };

      // Batch embed + upsert
      const embedded = await batchEmbed(changed, ollamaUrl);
      if (embedded.length) await upsertQdrant(qdrantUrl, collection, embedded);

      // Update hashes
      if (cache?.isConnected) await cache.setIndexHashes(projectName, newHashes);

      // Publish indexed event
      if (messaging?.isConnected) {
        await messaging.publish('indexed', { collection, filesChanged: embedded.length });
      }

      return { indexed: embedded.length, total: changed.length };
    },
  };
}
