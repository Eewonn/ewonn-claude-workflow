# ewonn-claude-workflow

A hybrid AI workflow orchestration system for Claude Code that enforces a structured pipeline on complex multi-step tasks.

```
Research → Plan → Implement → Validate
```

Every run has persistent memory, human approval gates between phases, automatic token budget management, and an improvement loop that generates feedback after each run.

---

## How it works

This system is **hybrid** — two layers working together:

- **TypeScript CLIs** (`src/`) handle the mechanical layer: state machine, JSON schema validation, memory artifact R/W, retrieval index, token tracking. Claude calls these via Bash.
- **Markdown files** (`skills/`, `agents/`, `templates/`) handle the guidance layer: what Claude reads to know what to do, what to produce, and when to stop.

Claude never delegates reasoning to TypeScript. TypeScript only validates and persists.

---

## Prerequisites

- Node.js v22+
- npm

```bash
npm install
```

---

## Quick Start

Start a new workflow run from within a Claude Code session:

```
/workflow start
```

Claude will initialize the run, begin the Research phase, and guide you through the pipeline. At the end of each phase, Claude presents a checkpoint summary and waits for your approval before advancing.

---

## The Pipeline

### Phases

| Phase | Agent | What happens |
|---|---|---|
| **Research** | ResearchAgent | Gathers evidence from code, git history, docs, and external sources. Documents findings with confidence levels. |
| **Plan** | PlannerAgent | Translates research into a sequenced task list with dependencies and batch assignments. |
| **Implement** | ImplementerAgent | Executes tasks batch-by-batch, committing changes, updating task state after each batch. |
| **Validate** | ValidatorAgent | Checks the implementation against the plan using the active profile. Produces a verdict. |

### Phase Transitions

Between every phase:

1. Phase summary is written and schema-validated
2. State, risks, and decisions are persisted
3. Active context is cleared
4. A minimal context pack is loaded for the next phase
5. **Human checkpoint** — you approve or deny before Claude continues

Deny a checkpoint and the run rolls back to the last approved snapshot.

### Validation Verdicts

The Validate phase produces one of three verdicts:

| Verdict | Meaning |
|---|---|
| `pass` | All checks passed, no open risks |
| `pass_with_risks` | Open risks remain but are within profile tolerance |
| `fail` | Checks failed or risks exceed profile limits |

---

## Workflow Skill Reference

Invoke these from a Claude Code session.

### `/workflow start [--profile <p>] [--run-id <id>]`

Starts a new run. Creates the run directory, initializes all memory artifacts, and begins the Research phase.

- `--profile`: `strict`, `balanced` (default), or `fast`
- `--run-id`: optional; auto-generated as `YYYYMMDD-HHmmss-{6hex}` if omitted

**What Claude does:**
1. Runs `npx tsx src/orchestrator.ts init --profile <p>`
2. Reads `agents/research-agent.md` and `templates/research-prompt.md`
3. Executes the Research phase
4. Calls `/workflow transition --to plan` when research is complete

---

### `/workflow transition --to <phase>`

Enforces the 5-step transition protocol and presents a human checkpoint.

**Steps (mandatory, in order):**
1. Write and validate `phase-summary-<phase>.json`
2. Persist `run-state.json`, `decision-log.json`, `task-state.json`
3. Run `orchestrator.ts transition --to-phase <phase>` (snapshots current phase, sets status to `checkpoint_pending`)
4. Clear active context
5. Present the checkpoint prompt — wait for your `APPROVE` or `DENY`

**On APPROVE:** Loads the next phase's context pack and begins the next phase.

**On DENY:** Triggers rollback. State is restored to the last snapshot. Run is set to `blocked`.

---

### `/workflow status`

Displays current run state: run_id, status, profile, current phase, phases completed, token usage, active risks, unresolved decisions, and retrieval index entry counts.

---

### `/workflow compress`

Triggered automatically when phase token usage reaches ~60% of `phase_max`.

1. Claude generates a micro-summary of the current phase's working context
2. Writes it to `<run-dir>/micro-summary-<phase>-<timestamp>.md`
3. Runs `orchestrator.ts compress` (checks for the micro-summary file first)
4. Stale retrieval index entries are marked `superseded`
5. Claude continues with trimmed context

---

### `/workflow checkpoint --approved <true|false> --reason "<text>"`

Processes your checkpoint decision programmatically (used when you respond to the checkpoint prompt).

---

### `/workflow validate`

Schema-validates all current run artifacts on demand. Run this before a transition if you want to verify state integrity.

---

### `/workflow retrospective`

Generates per-run improvement artifacts after the run is complete.

Produces two files in `eval/`:
- `retro-<run-id>.json` — machine-parseable structured feedback
- `retro-<run-id>.md` — human-readable: executive summary, top 3 blockers, top 3 improvements

---

