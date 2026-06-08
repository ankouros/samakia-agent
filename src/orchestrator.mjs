import fs from 'node:fs';
import path from 'node:path';
import { generate, parseJSON, health } from './ollama.mjs';
import { createTools } from './tools.mjs';
import { createMemory } from './memory.mjs';
import { createPersonas } from './personas.mjs';
import { selfReflect, scoreConfidence } from './reasoning.mjs';

const MAX_FIX_RETRIES = 3;

export async function runAgent(config) {
  const { repoRoot, projectName, projectContext, buildCmd = 'npm run build', testCmd = 'npm test', deployCmd, healthUrl, dryRun = true } = config;
  const agentDir = path.join(repoRoot, 'agent');
  const logsDir = path.join(agentDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const tools = createTools(repoRoot);
  const memory = createMemory(agentDir);
  const personas = createPersonas(projectName, projectContext);
  const log = [];
  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  function _log(level, msg, data) { log.push({ ts: new Date().toISOString(), level, msg, data }); }
  async function callPersona(id, prompt) {
    const p = personas[id];
    if (!p) return { ok: false, error: `unknown persona: ${id}` };
    const r = await generate({ system: p.system, prompt });
    if (!r.ok) return { ok: false, error: r.error };
    return parseJSON(r.response);
  }

  // Check health
  const ollamaOk = (await health()).ok;
  _log('info', 'start', { dryRun, ollama: ollamaOk, project: projectName });

  // Check inbox for directives
  const inboxDir = path.join(agentDir, 'inbox');
  fs.mkdirSync(inboxDir, { recursive: true });
  const directives = fs.readdirSync(inboxDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(inboxDir, f), 'utf8')));
  _log('info', 'directives', { count: directives.length });

  // Build
  _log('info', 'build_start');
  let buildResult = tools.exec(buildCmd);
  let retries = 0;
  while (!buildResult.ok && retries < MAX_FIX_RETRIES && ollamaOk) {
    _log('warn', 'build_failed', { error: buildResult.error?.slice(0, 200), retry: retries });
    const fixResult = await callPersona('fixer', `Build error:\n${buildResult.error}\n\nFix it.`);
    if (fixResult.ok && fixResult.data?.patches) {
      for (const patch of fixResult.data.patches) {
        if (scoreConfidence(patch) >= 50 && !dryRun) tools.writeFile(patch.path, patch.content);
      }
    }
    buildResult = tools.exec(buildCmd);
    retries++;
  }
  memory.logBuild({ ok: buildResult.ok, retries });
  if (!buildResult.ok) { _log('error', 'build_failed_final'); }

  // Test
  if (buildResult.ok && testCmd) {
    _log('info', 'test_start');
    const testResult = tools.exec(testCmd);
    _log(testResult.ok ? 'info' : 'warn', 'test_result', { ok: testResult.ok });
  }

  // Deploy
  if (buildResult.ok && deployCmd && !dryRun) {
    _log('info', 'deploy_start');
    const deployResult = tools.exec(deployCmd);
    if (deployResult.ok && healthUrl) {
      const h = tools.curl(healthUrl);
      _log(h.status === 200 ? 'info' : 'error', 'deploy_health', { status: h.status });
    }
  }

  // Commit if changes exist
  if (!dryRun && buildResult.ok) {
    const status = tools.git('status --porcelain');
    if (status.ok && status.output?.trim()) {
      tools.git('add -A');
      tools.git(`commit -m "fix(agent): auto-fix cycle ${ts}"`);
      tools.git('push');
      memory.logAction({ key: `commit-${ts}`, type: 'commit' });
      _log('info', 'committed');
    }
  }

  // Write report to outbox
  const outboxDir = path.join(agentDir, 'outbox');
  fs.mkdirSync(outboxDir, { recursive: true });
  const report = { repo: projectName, ts: new Date().toISOString(), build: buildResult.ok, directives: directives.length, log: log.length };
  fs.writeFileSync(path.join(outboxDir, `report-${ts}.json`), JSON.stringify(report, null, 2));

  // Save log
  fs.writeFileSync(path.join(logsDir, `run-${ts}.json`), JSON.stringify(log, null, 2));
  memory.updateContext({ lastBuild: buildResult.ok, lastRun: new Date().toISOString() });

  return { ok: buildResult.ok, log: log.length, report };
}
