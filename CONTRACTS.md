# SAMAKIA-AGENT Contracts

Source of truth: `/home/aggelos/samakia-specs/repo-contracts/samakia-agent.md`
Sync target: `/home/aggelos/SAMAKIA-MODULES/samakia-agent/CONTRACTS.md`.
Shared ecosystem contract: `/home/aggelos/samakia-specs/specs/base/ecosystem.yaml`.

## Purpose

`@samakia/agent-core` is the canonical reusable autonomous agent runtime for all Samakia ecosystem repos. Currently at **v5.0.0**.

## Capabilities

### Personas (7)
- **Planner**: breaks tasks into ordered steps
- **Designer**: proposes file changes and architecture
- **Implementer**: writes production-ready code
- **Builder**: analyzes build errors
- **Tester**: analyzes test failures
- **Deployer**: verifies deployment health
- **Fixer**: patches code to resolve errors (enhanced with RAG context)

### Reasoning
- **Tree of Thoughts**: multi-branch solution exploration with scoring
- **Self-Reflection**: LLM reviews its own output before applying
- **Confidence Scoring**: patches scored 0-100, low-confidence flagged for human
- **Error Pattern Memory**: tracks which fixes worked/failed, never repeats failures
- **Context Loading**: reads importers, siblings, tsconfig before LLM call
- **RAG Vector Search**: queries SAMAKIA-SHARED-VECTOR for semantically similar code

### Verification Pipeline
Runs 8 check types: lint, build, API health, tests, accessibility, availability, metrics, deploy.
Auto-fixes fixable failures via enhanced reasoning + immediate re-verification.

### Plan Execution Engine
- Breaks tasks into ordered steps (read/write/exec/verify)
- Dependency ordering between steps
- Oversight loop: verify after each step, fix on failure (max 3 retries)
- Progress tracking (pending/running/done/failed/blocked)
- Plan persistence in memory/plans/

### Safety
- **Scope Limiter**: glob-based file path whitelist
- **Quarantine Mode**: 3 consecutive cycle failures → agent pauses
- **Rollback Registry**: saves file state before modifications, can undo

### Communication
- **Inter-agent Messaging**: send/receive between per-repo agents
- **Specs Integration**: fetches ecosystem context from samakia-specs every cycle
- **Directive Inbox**: receives compliance fix directives from specs agent
- **Report Outbox**: writes compliance reports back

### CLI
```
samakia-agent init          # initialize agent/ directory
samakia-agent run [--live]  # run full cycle
samakia-agent status        # show agent state
samakia-agent plan "task"   # generate execution plan (preview)
samakia-agent digest        # weekly activity summary
samakia-agent undo          # revert last agent commit
```

## Governance
- Published to SAMAKIA-REGISTRY as `@samakia/agent-core`
- samakia-specs agent sends directives to per-repo `agent/inbox/`
- Per-repo agents write compliance reports to `agent/outbox/`
- 54 tests across 6 test files
- Uses Ollama `qwen3-coder:latest` for LLM + `nomic-embed-text` for embeddings
- Uses SAMAKIA-SHARED-VECTOR (Qdrant) for RAG context retrieval
