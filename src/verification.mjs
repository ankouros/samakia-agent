/**
 * Verification pipeline — multi-dimensional quality checks with auto-fix.
 */

export const CHECK_TYPES = ['lint', 'build', 'api', 'test', 'accessibility', 'availability', 'metrics', 'deploy'];

export function createVerificationPipeline(tools, config) {
  const checks = {
    lint: { cmd: config.lintCmd || 'npm run lint', fixable: true, category: 'code_quality' },
    build: { cmd: config.buildCmd || 'npm run build', fixable: true, category: 'build' },
    api: { url: config.healthUrl, fixable: false, category: 'runtime' },
    test: { cmd: config.testCmd, fixable: true, category: 'testing' },
    accessibility: { cmd: config.a11yCmd || null, fixable: true, category: 'ux' },
    availability: { url: config.healthUrl, fixable: false, category: 'runtime' },
    metrics: { url: config.metricsUrl || (config.healthUrl ? config.healthUrl.replace('/health', '/metrics') : null), fixable: false, category: 'observability' },
    deploy: { cmd: config.deployCmd, fixable: false, category: 'deployment' },
  };

  return {
    /** Run all applicable checks, return results */
    runAll() {
      const results = [];
      for (const [id, check] of Object.entries(checks)) {
        if (!check.cmd && !check.url) { results.push({ id, status: 'skipped' }); continue; }
        const result = this.runCheck(id, check);
        results.push(result);
      }
      return results;
    },

    /** Run a single check */
    runCheck(id, check) {
      if (check.url) {
        const r = tools.curl(check.url);
        const ok = r.ok && r.status >= 200 && r.status < 400;
        return { id, status: ok ? 'pass' : 'fail', category: check.category, fixable: check.fixable, detail: ok ? `HTTP ${r.status}` : r.error || `HTTP ${r.status}`, error: ok ? null : `${id} check failed: ${r.error || 'HTTP ' + r.status}` };
      }
      if (check.cmd) {
        const r = tools.exec(check.cmd, { timeout: 120000 });
        return { id, status: r.ok ? 'pass' : 'fail', category: check.category, fixable: check.fixable, detail: r.ok ? 'passed' : (r.error || '').slice(0, 500), error: r.ok ? null : r.error?.slice(0, 1000) };
      }
      return { id, status: 'skipped', category: check.category };
    },

    /** Get only failed + fixable results */
    getFixableFailures(results) {
      return results.filter(r => r.status === 'fail' && r.fixable);
    },

    /** Summary of all results */
    summarize(results) {
      return {
        total: results.length,
        passed: results.filter(r => r.status === 'pass').length,
        failed: results.filter(r => r.status === 'fail').length,
        skipped: results.filter(r => r.status === 'skipped').length,
        fixable: results.filter(r => r.status === 'fail' && r.fixable).length,
      };
    },
  };
}
