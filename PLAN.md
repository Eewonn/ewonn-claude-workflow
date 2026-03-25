# Claude Code Workflow Plan

## Objective

Design and implement a reusable workflow system with this pipeline:

Research → Plan → Implement → Validate

This plan is implementation-ready for Claude Code and optimized for token and context efficiency.

## Constraints and Decisions

- Scope mode: multi-project and mixed workloads
- Source of truth: repository files only
- Gating: configurable profiles, default balanced
- Failure policy: immediate human checkpoint on any failure
- Context strategy: clear on every phase transition and at about 60% context usage
- Memory format: hybrid JSON + Markdown
- Memory modularity: per task, per phase, and decision/event logs
- MCP connectors for v1: filesystem, git, github, google stitch (best-effort), context7
- Implementation form: hybrid — TypeScript CLIs for the mechanical layer (state machine, schema validation, memory I/O), Markdown files for the guidance layer (skill, agent contracts, prompt templates)
- Claude never delegates reasoning to TypeScript — TypeScript only validates and persists

### Implementation Decisions (added during build)

- **Run ID format**: `YYYYMMDD-HHmmss-{6hex}` — human-readable, sortable, unique
- **Token budget defaults**: phase_max=80000, run_max=320000, warn=40%, compress=60%, emergency=80%
- **Fast profile overrides**: phase_max=40000, warn=50%, compress=70%
- **Single skill**: one `workflow.md` with subcommands (`start`, `transition`, `status`, `compress`, `checkpoint`, `validate`, `retrospective`, `weekly-synthesis`) rather than four separate skill files
- **`runs/current` symlink**: updated by `init` so subsequent subcommands don't need `--run-dir`
- **Google Stitch**: treated as best-effort in Research phase — no connector is critical during research; failures are logged as connector gaps with reduced confidence
- **Compress guard**: the `compress` CLI command checks that a micro-summary file exists before updating state — prevents state drift if Claude calls compress without first writing the summary
- **Snapshot atomicity**: snapshots write to `<phase>.tmp/` then atomically rename to `<phase>/` — protects rollback from partial writes
- **`relevance_score` formula**: `min(1.0, confidence_weight × recency_factor × phase_match_bonus)` where confidence_weight={high:1.0, medium:0.65, low:0.3}, recency_factor=1/(1+age_hours/24), phase_match_bonus=1.2 if phase matches else 1.0
- **Path handling**: all `import.meta.url` references use `fileURLToPath()` rather than `.pathname` to correctly handle spaces in directory paths

---

## Phase 0: Foundation Setup

### Deliverables

1. Base structure for workflows, agents, memory, skills, templates, configs, runs, eval.
2. Global workflow config and profile configs (strict, balanced, fast).
3. Shared schemas for all memory artifacts.

### Schema Requirements

- `run-state.json` must have an explicit JSON schema and validation rules.
- Path: `memory/schema/run-state.schema.json`.
- `run-state.json` writes are invalid unless schema validation passes.
- Phase transition checkpoints must validate both state and phase summary schemas before advancing.
- All schemas use `additionalProperties: false` to reject unknown fields.

### Schemas (8 total — improvement schemas scaffolded in Phase 0 so templates exist from the start)

| Schema | Path | Purpose |
|---|---|---|
| `run-state` | `memory/schema/run-state.schema.json` | Authoritative execution state; validated on every write |
| `phase-summary` | `memory/schema/phase-summary.schema.json` | Phase outcomes, risks, connector gaps |
| `decision-log` | `memory/schema/decision-log.schema.json` | Decisions and risks across a run |
| `task-state` | `memory/schema/task-state.schema.json` | Task list with batch tracking |
| `retrieval-index` | `memory/schema/retrieval-index.schema.json` | Artifact index for context pack assembly |
| `run-retrospective` | `memory/schema/run-retrospective.schema.json` | Per-run improvement artifact |
| `weekly-synthesis` | `memory/schema/weekly-synthesis.schema.json` | Weekly aggregate across runs |
| `improvement-deployment` | `memory/schema/improvement-deployment.schema.json` | Phase 9 deployment record (scaffolded, logic deferred) |