### `/workflow list`

List all runs with their profile, status, and completed phases.

```
/workflow list
```

---

### `/workflow abort [--reason "<text>"]`

Cancel an in-progress run immediately without going through the full checkpoint flow. Sets the run to `failed` and preserves all data for inspection.

```
/workflow abort --reason "task changed direction"
```

Use this when you want to abandon a run mid-flight. Start fresh afterward with `/workflow start`.

---

### `/workflow weekly-synthesis`

Aggregates all unprocessed retrospectives in `eval/` into a weekly synthesis report.

Produces:
- `eval/weekly-synthesis-<date>.json` — profile comparison, blocker clusters, token efficiency trends, proposed changes
- `eval/weekly-synthesis-<date>.md` — trend summary, decisions, rollout plan

Triggered manually. Requires at least 1 retrospective (configurable).

---

## Orchestrator CLI Reference

These TypeScript CLIs are called by Claude via Bash during skill execution. You can also run them directly for inspection or recovery.

```bash
# Initialize a new run
npx tsx src/orchestrator.ts init --profile balanced

# Check current run status
npx tsx src/orchestrator.ts status

# Signal phase transition (creates snapshot, sets checkpoint_pending)
npx tsx src/orchestrator.ts transition --to-phase plan

# Process checkpoint decision
npx tsx src/orchestrator.ts checkpoint --approved true --reason "looks good"

# Trigger rollback manually
npx tsx src/orchestrator.ts rollback --reason "plan was incomplete"

# Record compression event (micro-summary must exist first)
npx tsx src/orchestrator.ts compress --phase research --tokens-used 48000

# List all runs
npx tsx src/orchestrator.ts list

# Cancel an in-progress run
npx tsx src/orchestrator.ts abort --reason "task changed"

# Finalize a run
npx tsx src/orchestrator.ts finalize --status completed
```

All commands default to `runs/current` when `--run-dir` is not specified. `init` updates the `runs/current` symlink automatically.

---

## Validator CLI Reference

Validate any JSON artifact against its schema:

```bash
npx tsx src/validator.ts <schema-name> <file-path>
```

**Exit codes:**
- `0` — valid
- `1` — schema validation failed
- `2` — usage error (wrong args, file not found)
- `3` — semantic validation failed (e.g., `resolved_at` missing on resolved decision)

**Available schemas:**

| Schema name | File |
|---|---|
| `run-state` | `runs/<id>/run-state.json` |
| `phase-summary` | `runs/<id>/phase-summary-<phase>.json` |
| `decision-log` | `runs/<id>/decision-log.json` |
| `task-state` | `runs/<id>/task-state.json` |
| `retrieval-index` | `runs/<id>/retrieval-index.json` |
| `run-retrospective` | `eval/retro-<id>.json` |
| `weekly-synthesis` | `eval/weekly-synthesis-<date>.json` |
| `improvement-deployment` | *(Phase 9, post-v1)* |

---

## Validation Profiles

Select a profile at run start: `/workflow start --profile strict`

| | strict | balanced (default) | fast |
|---|---|---|---|
| Pass with open risks | No | Yes (≤3 risks) | Yes (≤10 risks) |
| All checks required | Yes | Yes | No |
| Max unresolved decisions | 0 | 2 | 5 |
| Phase token max | 80k | 80k | 40k |
| Batch size factor | 1.0× | 1.0× | 1.5× |
| Remote connectors | All | All | Filesystem only |

**When to use each:**

- `strict` — production changes, anything requiring zero open issues at handoff
- `balanced` — normal development work, the safe default
- `fast` — quick explorations, prototypes, or when you need rapid iteration and will accept documented risks

---

## Token Budget

Token usage is tracked per-phase and per-run. Thresholds:

| Level | % of phase max | Action |
|---|---|---|
| warn | 40% | `[TOKEN]` warning logged, continue |
| compress | 60% | Generate micro-summary → compress → trim context |
| emergency | 80% | Stop phase, request human checkpoint before continuing |

**Default limits** (balanced/strict profiles):
- Per-phase: 80,000 tokens
- Per-run: 320,000 tokens

**Fast profile limits:**
- Per-phase: 40,000 tokens (same run_max)

Token counts in the retrieval index use a character/4 heuristic. Claude's actual consumption may differ slightly.

---

## Memory System

Every run gets its own directory under `runs/<run-id>/` containing:

```
runs/<run-id>/
  run-state.json              Current execution state (validated on every write)
  phase-summary-research.json
  phase-summary-research.md
  phase-summary-plan.json
  phase-summary-plan.md
  phase-summary-implement.json
  phase-summary-implement.md
  phase-summary-validate.json
  phase-summary-validate.md
  decision-log.json
  task-state.json
  retrieval-index.json
  micro-summary-<phase>-<ts>.md   (created during compress events)
  rollback-report.json             (created if rollback is triggered)
  snapshots/
    research/    (snapshot created before transition from research)
    plan/
    implement/
```

