/**
 * Samakia Specs API Client — fetches rich ecosystem data for per-repo agents.
 * All endpoints are parametrized and cacheable.
 */

const DEFAULT_BASE = 'http://localhost:33091';
const TIMEOUT = 10000;

async function get(base, path) {
  try {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: await res.json() };
  } catch (e) { return { ok: false, error: e.message }; }
}

export function createSpecsClient(baseUrl = DEFAULT_BASE) {
  const base = baseUrl;

  return {
    /** Full ecosystem context for a specific repo */
    async getRepoContext(repo) {
      const r = await get(base, `/api/v1/agent/context?repo=${encodeURIComponent(repo)}`);
      return r.ok ? r.data.data : null;
    },

    /** Contract drift state across all repos */
    async getDrift() {
      const r = await get(base, '/api/v1/drift');
      return r.ok ? r.data.data : null;
    },

    /** Repo alignment + compliance for a specific repo */
    async getRepoAlignment(repo) {
      const r = await get(base, `/api/v1/repo-alignment/${encodeURIComponent(repo)}`);
      return r.ok ? r.data : null;
    },

    /** Compliance history (last N snapshots) */
    async getComplianceHistory() {
      const r = await get(base, '/api/v1/compliance/history');
      return r.ok ? r.data.data : [];
    },

    /** Dependency graph (who depends on what) */
    async getDependencies() {
      const r = await get(base, '/api/v1/dependencies');
      return r.ok ? r.data.data : null;
    },

    /** Changelog diff between two spec versions */
    async getChangelog(from, to) {
      const r = await get(base, `/api/v1/changelog?from=${from}&to=${to}`);
      return r.ok ? r.data.data : null;
    },

    /** List available spec versions */
    async getVersions() {
      const r = await get(base, '/api/v1/changelog');
      return r.ok ? r.data.data?.versions : [];
    },

    /** Next.js version compliance across all projects */
    async getNextjsCompliance() {
      const r = await get(base, '/api/v1/nextjs');
      return r.ok ? r.data : null;
    },

    /** Email domains from ingress manifest */
    async getEmailDomains() {
      const r = await get(base, '/api/v1/email-domains');
      return r.ok ? r.data.data : null;
    },

    /** Pending approval queue */
    async getApprovals() {
      const r = await get(base, '/api/v1/agent/approvals');
      return r.ok ? r.data.data : null;
    },

    /** Ecosystem health + metrics */
    async getHealth() {
      const r = await get(base, '/api/v1/health');
      return r.ok ? r.data : null;
    },

    /** Service availability checks */
    async getAvailability() {
      const r = await get(base, '/api/v1/availability');
      return r.ok ? r.data : null;
    },

    /** Fetch all data relevant for an agent cycle */
    async fetchFullContext(repo) {
      const [context, drift, alignment, deps, health] = await Promise.all([
        this.getRepoContext(repo),
        this.getDrift(),
        this.getRepoAlignment(repo),
        this.getDependencies(),
        this.getHealth(),
      ]);
      return {
        repo,
        context,
        drift: drift ? { total: drift.totalRepos, drifted: drift.driftedCount, myDrift: drift.repos?.find(r => r.name === repo) } : null,
        alignment,
        dependencies: deps ? { myDeps: deps.edges?.filter(e => e.from === repo), myConsumers: deps.edges?.filter(e => e.to === repo) } : null,
        health,
        fetchedAt: new Date().toISOString(),
      };
    },
  };
}