### `run-state.json` Key Fields

- `run_id`: pattern `^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$` (format: `YYYYMMDD-HHmmss-{6hex}`)
- `status`: enum of 7 values: `initializing | running | checkpoint_pending | rollback_pending | blocked | completed | failed`
- `current_phase`: `research | plan | implement | validate | null`
- `token_usage`: `{ phase_tokens, run_tokens, last_threshold_triggered }`
- `checkpoint_history`: append-only array of `{ phase, approved, timestamp, reason? }`
- `rollback_metadata`: nullable — set during rollback with reason, failed_step, restored_at

### Global Config (`configs/global.json`) Key Fields

```json
{
  "default_profile": "balanced",
  "token_policy": {
    "phase_max": 80000,
    "run_max": 320000,
    "warn_at": 0.40,
    "compress_at": 0.60,
    "emergency_at": 0.80
  },
  "retrieval": {
    "preload_token_budget": 8000,
    "mandatory_context_token_limit": 2000
  },
  "connector_failure_policy": {
    "auto_retry": false,
    "critical_connectors_by_phase": {
      "research": [],
      "plan": ["filesystem"],
      "implement": ["filesystem", "git"],
      "validate": ["filesystem"]
    }
  }
}
```

### Profile Configs (`configs/profiles/<name>.json`) Key Fields

Each profile defines: `verdict_rules`, `token_policy_overrides`, `batch_size_factor`, `connector_scope`.

| Profile | allow_pass_with_risks | require_all_checks | max_open_risks | batch_size_factor | connector_scope |
|---|---|---|---|---|---|
| strict | false | true | 0 | 1.0 | full |
| balanced | true | true | 3 | 1.0 | full |
| fast | true | false | 10 | 1.5 | reduced |

`connector_scope: reduced` = filesystem only (fast profile skips remote connectors).

### Acceptance Criteria

- Folder scaffold exists and is consistent.
- Config files parse and contain all required fields.
- `npx tsx src/validator.ts <schema> <file>` exits 0 for all valid template instances.

---

## Phase 1: Orchestration Layer

### Goal

Build a thin orchestrator CLI (`src/orchestrator.ts`) that controls phase transitions, checkpoints, memory persistence, and token policies. Claude invokes it via Bash.

### CLI Commands

```
npx tsx src/orchestrator.ts init       --profile <p> [--run-id <id>]
npx tsx src/orchestrator.ts status     [--run-dir <dir>]
npx tsx src/orchestrator.ts transition --to-phase <phase> [--run-dir <dir>]
npx tsx src/orchestrator.ts checkpoint --approved <bool> --reason "<text>" [--run-dir <dir>]
npx tsx src/orchestrator.ts rollback   --reason "<text>" [--run-dir <dir>]
npx tsx src/orchestrator.ts compress   --phase <p> --tokens-used <n> [--run-dir <dir>]
npx tsx src/orchestrator.ts finalize   --status <completed|failed> [--run-dir <dir>]
```

`--run-dir` defaults to `runs/current` symlink (created by `init`).

### Transition Protocol (Mandatory)

For each phase transition:

1. Summarize phase outcomes (write phase-summary JSON and validate it).
2. Persist summary, state, risks, and unresolved decision items.
3. Run `orchestrator.ts transition --to-phase <p>` (snapshots current phase, sets `checkpoint_pending`).
4. Clear active context.
5. Reload minimal next-phase context pack.
6. Present human checkpoint prompt.
7. Run `orchestrator.ts checkpoint --approved <bool> --reason "<r>"`.

### Checkpoint Recovery and Rollback Path

If checkpoint approval is denied, or if next-phase initialization fails after transition:

1. Mark transition status as `rollback_pending` in `run-state.json`.
2. Load previous phase snapshot from `runs/<run-id>/snapshots/<phase>/` (atomic copy, written before transition).
3. Restore: previous `run-state.json`, previous phase summary, decision set, task batch pointer.
4. Mark run status as `blocked` and write `rollback-report.json`.
5. Emit rollback report with reason, failed step, and required human action.

