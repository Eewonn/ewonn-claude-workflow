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
npx tsx src/orchestrator.ts list
npx tsx src/orchestrator.ts abort [--reason "<text>"]

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

All memory artifacts for a run live under `runs/<run-id>/`. Schemas and templates live under `memory/`. Hybrid JSON + Markdown:

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

## Folder Structure

```
src/              TypeScript CLIs (orchestrator, validator, token-budget, memory store/retrieval)
agents/           Agent contract definitions (.md)
templates/        Prompt templates per phase + human checkpoint prompt
skills/           workflow.md — main Claude Code skill (9 subcommands)
memory/
  schema/         8 JSON schemas (run-state, phase-summary, decision-log, etc.)
  templates/      Empty starter artifacts (copied into run dir at init)
configs/          global.json + profiles/ (strict, balanced, fast)
runs/             Per-run artifact directories (created at runtime)
  current         Symlink → active run directory (updated by `init`)
  <run-id>/       run-state.json, phase summaries, decision-log, snapshots/, etc.
eval/             Retrospectives and weekly synthesis outputs
.claude/
  agents/         5 spawnable Claude Code agent files
  settings.json   Hooks: Stop (auto-status) + PostToolUse Write (auto-validate)
```

## Claude Code Integration

- **Agents**: `.claude/agents/` — 5 agent files spawnable by Claude Code (`orchestrator`, `research`, `planner`, `implementer`, `validator`). Each embeds inline rules and references its source contract in `agents/`.
- **Stop hook**: After every Claude response, if `runs/current` symlink exists, auto-runs `orchestrator.ts status` to show live run state.
- **PostToolUse Write hook**: When any known JSON artifact is written, auto-validates against its schema. Exit code 2 on failure blocks the write and notifies Claude.
- **`/workflow` skill**: Global skill at `~/.claude/skills/workflow/SKILL.md`. Subcommands: `start`, `transition`, `status`, `list`, `compress`, `checkpoint`, `validate`, `abort`, `retrospective`, `weekly-synthesis`.
- **`runs/current`**: Symlink to the active run directory. Created by `init`, used by all commands that omit `--run-dir`. Allows `/workflow status` to work across sessions without remembering the run ID.
