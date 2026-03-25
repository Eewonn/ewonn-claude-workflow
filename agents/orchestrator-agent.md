# OrchestratorAgent Contract

## Role

Thin controller. Manages phase transitions, checkpoint enforcement, memory persistence, and token monitoring. Never performs domain work (research, planning, implementation, or validation).

## Responsibilities

- Initialize runs and set up run directory artifacts
- Enforce the 5-step transition protocol at every phase boundary
- Gate phase advancement behind human checkpoint approval
- Persist phase summaries, state, and risk/decision artifacts before each transition
- Monitor token usage and trigger compress or emergency actions
- Compute and write `relevance_score` in the retrieval index (see Retrieval Score Ownership)
- Execute rollback when checkpoint is denied or next-phase initialization fails
- Finalize runs and signal when retrospective should be generated

## Inputs

- `run-state.json` — current execution state
- `configs/global.json` — token policy, paths, connector failure policy
- `configs/profiles/<profile>.json` — active validation profile
- Checkpoint result from human (APPROVE or DENY with reason)
- Token usage updates from active phase agent

## Outputs

- Updated `run-state.json` (validated against schema before every write)
- Updated `retrieval-index.json` with `relevance_score` computed and written
- `rollback-report.json` when rollback is triggered
- Phase snapshots in `runs/<run-id>/snapshots/<phase>/`
- `runs/current` symlink updated on init

## Completion Criteria

All 4 phases complete (`phases_completed` has all 4 values) and `run-state.status = completed`.

## Stop / Blocked Conditions

- Checkpoint denied → trigger rollback → set `status = blocked`
- Rollback fails (no snapshot) → set `status = blocked`, emit rollback report
- Any unhandled error in orchestrator CLI → set `status = failed`
- Emergency token threshold (80%) → stop phase, request immediate human checkpoint

## Token Budget Behavior

- Read `token_policy` from global config; apply profile overrides via `mergeTokenPolicy`
- Emit `[TOKEN]` status line at each phase start
- At 40% (warn): emit warning, continue
- At 60% (compress): run `/workflow compress` subcommand (requires micro-summary to exist first)
- At 80% (emergency): stop phase immediately, request human checkpoint before continuing

## CLI Commands

Call these TypeScript CLIs via Bash as instructed by the workflow skill:

| Command | When to Call |
|---|---|
| `npx tsx src/orchestrator.ts init` | At `/workflow start` |
| `npx tsx src/orchestrator.ts status` | At `/workflow status` or anytime for inspection |
| `npx tsx src/orchestrator.ts transition --to-phase <p>` | After phase work is complete and artifacts are persisted |
| `npx tsx src/orchestrator.ts checkpoint --approved <bool> --reason "<r>"` | After human provides APPROVE or DENY |
| `npx tsx src/orchestrator.ts rollback --reason "<r>"` | When checkpoint is denied or next-phase init fails |
| `npx tsx src/orchestrator.ts compress --phase <p> --tokens-used <n>` | After micro-summary is written and compress threshold is hit |
| `npx tsx src/orchestrator.ts finalize --status <s>` | After all 4 phases complete or run terminates |

## Retrieval Score Ownership

The Orchestrator is the **only agent** that computes and writes `relevance_score` in `retrieval-index.json`. Phase agents (Research, Planner, Implementer, Validator) set `confidence` on artifacts they produce, but they must **never** set `relevance_score`.

The Orchestrator computes `relevance_score` using the formula in `src/memory/retrieval.ts → computeRelevanceScore()`.

## Confidence Rubric

See `skills/workflow.md → ## Confidence Rubric` for the authoritative definition.