Rollback is mandatory for partial transitions to prevent split-brain state between phases.

### Acceptance Criteria

- Orchestrator enforces transition protocol for all four phases.
- Phase cannot advance without checkpoint result.
- Any failure routes directly to checkpoint or rollback.
- `runs/current` symlink is updated on init.

---

## Phase 2: Agent Contracts

### Agents

1. OrchestratorAgent (`agents/orchestrator-agent.md`)
2. ResearchAgent (`agents/research-agent.md`)
3. PlannerAgent (`agents/planner-agent.md`)
4. ImplementerAgent (`agents/implementer-agent.md`)
5. ValidatorAgent (`agents/validator-agent.md`)

### Contract Requirements

Each agent defines:

- responsibilities
- explicit inputs
- explicit outputs
- completion criteria
- stop/blocked conditions
- token-budget behavior
- MCP connector scope

### Retrieval Scoring Ownership

To avoid inconsistent indexing across agents:

- Artifact-producing agent sets `confidence` using the shared rubric (defined in `skills/workflow.md`).
- OrchestratorAgent computes and writes `relevance_score` during index updates — no other agent writes this field.

Confidence rubric:

- `high`: verified by direct evidence or deterministic checks
- `medium`: partially verified, minor assumptions remain
- `low`: inferred or incomplete evidence (also: downgrade one level when a connector gap affected the finding)

### Acceptance Criteria

- Every phase has one primary agent contract.
- Inputs and outputs are machine-trackable.
- Contracts include token-budget behavior.
- Confidence and relevance scoring are assigned consistently by contract.

---

## Phase 3: Memory System

### Memory Artifacts

| Artifact | Per | Format |
|---|---|---|
| `run-state.json` | run | JSON (schema-validated on every write) |
| `phase-summary-<phase>.json` | phase | JSON |
| `phase-summary-<phase>.md` | phase | Markdown companion |
| `decision-log.json` | run | JSON |
| `task-state.json` | run | JSON |
| `retrieval-index.json` | run | JSON |

### `retrieval-index.json` Entry Fields

- `id`, `artifact_path`, `run_id`, `phase`, `task_ids`, `tags`
- `created_at`, `updated_at`
- `confidence`: set by the artifact-producing agent
- `relevance_score`: set by OrchestratorAgent only, range 0–1
- `token_weight`: estimated token size (character/4 heuristic)
- `dependencies`: related decision IDs or artifact IDs
- `status`: `active | superseded | archived`

### Relevance Score Formula

```
confidence_weight = { high: 1.0, medium: 0.65, low: 0.3 }
recency_factor    = 1 / (1 + age_in_hours / 24)
phase_match_bonus = entry.phase === query.phase ? 1.2 : 1.0
relevance_score   = min(1.0, confidence_weight × recency_factor × phase_match_bonus)
```

### Retrieval Strategy

At phase start, load only:

1. Latest summary from previous phase
2. Open risks and unresolved decisions (prepended unconditionally, up to `mandatory_context_token_limit: 2000` tokens)
3. Current task scope
4. Profile gate rules

Ranked entries are accumulated by `token_weight` until `preload_token_budget: 8000` tokens is reached.

### Compression Strategy

Trigger at about 60% context usage:

1. Generate micro-summary — write to `<run-dir>/micro-summary-<phase>-<timestamp>.md`
2. Run `orchestrator.ts compress` (checks for micro-summary file; exits 1 if absent)
3. Mark stale index entries as `superseded`
4. Continue with active scope only

### Acceptance Criteria

- Memory persists at transitions and threshold events.
- Reload set is minimal and relevant.
- Artifacts are reusable across runs.
- `compress` command requires micro-summary to exist before updating state.

---

## Phase 4: Token Optimization

### Policies

| Threshold | % of max | Action |
|---|---|---|
| warn | 40% | Emit `[TOKEN]` warning, continue |
| compress | 60% | Write micro-summary → compress → trim context |
| emergency | 80% | Stop phase → human checkpoint required |

