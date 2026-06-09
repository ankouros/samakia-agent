#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgent } from '../src/orchestrator.mjs';

const args = process.argv.slice(2);
const cmd = args[0] || 'run';
const cwd = process.cwd();

if (cmd === 'init') {
  const agentDir = path.join(cwd, 'agent');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(path.join(agentDir, 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(agentDir, 'outbox'), { recursive: true });
  fs.mkdirSync(path.join(agentDir, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(agentDir, 'logs'), { recursive: true });
  const configPath = path.join(agentDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
    fs.writeFileSync(configPath, JSON.stringify({
      projectName: pkg.name || path.basename(cwd),
      repoRoot: cwd,
      buildCmd: 'npm run build',
      testCmd: 'npm test',
      deployCmd: null,
      healthUrl: null,
      dryRun: true,
    }, null, 2));
  }
  console.log(`[samakia-agent] initialized at ${agentDir}`);
} else if (cmd === 'run') {
  const configPath = path.join(cwd, 'agent', 'config.json');
  if (!fs.existsSync(configPath)) { console.error('[samakia-agent] not initialized. Run: samakia-agent init'); process.exit(1); }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (args.includes('--live')) config.dryRun = false;
  const result = await runAgent(config);
  console.log(`[samakia-agent] ${result.ok ? 'ok' : 'failed'} (${result.log} log entries)`);
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
  console.log(`Period: ${digest.period.from.slice(0,10)} → ${digest.period.to.slice(0,10)}`);
  digest.highlights.forEach(h => console.log(`  • ${h}`));
  console.log(`  Total actions: ${digest.summary.totalActions}`);
} else if (cmd === 'undo') {
  const { execSync } = await import('node:child_process');
  try { execSync('git revert HEAD --no-edit', { cwd, stdio: 'inherit' }); console.log('[samakia-agent] last commit reverted'); }
  catch { console.log('[samakia-agent] undo failed'); }
} else {
  console.log('Usage: samakia-agent [init|run|status|plan|digest|undo] [--live]');
}
