# @samakia/agent-core

Autonomous per-repo agent for the Samakia ecosystem. Full developer lifecycle with memory, Tree of Thoughts, self-reflection, and verification gates.

## Install

```bash
npm install @samakia/agent-core
```

## Quick Start

```bash
npx samakia-agent init    # creates agent/ directory with config
npx samakia-agent run     # dry-run (no changes)
npx samakia-agent run --live  # live mode (writes, commits, deploys)
npx samakia-agent status  # show agent state
```

## Features

- **7 Personas**: planner, designer, implementer, builder, tester, deployer, fixer
- **Memory**: action history, build history, codebase map, rolling context
- **Tools**: readFile, writeFile, listDir, exec, git, curl (scoped to own repo)
- **Tree of Thoughts**: multi-branch exploration for complex problems
- **Self-Reflection**: LLM reviews its own output before applying
- **Confidence Scoring**: patches scored 0-100, low-confidence auto-flagged
- **Build→Test→Deploy loop**: with auto-fix retries (max 3)
- **Specs Integration**: reads directives from inbox, writes reports to outbox

## Configuration

`agent/config.json`:
```json
{
  "projectName": "my-project",
  "repoRoot": "/home/aggelos/MY-PROJECT",
  "buildCmd": "npm run build",
  "testCmd": "npm test",
  "deployCmd": "docker compose up -d --build",
  "healthUrl": "https://my-project.samakia.net/api/v1/health",
  "dryRun": true
}
```

## Ecosystem Integration

The samakia-specs agent sends directives to `agent/inbox/*.json` and collects compliance reports from `agent/outbox/*.json`.