Hard maxima:
- `phase_max`: 80,000 tokens (40,000 for fast profile)
- `run_max`: 320,000 tokens

### Methods

- Adaptive batch sizing by profile `batch_size_factor` (1.5x for fast, 1.0x for strict/balanced)
- Prompt templates with strict output contracts
- Phase-scoped connector usage
- Compact summaries over full transcript carryover
- Retrieval-index-based context pack loading (never reload all prior context)

### Acceptance Criteria

- Token limits are configurable and enforced via profile config.
- Batch size adapts under budget pressure.
- Context growth is bounded across long runs.

---

## Phase 5: MCP Integration

### Connector Use by Phase

| Phase | Connectors | Critical |
|---|---|---|
| Research | filesystem, git, github, context7, google-stitch | none (all best-effort) |
| Plan | filesystem | filesystem |
| Implement | filesystem, git, github | filesystem, git |
| Validate | filesystem, git, github | filesystem |

`connector_scope: reduced` (fast profile) restricts all phases to filesystem only.

### Guardrails

- Avoid broad connector calls unless required
- Store fetched evidence references in memory artifacts
- Keep retrieval phase-specific

### MCP Connector Failure Handling

Failure policy for each connector call:

1. Classify error as `auth | rate_limit | timeout | missing_resource | unknown`.
2. Log to `run-state.json → active_risks` and `phase-summary.connector_gaps`.
3. No automatic retries (human checkpoint policy).
4. If non-critical: degrade gracefully, mark affected findings `confidence: low`, continue.
5. If critical: stop phase, trigger immediate human checkpoint.

Fallback behavior:

- Prefer filesystem cached artifacts when remote connector fails.
- Mark affected findings with reduced confidence.
- Add explicit `connector_gaps` entry in phase summary so Planner/Validator can account for missing evidence.

### Acceptance Criteria

- Connectors are scoped and auditable.
- Evidence references are persisted.
- Connector failures are classified, logged, and handled deterministically.
- Google Stitch is best-effort only; absence does not block any phase.

---

## Phase 6: Prompt and Skill Templates

### Prompt Templates (5 files in `templates/`)

1. `research-prompt.md`
2. `plan-prompt.md`
3. `implement-prompt.md`
4. `validate-prompt.md` — includes Profile Behavior section and explicit validator CLI instructions
5. `human-checkpoint-prompt.md` — response format: `APPROVE: <reason>` or `DENY: <reason>`

Each template defines: `## Context` (variables), `## Objective`, `## Output Contract`, `## Stop Conditions`.

### Skill (`skills/workflow.md`)

One skill with 8 subcommands:

| Subcommand | Purpose |
|---|---|
| `start` | Init run, load research template, begin Research phase |
| `transition` | Enforce 5-step transition protocol and human checkpoint |
| `status` | Display run state and token usage |
| `compress` | Generate micro-summary, trim context at 60% threshold |
| `checkpoint` | Process APPROVE/DENY decision |
| `validate` | Schema-validate all current run artifacts |
| `retrospective` | Generate per-run improvement artifacts |
| `weekly-synthesis` | Aggregate retrospectives into weekly synthesis |

The skill also defines: Phase Transition Protocol, Token Budget Actions table, Error Handling table, Memory Artifact Reference, Confidence Rubric.

### Acceptance Criteria

- Templates are concise and modular.
- Outputs match expected schemas.
- Skill subcommands cover the full run lifecycle.

---

## Phase 7: Validation Profiles

### Profiles

| Profile | allow_pass_with_risks | require_all_checks | max_open_risks | max_unresolved_decisions |
|---|---|---|---|---|
| strict | false | true | 0 | 0 |
| balanced | true | true | 3 | 2 |
| fast | true | false | 10 | 5 |

### Verdict Decision Logic

Applied in order by the ValidatorAgent:

1. If `require_all_checks=true` and any check was skipped → `fail`
2. If `open_risks > max_open_risks` → `fail`
3. If `unresolved_decisions > max_unresolved_decisions` → `fail`
4. If `open_risks > 0` and `allow_pass_with_risks=true` → `pass_with_risks`
5. Otherwise → `pass`