### Context Pack Loading

At each phase start, Claude loads only a minimal context pack:

1. Mandatory context (always included, up to 2,000 tokens): open risks + unresolved decisions
2. Ranked entries from the retrieval index (filtered by phase, sorted by relevance score, filled up to 8,000 tokens)

**Relevance score formula:**
```
score = min(1.0, confidence_weight × recency_factor × phase_match_bonus)

confidence_weight:  high=1.0, medium=0.65, low=0.3
recency_factor:     1 / (1 + age_in_hours / 24)
phase_match_bonus:  1.2 if same phase, 1.0 otherwise
```

`confidence` is set by the agent that produces the artifact. `relevance_score` is computed and written by the OrchestratorAgent only.

---

## MCP Connectors

Connector scope by phase:

| Phase | Connectors | All critical? |
|---|---|---|
| Research | filesystem, git, github, context7, google-stitch | filesystem critical |
| Plan | filesystem | Yes (filesystem critical) |
| Implement | filesystem, git, github | filesystem and git critical |
| Validate | filesystem, git, github | filesystem critical |

**Connector failure response:**

1. Classify: `auth | rate_limit | timeout | missing_resource | unknown`
2. Log to `run-state.json → active_risks` and `phase-summary.connector_gaps`
3. No automatic retries
4. Non-critical failure: mark affected findings `confidence: low`, continue
5. Critical failure: stop phase, trigger human checkpoint

Google Stitch (AI frontend design tool) is best-effort in Research — its absence never blocks any phase.

---

## Rollback

Rollback is triggered when:
- You deny a checkpoint (`DENY: <reason>`)
- `orchestrator.ts rollback --reason "<text>"` is called directly

**What happens:**
1. `run-state.status` → `rollback_pending`
2. Most recent snapshot in `runs/<id>/snapshots/` is found
3. Snapshot files are restored to run directory
4. `run-state.status` → `blocked`, `rollback_metadata` written
5. `rollback-report.json` written with reason, failed step, and required action

**After rollback:**
The run is `blocked`. Review `rollback-report.json`, fix the issue, then re-run the failed phase from the restored state. Or start fresh with `/workflow start`.

Snapshots are written atomically (temp directory → rename) before each transition to prevent partial snapshot corruption.

---

## Improvement Loop

After each run completes:

```
/workflow retrospective
```

After several runs:

```
/workflow weekly-synthesis
```

The weekly synthesis compares profile outcomes, clusters recurring blockers, tracks token efficiency trends over time, and proposes changes to configs, prompts, and skills. Proposed changes appear in `approved_actions` in `weekly-synthesis.json` and await your review before being applied (Phase 9, post-v1).

---

## File Structure

```
src/
  types.ts              Shared TypeScript interfaces and union types
  orchestrator.ts       State machine CLI (9 commands)
  validator.ts          AJV schema validator CLI + module
  token-budget.ts       Token threshold utilities
  index.ts              Help output
  memory/
    store.ts            Artifact read/write with schema validation gate
    retrieval.ts        Relevance scoring and context pack assembly

memory/
  schema/               8 JSON schema files
  templates/            Empty starter artifacts (copied at init)

configs/
  global.json           Token policy, paths, connector policy
  profiles/
    strict.json
    balanced.json
    fast.json

agents/                 5 agent contract .md files
templates/              5 prompt template .md files
skills/
  workflow.md           Main Claude Code skill (8 subcommands)

runs/                   Per-run artifact directories (created at runtime)
eval/                   Retrospectives and weekly synthesis outputs
```

---

## Architecture Notes

**Why TypeScript for validation, not just Claude?**
Schema validation in TypeScript means every JSON write is checked against an exact contract before hitting disk. There is no "Claude forgot to include a field" scenario — the write throws and the artifact is never partially written.

**Why a single `workflow.md` skill instead of separate skills?**
One file means one place to update the transition protocol, one place that defines the confidence rubric, one place for the error handling table. The subcommand pattern keeps it cohesive and avoids drift between skill files.

**Why `runs/current` symlink?**
Workflow runs happen over multiple Claude sessions. The symlink means you can resume a run in a new session by running `/workflow status` without having to remember or pass the run ID.

**Why atomic snapshots?**
If a rollback occurs after a partial snapshot write, restoring from a corrupt snapshot would be worse than having no snapshot. The temp-dir → rename pattern ensures you either have the full previous state or nothing.

**Why not store token counts in Claude's actual token counter?**
The TypeScript CLIs have no access to Claude's internal token counter. The retrieval index uses a character/4 heuristic for planning purposes. Actual budget enforcement relies on Claude self-monitoring, with the CLI providing tracking assistance and triggering compress/emergency actions.
