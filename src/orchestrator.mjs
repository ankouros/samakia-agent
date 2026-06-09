import fs from 'node:fs';
import path from 'node:path';

// Allow self-signed certs (local CA in Samakia ecosystem)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || '0';

import { generate, parseJSON, health } from './ollama.mjs';
import { createTools } from './tools.mjs';
import { createMemory } from './memory.mjs';
import { createPersonas } from './personas.mjs';
import { selfReflect, scoreConfidence } from './reasoning.mjs';
import { loadErrorContext, formatContextForPrompt, verifyAndRetry, createErrorMemory, buildProjectContext, enhancedFixerPrompt } from './enhanced-reasoning.mjs';
import { createVerificationPipeline } from './verification.mjs';

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

  // Fetch ecosystem context from samakia-specs for memory seeding
  const specsApi = config.specsApiBase || 'https://specs.samakia.net';
  const inboxDir = path.join(agentDir, 'inbox');
  fs.mkdirSync(inboxDir, { recursive: true });
  try {
    const ctxRes = await fetch(`${specsApi}/api/v1/agent/context?repo=${encodeURIComponent(projectName)}`, { signal: AbortSignal.timeout(10000) });
    if (ctxRes.ok) {
      const ctx = await ctxRes.json();
      if (ctx.ok) {
        memory.updateContext({ ecosystemRules: ctx.data.rules, repoCompliance: ctx.data.repoContext?.compliance, directives: ctx.data.directives?.length || 0 });
        // Store directives in inbox
        for (const dir of ctx.data.directives || []) {
          const dirFile = path.join(inboxDir, `${dir.id || 'dir-' + Date.now()}.json`);
          if (!fs.existsSync(dirFile)) fs.writeFileSync(dirFile, JSON.stringify(dir, null, 2));
        }
        // Generate self-fix directives from failing compliance dimensions
        const compliance = ctx.data.repoContext?.compliance;
        if (compliance && compliance.score < 100) {
          for (const dim of compliance.dimensions || []) {
            if (!dim.ok && dim.applicable) {
              const dirId = `autofix-${dim.id}-${Date.now()}`;
              const dirFile = path.join(inboxDir, `${dirId}.json`);
              if (!fs.existsSync(dirFile)) {
                fs.writeFileSync(dirFile, JSON.stringify({
                  id: dirId, type: 'fix_compliance', priority: 'high',
                  details: { dimension: dim.id, weight: dim.weight, detail: dim.detail, action: `Fix failing dimension: ${dim.id}` }
                }, null, 2));
              }
            }
          }
        }
        _log('info', 'ecosystem_context', { rules: ctx.data.rules?.hardRules?.length, compliance: ctx.data.repoContext?.compliance?.score });
      }
    }
  } catch (ctxErr) { _log('warn', 'ecosystem_context_unavailable', { error: ctxErr?.message || String(ctxErr) }); }

  // Check inbox for directives
  const directives = fs.readdirSync(inboxDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(inboxDir, f), 'utf8')));
  _log('info', 'directives', { count: directives.length });

  // Process compliance fix directives (if Ollama available and not recently attempted)
  if (ollamaOk && directives.length > 0 && !dryRun) {
    for (const dir of directives.slice(0, 2)) { // max 2 per cycle
      if (dir.type !== 'fix_compliance') continue;
      const dimId = dir.details?.dimension;
      if (memory.wasRecentlyDone(`fix-${dimId}`, 60)) continue; // skip if attempted in last hour

      _log('info', 'fixing_compliance', { dimension: dimId });
      const fixResult = await callPersona('fixer', `Fix compliance issue: dimension "${dimId}" is failing. Detail: ${dir.details?.detail || 'unknown'}. The project is ${projectName}. What file needs to be created or updated?`);
      if (fixResult.ok && fixResult.data?.patches) {
        for (const patch of fixResult.data.patches) {
          if (scoreConfidence(patch) >= 50) {
            tools.writeFile(patch.path, patch.content);
            _log('info', 'patch_applied', { path: patch.path, reason: patch.reason });
          }
        }
      }
      memory.logAction({ key: `fix-${dimId}`, type: 'compliance_fix', dimension: dimId });
      // Remove processed directive
      const dirFile = path.join(inboxDir, `${dir.id}.json`);
      if (fs.existsSync(dirFile)) fs.unlinkSync(dirFile);
    }
  }

  // Build with enhanced reasoning
  _log('info', 'build_start');
  const errorMem = createErrorMemory(path.join(agentDir, 'memory'));
  const projCtx = buildProjectContext(tools);

  const buildResult = verifyAndRetry(tools, buildCmd, (error, attempt) => {
    if (!ollamaOk) return false;
    const errKey = errorMem.errorKey(error);

    // Check if we already know a successful fix
    const knownFix = errorMem.getSuccessfulFix(errKey);
    if (knownFix && attempt === 0) {
      _log('info', 'applying_known_fix', { errKey });
      try { const fix = JSON.parse(knownFix); for (const p of fix) tools.writeFile(p.path, p.content); return true; } catch {}
    }

    // Load context + get failed fixes to avoid repeating
    const ctx = loadErrorContext(tools, error);
    const failedFixes = errorMem.getFailedFixes(errKey);
    const prompt = enhancedFixerPrompt(error, projCtx, formatContextForPrompt(ctx), failedFixes);

    _log('info', 'fixing', { attempt, contextFiles: ctx.length, failedBefore: failedFixes.length });

    // Call LLM synchronously via top-level await workaround — use sync approach
    // Since we can't await inside a sync callback, we'll handle this in the main flow
    return false; // fallback — enhanced fix happens in main loop below
  }, 1); // Only 1 retry in verifyAndRetry, main loop does the smart retries

  // Enhanced fix loop (async-compatible)
  let finalBuild = buildResult;
  if (!finalBuild.ok && ollamaOk && !dryRun) {
    for (let attempt = 0; attempt < MAX_FIX_RETRIES; attempt++) {
      const error = finalBuild.error || '';
      const errKey = errorMem.errorKey(error);
      const ctx = loadErrorContext(tools, error);
      const failedFixes = errorMem.getFailedFixes(errKey);
      const prompt = enhancedFixerPrompt(error, projCtx, formatContextForPrompt(ctx), failedFixes);

      _log('warn', 'build_failed', { attempt, error: error.slice(0, 150) });
      const fixResult = await callPersona('fixer', prompt);
      if (fixResult.ok && fixResult.data?.patches) {
        const patchDesc = fixResult.data.patches.map(p => p.path).join(', ');
        for (const patch of fixResult.data.patches) {
          if (scoreConfidence(patch) >= 40) tools.writeFile(patch.path, patch.content);
        }
        // Immediate verification
        const recheck = tools.exec(buildCmd);
        if (recheck.ok) {
          errorMem.record(errKey, JSON.stringify(fixResult.data.patches), true);
          finalBuild = { ok: true, retries: attempt + 1 };
          _log('info', 'fix_succeeded', { attempt, patches: patchDesc });
          break;
        } else {
          errorMem.record(errKey, patchDesc, false);
          finalBuild = { ok: false, error: recheck.error };
        }
      } else break;
    }
  }
  memory.logBuild({ ok: finalBuild.ok, retries: finalBuild.retries || 0 });
  if (!finalBuild.ok) { _log('error', 'build_failed_final'); }

  // Full verification pipeline (lint → build already done → api → test → a11y → availability → metrics → deploy)
  if (finalBuild.ok) {
    const pipeline = createVerificationPipeline(tools, config);
    const results = pipeline.runAll();
    const summary = pipeline.summarize(results);
    _log('info', 'verification_pipeline', summary);

    // Auto-fix fixable failures
    const fixable = pipeline.getFixableFailures(results);
    for (const failure of fixable.slice(0, 2)) { // max 2 auto-fixes per cycle
      if (!ollamaOk || dryRun) break;
      const errKey = errorMem.errorKey(failure.error || failure.id);
      if (memory.wasRecentlyDone(`fix-${errKey}`, 60)) continue;

      const ctx = loadErrorContext(tools, failure.error || '');
      const failedFixes = errorMem.getFailedFixes(errKey);
      const prompt = enhancedFixerPrompt(failure.error || failure.detail, projCtx, formatContextForPrompt(ctx), failedFixes);

      _log('info', 'fixing_issue', { check: failure.id, category: failure.category });
      const fixResult = await callPersona('fixer', prompt);
      if (fixResult.ok && fixResult.data?.patches) {
        for (const patch of fixResult.data.patches) {
          if (scoreConfidence(patch) >= 40) tools.writeFile(patch.path, patch.content);
        }
        // Re-run the specific check
        const recheck = pipeline.runCheck(failure.id, { cmd: failure.id === 'lint' ? config.lintCmd : failure.id === 'test' ? config.testCmd : null, url: null, fixable: true, category: failure.category });
        errorMem.record(errKey, fixResult.data.patches.map(p => p.path).join(','), recheck.status === 'pass');
        _log(recheck.status === 'pass' ? 'info' : 'warn', 'fix_result', { check: failure.id, fixed: recheck.status === 'pass' });
      }
      memory.logAction({ key: `fix-${errKey}`, type: 'verification_fix', check: failure.id });
    }
  }

  // Deploy (after all fixes applied)
  if (finalBuild.ok && deployCmd && !dryRun) {
    _log('info', 'deploy_start');
    const deployResult = tools.exec(deployCmd);
    if (deployResult.ok && healthUrl) {
      const h = tools.curl(healthUrl);
      _log(h.status === 200 ? 'info' : 'error', 'deploy_health', { status: h.status });
    }
  }

  // Commit if changes exist
  if (!dryRun && finalBuild.ok) {
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
