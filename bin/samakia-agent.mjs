#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { runAgent } from '../src/orchestrator.mjs';

const args = process.argv.slice(2);
const cmd = args[0] || 'run';
const cwd = process.cwd();

/** Load config with env file support */
function loadConfig() {
  const configPath = path.join(cwd, 'agent', 'config.json');
  if (!fs.existsSync(configPath)) { console.error('[samakia-agent] not initialized. Run: samakia-agent init'); process.exit(1); }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  // Load env file for credentials
  const envFile = config.envFile || '/home/aggelos/.samakia-agent-env';
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m) process.env[m[1]] = m[2];
    }
  }
  config.mqUrl = config.mqUrl || process.env.SAMAKIA_AGENT_MQ_URL || '';
  config.cacheUrl = config.cacheUrl || process.env.SAMAKIA_AGENT_CACHE_URL || '';
  config.qdrantUrl = config.qdrantUrl || process.env.SAMAKIA_AGENT_QDRANT_URL || 'http://localhost:6333';
  config.ollamaUrl = config.ollamaUrl || process.env.SAMAKIA_AGENT_OLLAMA_URL || 'http://192.168.11.30:11434';
  return config;
}

if (cmd === 'init') {
  const agentDir = path.join(cwd, 'agent');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(path.join(agentDir, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(agentDir, 'logs'), { recursive: true });
  const configPath = path.join(agentDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    const name = (() => { try { return JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).name; } catch { return path.basename(cwd); } })();
    fs.writeFileSync(configPath, JSON.stringify({
      schemaVersion: 2, projectName: name, repoRoot: cwd,
      buildCmd: 'npm run build', testCmd: 'npm test', deployCmd: null, healthUrl: null, dryRun: true,
      envFile: '/home/aggelos/.samakia-agent-env',
      indexOnCommit: true, indexCollection: `code-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      indexExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.md', '.yaml', '.yml'],
      indexIgnore: ['node_modules', '.next', '.git', 'dist', 'build'],
    }, null, 2));
  }
  // Install git hook
  const hooksDir = path.join(cwd, '.git', 'hooks');
  if (fs.existsSync(path.join(cwd, '.git'))) {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'post-commit');
    const hookContent = `#!/bin/sh\nnode ${path.resolve(import.meta.url.replace('file://', '').replace('/bin/samakia-agent.mjs', ''))}/bin/samakia-agent.mjs index --changed-only >/dev/null 2>&1 &\n`;
    fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });
  }
  console.log(`[samakia-agent] initialized at ${agentDir}`);

} else if (cmd === 'run') {
  const config = loadConfig();
  if (args.includes('--live')) config.dryRun = false;
  // Initialize infra connections for orchestrator
  const { createCache } = await import('../src/cache.mjs');
  const { createMessaging } = await import('../src/messaging.mjs');
  const { createIndexer } = await import('../src/indexer.mjs');
  const cache = createCache(config.cacheUrl);
  await cache.connect();
  const messaging = createMessaging(path.join(cwd, 'agent'), config.projectName, config.mqUrl);
  await messaging.connect();
  config._indexer = createIndexer(config, cache, messaging);
  config._messaging = messaging;
  config._cache = cache;
  const result = await runAgent(config);
  await cache.writeHeartbeat(config.projectName);
  await messaging.close();
  await cache.close();
  console.log(`[samakia-agent] ${result.ok ? 'ok' : 'failed'} (${result.log} log entries)`);

} else if (cmd === 'index') {
  const config = loadConfig();
  const changedOnly = args.includes('--changed-only');
  const { createCache } = await import('../src/cache.mjs');
  const { createMessaging } = await import('../src/messaging.mjs');
  const { createIndexer } = await import('../src/indexer.mjs');
  const cache = createCache(config.cacheUrl);
  await cache.connect();
  const messaging = createMessaging(path.join(cwd, 'agent'), config.projectName, config.mqUrl);
  await messaging.connect();
  const indexer = createIndexer(config, cache, messaging);
  const result = await indexer.index({ changedOnly });
  console.log(`[samakia-agent] indexed ${result.indexed} files`);
  await messaging.close();
  await cache.close();

} else if (cmd === 'listen') {
  const config = loadConfig();
  const { createCache } = await import('../src/cache.mjs');
  const { createMessaging } = await import('../src/messaging.mjs');
  const cache = createCache(config.cacheUrl);
  await cache.connect();
  const messaging = createMessaging(path.join(cwd, 'agent'), config.projectName, config.mqUrl);
  await messaging.connect();
  if (!messaging.isConnected) { console.error('[samakia-agent] cannot connect to MQ'); process.exit(1); }
  console.log(`[samakia-agent] listening on q.agent.${config.projectName}`);
  // Heartbeat interval
  const hbInterval = setInterval(() => cache.writeHeartbeat(config.projectName), 60000);
  await cache.writeHeartbeat(config.projectName);
  await messaging.subscribe(async (msg) => {
    console.log(`[samakia-agent] received: ${msg.type} from ${msg.repo || 'broadcast'}`);
    if (msg.type === 'directive' && !config.dryRun) {
      config._messaging = messaging; config._cache = cache;
      await runAgent(config);
    }
  });
  process.on('SIGTERM', async () => { clearInterval(hbInterval); await messaging.close(); await cache.close(); process.exit(0); });
  process.on('SIGINT', async () => { clearInterval(hbInterval); await messaging.close(); await cache.close(); process.exit(0); });

} else if (cmd === 'health') {
  const config = loadConfig();
  const { createCache } = await import('../src/cache.mjs');
  const cache = createCache(config.cacheUrl);
  const ok = await cache.connect();
  if (ok) { await cache.writeHeartbeat(config.projectName); console.log(`[samakia-agent] health: ok (heartbeat written)`); }
  else { console.log('[samakia-agent] health: degraded (cache unreachable)'); }
  // Check Ollama
  try { const r = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) }); console.log(`[samakia-agent] ollama: ${r.ok ? 'ok' : 'down'}`); }
  catch { console.log('[samakia-agent] ollama: unreachable'); }
  // Check Qdrant
  try { const r = await fetch(`${config.qdrantUrl}/healthz`, { signal: AbortSignal.timeout(3000) }); console.log(`[samakia-agent] qdrant: ${r.ok ? 'ok' : 'down'}`); }
  catch { console.log('[samakia-agent] qdrant: unreachable'); }
  await cache.close();

} else if (cmd === 'status') {
  const memPath = path.join(cwd, 'agent', 'memory', 'context.json');
  if (fs.existsSync(memPath)) { console.log(JSON.parse(fs.readFileSync(memPath, 'utf8'))); }
  else { console.log('No agent state. Run: samakia-agent init'); }

} else if (cmd === 'plan') {
  const task = args.slice(1).join(' ');
  if (!task) { console.log('Usage: samakia-agent plan "task description"'); process.exit(1); }
  const { createPlanEngine } = await import('../src/plan-engine.mjs');
  const { createTools } = await import('../src/tools.mjs');
  const { createMemory } = await import('../src/memory.mjs');
  const { buildProjectContext } = await import('../src/enhanced-reasoning.mjs');
  const tools = createTools(cwd);
  const memory = createMemory(path.join(cwd, 'agent'));
  const engine = createPlanEngine(tools, memory, null, (l, m, d) => console.log(`[${l}] ${m}`, d || ''));
  const result = await engine.createPlan(task, buildProjectContext(tools));
  if (result.ok) { console.log('\nPlan created:'); result.plan.steps.forEach(s => console.log(`  ${s.id}. [${s.action}] ${s.description}`)); }
  else { console.log('Plan failed:', result.error); }

} else if (cmd === 'digest') {
  const { generateDigest } = await import('../src/digest.mjs');
  const digest = generateDigest(path.join(cwd, 'agent', 'memory'));
  console.log('\n📊 Weekly Digest');
  console.log(`Period: ${digest.period.from.slice(0, 10)} → ${digest.period.to.slice(0, 10)}`);
  digest.highlights.forEach(h => console.log(`  • ${h}`));
  console.log(`  Total actions: ${digest.summary.totalActions}`);

} else if (cmd === 'undo') {
  const { execSync } = await import('node:child_process');
  try { execSync('git revert HEAD --no-edit', { cwd, stdio: 'inherit' }); console.log('[samakia-agent] last commit reverted'); }
  catch { console.log('[samakia-agent] undo failed'); }

} else {
  console.log('Usage: samakia-agent [init|run|index|listen|health|status|plan|digest|undo] [--live] [--changed-only]');
}