### Acceptance Criteria

- Profile selection changes validator behavior deterministically.
- Final recommendation is `pass`, `pass_with_risks`, or `fail`.
- Verdict is written as first entry in `phase-summary-validate.json → outcomes`.

---

## Phase 8: Improvement Loop

### Per-Run Outputs

`run-retrospective.json` required fields:

- `run_id`, `profile`, `final_status` (completed/blocked/failed)
- `phase_metrics` — tokens, duration, checkpoint count per phase (all 4 phases required)
- `failures` — normalized list with type, phase, severity (critical/major/minor), root_cause
- `blocked_reasons`, `successful_patterns`
- `prompt_issues` — ambiguity, verbosity, missing constraints
- `skill_gaps` — missing or weak reusable skills
- `recommended_changes` — target_type (config/prompt/skill/process), priority
- `created_at`

`run-retrospective.md` — executive summary, top 3 blockers, top 3 improvements, confidence note.

### Weekly Synthesis

Trigger: manual via `/workflow weekly-synthesis` (not automatic).
Minimum runs required: 1 (configurable in `configs/global.json → weekly_synthesis.min_runs_required`).

`weekly-synthesis.json` required fields:

- `synthesis_id`, `window_start`, `window_end`, `run_count`, `run_ids`
- `blocker_clusters` — recurring blockers with frequency and affected phases
- `profile_comparison` — per-profile: run_count, avg_tokens, avg_duration_seconds, pass_rate
- `token_efficiency_trends` — time series of avg_phase_tokens and compress_trigger_rate
- `top_prompt_changes`, `top_skill_changes`
- `expected_impact`
- `approved_actions` — type (config/prompt/skill/process), approved_by, approved_at

`weekly-synthesis.md` — summary of trends, decisions made, rollout plan.

### Acceptance Criteria

- Each run produces measurable feedback.
- Weekly synthesis generates actionable updates.
- Improvement artifacts are schema-backed and machine-parseable.

---

## Phase 9 (Post-v1): Improvement Governance and Deployment

### Goal

Define how `approved_actions` are reviewed, approved, applied to repository artifacts, and validated.

### Governance Model

1. Weekly synthesis proposes `approved_actions` candidates in `weekly-synthesis.json`.
2. Human reviewer role approves, rejects, or defers each candidate.
3. Approved actions are converted into tracked change tasks with owner and due date.

### Deployment Flow

1. Convert approved actions into concrete file change intents.
2. Apply changes to target artifacts: configs, prompt templates, skill definitions.
3. Run validation checks after application.
4. Persist deployment result in `improvement-deployment.json`.

### Output Contract (`improvement-deployment.json`)

- `actions_reviewed`, `actions_approved`, `actions_applied`, `actions_failed` (integers ≥ 0)
- Semantic constraint: `actions_applied + actions_failed ≤ actions_approved` (code-level check)
- `affected_files`, `validation_result` (pass/fail), `rollback_required`, `approver`, `applied_at`

Schema is scaffolded now (`memory/schema/improvement-deployment.schema.json`). Governance logic is deferred post-v1.

### Acceptance Criteria

- Approval ownership is explicit and auditable.
- Approved actions are applied through a deterministic path.
- Each applied change has validation evidence and rollback metadata.

---

## Lightweight Workflows

Not every task needs the full 4-phase pipeline. Two reduced workflows skip unnecessary phases and use tighter token budgets.

### Workflow Selection Guide

| Task type | Workflow | Profile |
|---|---|---|
| Bug fix (< ~30 min, known cause) | `bugfix` | `micro` |
| Small feature (1–3 files, clear scope) | `lite` | `micro` |
| Medium feature (multi-file, some uncertainty) | Full pipeline | `fast` |
| Large feature or new project | Full pipeline | `balanced` or `strict` |

Invoked via `/workflow start --mode bugfix` or `/workflow start --mode lite`.

---

### `bugfix` Workflow: Implement → Validate

Skips Research and Plan entirely. For bugs where the cause is already known or discoverable in under a few minutes of reading.

