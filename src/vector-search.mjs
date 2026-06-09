/**
 * Qdrant vector search client for samakia-agent.
 * Queries the SAMAKIA-VECTOR cluster for relevant code context.
 */

const DEFAULT_URL = 'http://localhost:6333';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.11.30:11434';
const EMBED_MODEL = 'nomic-embed-text';

async function embed(text) {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 500) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    return (await r.json()).embedding;
  } catch { return null; }
}

export function createVectorSearch(qdrantUrl = DEFAULT_URL) {
  return {
    /** Search for code similar to a query string */
    async search(collection, query, { limit = 5, filter } = {}) {
      const vector = await embed(query);
      if (!vector) return [];

      try {
        const body = { vector, limit, with_payload: true };
        if (filter) body.filter = filter;
        const r = await fetch(`${qdrantUrl}/collections/${collection}/points/search`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) return [];
        const data = await r.json();
        return (data.result || []).map(p => ({
          score: p.score,
          path: p.payload?.path,
          repo: p.payload?.repo,
          content: p.payload?.content,
          type: p.payload?.type,
        }));
      } catch { return []; }
    },

    /** Search within a specific repo's collection */
    async searchRepo(repoName, query, limit = 5) {
      const collection = `code-${repoName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      return this.search(collection, query, { limit });
    },

    /** Search across all collections for a query */
    async searchEcosystem(query, limit = 5) {
      try {
        const r = await fetch(`${qdrantUrl}/collections`, { signal: AbortSignal.timeout(3000) });
        if (!r.ok) return [];
        const cols = (await r.json()).result?.collections || [];
        const results = [];
        for (const col of cols.slice(0, 5)) { // max 5 collections
          const hits = await this.search(col.name, query, { limit: 2 });
          results.push(...hits);
        }
        return results.sort((a, b) => b.score - a.score).slice(0, limit);
      } catch { return []; }
    },

    /** Check if Qdrant is reachable */
    async isAvailable() {
      try { const r = await fetch(`${qdrantUrl}/healthz`, { signal: AbortSignal.timeout(3000) }); return r.ok; }
      catch { return false; }
    },
  };
}
