# SAMAKIA-AGENT Contracts

Source of truth: `/home/aggelos/samakia-specs/repo-contracts/samakia-agent.md`
Sync target: `/home/aggelos/samakia-agent/CONTRACTS.md`.
Shared ecosystem contract: `/home/aggelos/samakia-specs/specs/base/ecosystem.yaml`.

## Purpose

`@samakia/agent-core` is the canonical reusable autonomous agent runtime for all Samakia ecosystem repos.

## Contract

- Published to SAMAKIA-REGISTRY as `@samakia/agent-core`
- Provides: orchestrator, tools, memory, personas, reasoning (ToT, self-reflection, confidence)
- CLI: `samakia-agent init|run|status`
- Each consuming repo gets `agent/` directory with config, inbox, outbox, memory, logs
- Agent communicates with samakia-specs agent via inbox/outbox JSON protocol
- 15+ tests required (`npm test`)

## Governance

- samakia-specs agent sends directives to per-repo `agent/inbox/`
- Per-repo agents write compliance reports to `agent/outbox/`
- Reports include: build status, test status, directive completion, commit refs