**Phases:** Implement → Validate

**Token budget (micro profile):**
- `phase_max`: 15,000 tokens
- `warn_at`: 50%, `compress_at`: 70%, `emergency_at`: 85%
- No compression step — at emergency threshold, stop and checkpoint immediately
- No retrieval preload — context is loaded manually by the ImplementerAgent

**Checkpoint gates:** one gate only, between Implement and Validate.

**Memory artifacts written:**
- `run-state.json` (always)
- `phase-summary-implement.json` — a short diff summary: files changed, root cause, fix applied
- `phase-summary-validate.json` — pass/fail verdict with evidence

No `decision-log.json`, no `task-state.json`, no `retrieval-index.json` — these are omitted to minimize overhead.

**Rollback:** if Validate fails, revert file changes (git checkout) and set `run.status = blocked`.

**Retrospective:** skipped by default. Run `/workflow retrospective` manually if the bug was non-trivial.

**Acceptance criteria:**
- Bug is fixed and Validate phase confirms it
- Total token cost stays under `phase_max × 2` (30,000 tokens)
- No unnecessary phases are invoked

---

### `lite` Workflow: Plan → Implement → Validate

Skips Research. For small features where scope is already clear and no external investigation is needed.

**Phases:** Plan → Implement → Validate

**Token budget (micro profile):**
- `phase_max`: 20,000 tokens per phase
- `warn_at`: 50%, `compress_at`: 70%, `emergency_at`: 85%
- Compression allowed in Implement phase only

**Checkpoint gates:** two gates — Plan → Implement, and Implement → Validate.

**Memory artifacts written:**
- `run-state.json` (always)
- `phase-summary-plan.json` — task list (max 5 tasks), files to touch, key decisions
- `task-state.json` — flat task list, no batch tracking needed at this scale
- `phase-summary-implement.json` — files changed, tasks completed
- `phase-summary-validate.json` — pass/fail verdict

No `retrieval-index.json` — retrieval ranking is skipped; PlannerAgent loads context directly.

**Plan phase constraint:** the plan must fit in a single response. If it cannot, the scope is too large for `lite` — upgrade to full pipeline with `fast` profile.

**Retrospective:** skipped by default.

**Acceptance criteria:**
- Feature is implemented per the plan
- Both checkpoint gates are recorded
- Total token cost stays under `phase_max × 3` (60,000 tokens)

---

### `micro` Profile Config (`configs/profiles/micro.json`)

```json
{
  "allow_pass_with_risks": true,
  "require_all_checks": false,
  "max_open_risks": 5,
  "max_unresolved_decisions": 3,
  "batch_size_factor": 2.0,
  "connector_scope": "local",
  "token_policy_overrides": {
    "phase_max": 15000,
    "warn_at": 0.50,
    "compress_at": 0.70,
    "emergency_at": 0.85
  }
}
```

`connector_scope: local` = filesystem only (no git remote, no GitHub, no context7).

---

## Implementation Order

Built in 8 dependency layers:

| Layer | Contents |
|---|---|
| 0 | `package.json`, `tsconfig.json` |
| 1 | `src/types.ts` — all shared TypeScript types |
| 2 | 8 JSON schemas in `memory/schema/` |
| 3 | Config files: `configs/global.json` + 3 profile configs |
| 4 | Memory templates in `memory/templates/` |
| 5 | TypeScript source: `src/memory/store.ts`, `src/memory/retrieval.ts`, `src/token-budget.ts`, `src/validator.ts`, `src/orchestrator.ts`, `src/index.ts` |
| 6 | Agent contracts: `agents/*.md` (5 files) |
| 7 | Prompt templates: `templates/*.md` (5 files) |
| 8 | Skill: `skills/workflow.md` |

---

## Definition of Done (v1)

1. End-to-end dry run succeeds across all four phases.
2. Context is cleared at every transition with persisted summaries.
3. Threshold-based compression triggers correctly at about 60%.
4. Human checkpoint is required and enforced.
5. Validation profiles operate as configured.
6. Per-run and weekly improvement artifacts are generated.
