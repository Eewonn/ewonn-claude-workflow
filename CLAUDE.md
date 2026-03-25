# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

A reusable AI workflow orchestration system for Claude Code with a 4-phase pipeline:

**Research → Plan → Implement → Validate**

See `PLAN.md` for the full specification.

## Commands

```bash
# Install dependencies
npm install

# Validate a JSON artifact against its schema
npx tsx src/validator.ts <schema-name> <file-path>
# e.g.: npx tsx src/validator.ts run-state runs/current/run-state.json

# Orchestrator (state machine)
npx tsx src/orchestrator.ts init --profile <strict|balanced|fast> [--run-id <id>]
npx tsx src/orchestrator.ts status
npx tsx src/orchestrator.ts transition --to-phase <phase>
npx tsx src/orchestrator.ts checkpoint --approved <true|false> --reason "<text>"
npx tsx src/orchestrator.ts rollback --reason "<text>"
npx tsx src/orchestrator.ts compress --phase <phase> --tokens-used <n>
npx tsx src/orchestrator.ts finalize --status <completed|failed>

# Help
npx tsx src/index.ts
```

## Architecture

### Pipeline and Agents

Five agents map to the pipeline:

| Agent | Phase |
|---|---|
| OrchestratorAgent | cross-phase controller |
| ResearchAgent | Research |
| PlannerAgent | Plan |
| ImplementerAgent | Implement |
| ValidatorAgent | Validate |

The orchestrator is a **thin controller** — it manages transitions, checkpoints, memory persistence, and token policies. It does not do domain work.

### Phase Transition Protocol (mandatory for every transition)

1. Summarize phase outcomes
2. Persist summary, state, risks, and unresolved decisions
3. Clear active context
4. Reload minimal next-phase context pack
5. Request human checkpoint approval

If approval is denied or next-phase init fails → **rollback**: restore previous `run-state.json`, phase summary, decision set, and task batch pointer; set `run.status = blocked`.

### Memory System

All memory artifacts live under `memory/`. Hybrid JSON + Markdown:

- `run-state.json` — authoritative execution state (schema-validated on every write)
- `phase-summary.json` + `phase-summary.md` — phase outcomes
- `decision-log.json` — decisions and risks
- `task-state.json` — task tracking
- `retrieval-index.json` — artifact index used to build minimal context packs per phase

`retrieval-index.json` fields per entry: `id`, `artifact_path`, `run_id`, `phase`, `task_ids`, `tags`, `created_at`, `updated_at`, `confidence`, `relevance_score`, `token_weight`, `dependencies`, `status`.

Retrieval behavior: filter by `phase` + `task_ids` + `status=active`, rank by `relevance_score` + recency, load until token budget threshold. Always include unresolved risks and latest approved decisions.

### Token Policies

| Threshold | Action |
|---|---|
| ~40% | warning |
| ~60% | compress: generate micro-summary, persist incremental memory, trim stale context |
| ~80% | emergency reduction |

Batch sizes adapt under budget pressure.

### Confidence and Relevance Scoring

- `confidence` is set by the **artifact-producing agent** using the shared rubric:
  - `high` — verified by direct evidence or deterministic checks
  - `medium` — partially verified, minor assumptions remain
  - `low` — inferred or incomplete evidence
- `relevance_score` is computed and written by the **Orchestrator** (not individual agents) during index updates.

### Validation Profiles

Three profiles control ValidatorAgent gate behavior:

- `strict` — all required checks must pass
- `balanced` — allow pass with explicit risk report *(default)*
- `fast` — reduced checks with documented risks

Final recommendation is one of: `pass`, `pass_with_risks`, `fail`.

### MCP Connector Scope by Phase

| Phase | Connectors |
|---|---|
| Research | filesystem, git, github, context7, google stitch |
| Plan | filesystem + selected references only |
| Implement | filesystem, git, github |
| Validate | filesystem, git, github + relevant evidence sources |

Connector failure policy: classify error → log to run events → no automatic retries (human checkpoint policy). If non-critical, degrade gracefully and mark findings with reduced confidence. If critical, stop phase and trigger human checkpoint.

### Improvement Loop

Each run produces `run-retrospective.json` + `run-retrospective.md`. Weekly synthesis aggregates across runs into `weekly-synthesis.json` + `weekly-synthesis.md` and proposes `approved_actions`. Phase 9 (post-v1) adds governance: human approval → deployment flow → `improvement-deployment.json`.

## Planned Folder Structure

```
agents/       # Agent contract definitions
memory/
  schema/     # JSON schemas (run-state.schema.json, etc.)
configs/      # Global config + profile configs (strict, balanced, fast)
skills/       # Reusable skills (summarize_phase, compress_context, planning, validate_gate)
templates/    # Prompt templates per phase + human checkpoint prompt
runs/         # Per-run artifacts (run-state, phase summaries, retrospectives)
eval/         # Weekly synthesis and improvement artifacts
```

## JSON Schemas Required

All writes to `run-state.json` must pass schema validation before writing. Phase transitions must validate both state and phase summary schemas before advancing. Schemas live in `memory/schema/`.

Required schemas: `run-state`, `phase-summary`, `decision-log`, `task-state`, `retrieval-index`.

Required improvement schemas: `run-retrospective`, `weekly-synthesis`, `improvement-deployment`.
