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
} else {
  console.log('Usage: samakia-agent [init|run|status] [--live]');
}
