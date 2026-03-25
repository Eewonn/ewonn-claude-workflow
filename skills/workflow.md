# Workflow Orchestration Skill

Enforce the Research → Plan → Implement → Validate pipeline with persistent memory, human gates, and token budget management.

## Usage

```
/workflow <subcommand> [arguments]
```

---

## Subcommands

### `/workflow start [--profile <p>] [--run-id <id>]`

Begins a new workflow run.

1. Determine profile (default: `balanced`). Valid: `strict`, `balanced`, `fast`.
2. Run:
   ```bash
   npx tsx src/orchestrator.ts init --profile <profile> [--run-id <id>]
   ```
3. Read `agents/research-agent.md` to load ResearchAgent contract.
4. Read `templates/research-prompt.md` and fill in: `run_id`, `profile`, `task_scope` (describe the task), `prior_phase_summary: none`.
5. Set run status to `running` in `run-state.json` (update manually or via orchestrator).
6. Execute research phase following the ResearchAgent contract.
7. When research is complete, run `/workflow transition --to plan`.

---

### `/workflow transition --to <phase>`

Enforces the 5-step transition protocol before advancing to the next phase.

**Phase must be one of:** `plan`, `implement`, `validate`

**5-step transition protocol (mandatory — do not skip any step):**

1. **Summarize** — Ensure `phase-summary-<current_phase>.json` is written and validated:
   ```bash
   npx tsx src/validator.ts phase-summary <run-dir>/phase-summary-<phase>.json
   ```

2. **Persist** — Ensure `run-state.json`, `decision-log.json`, and `task-state.json` are written and validated.

3. **Signal transition** — Run:
   ```bash
   npx tsx src/orchestrator.ts transition --to-phase <phase>
   ```
   This sets status to `checkpoint_pending` and creates a snapshot.

4. **Clear active context** — Do not carry forward the current phase's working context. Only load the retrieval context pack for the new phase.

5. **Human checkpoint** — Present `templates/human-checkpoint-prompt.md` filled with:
   - `run_id`, `phase_completed`, `verdict` (from phase summary), `open_risks_count`, `key_outcomes_list`, `next_phase`

   Wait for human to respond with `APPROVE: <reason>` or `DENY: <reason>`, then run:
   ```bash
   npx tsx src/orchestrator.ts checkpoint --approved <true|false> --reason "<reason>"
   ```

**On APPROVE:** Load the next phase's agent contract and prompt template. Reload minimal context pack (see Memory Artifact Reference). Begin the next phase.

**On DENY:** The orchestrator triggers rollback automatically. Run status becomes `blocked`. Read `rollback-report.json` and report to user.

---

### `/workflow status`

Display current run state.

```bash
npx tsx src/orchestrator.ts status
```

Also show the current token budget status:
```bash
npx tsx src/orchestrator.ts status [--run-dir <dir>]
```

---

### `/workflow compress`

Triggered when phase token usage reaches ~60% of `phase_max`.

1. Generate a micro-summary of the current phase's working context. Write it to:
   ```
   <run-dir>/micro-summary-<phase>-<timestamp>.md
   ```
   The micro-summary must capture the essential state: what has been done, what decisions were made, what remains.

2. Run:
   ```bash
   npx tsx src/orchestrator.ts compress --phase <current_phase> --tokens-used <n>
   ```
   Note: The orchestrator checks that the micro-summary file exists before updating state. It will exit with an error if the file is missing — generate the micro-summary first.

3. Discard stale context. Continue with only:
   - The micro-summary
   - Active task scope
   - Unresolved risks and decisions
   - Profile gate rules

---

### `/workflow checkpoint --approved <true|false> --reason "<text>"`

Process a human checkpoint decision.

```bash
npx tsx src/orchestrator.ts checkpoint --approved <true|false> --reason "<text>"
```

- **approved=true**: Orchestrator advances to next phase, sets `status=running`.
- **approved=false**: Orchestrator triggers rollback, sets `status=blocked`.

---

### `/workflow validate`

Run schema validation against all current run artifacts.

```bash
npx tsx src/validator.ts run-state <run-dir>/run-state.json
npx tsx src/validator.ts phase-summary <run-dir>/phase-summary-research.json
npx tsx src/validator.ts phase-summary <run-dir>/phase-summary-plan.json
npx tsx src/validator.ts phase-summary <run-dir>/phase-summary-implement.json
npx tsx src/validator.ts phase-summary <run-dir>/phase-summary-validate.json
npx tsx src/validator.ts task-state <run-dir>/task-state.json
npx tsx src/validator.ts decision-log <run-dir>/decision-log.json
npx tsx src/validator.ts retrieval-index <run-dir>/retrieval-index.json
```

Only validate files that exist. Report any schema violations. If violations are found, update `run-state.json` with the issues in `active_risks`.

---

### `/workflow retrospective`

Generate per-run improvement artifacts after run completion.

1. Read all phase summaries from the run directory.
2. Read `run-state.json` for final status, token usage, and checkpoint history.
3. Generate `run-retrospective.json` in `eval/`:
   - Validate before writing:
     ```bash
     npx tsx src/validator.ts run-retrospective eval/retro-<run-id>.json
     ```
4. Generate `eval/retro-<run-id>.md` (human-readable companion):
   - Executive summary
   - Top 3 blockers
   - Top 3 improvements for next run
   - Confidence note for recommendations

5. Finalize the run:
   ```bash
   npx tsx src/orchestrator.ts finalize --status completed
   ```

---

### `/workflow weekly-synthesis`

Aggregate retrospectives from `eval/` into a weekly synthesis report.

1. Scan `eval/` for all `retro-*.json` files not yet included in a synthesis.
2. Load global config for `weekly_synthesis.min_runs_required`.
3. If fewer runs than `min_runs_required` exist, report and stop.
4. Aggregate across all unprocessed retrospectives:
   - Cluster recurring blockers
   - Compare outcomes by profile
   - Identify token efficiency trends
   - Propose top prompt and skill changes
5. Generate `eval/weekly-synthesis-<window_start>.json`:
   - Validate before writing:
     ```bash
     npx tsx src/validator.ts weekly-synthesis eval/weekly-synthesis-<window_start>.json
     ```
6. Generate `eval/weekly-synthesis-<window_start>.md`:
   - Summary of trends
   - Decisions made
   - Rollout plan for approved_actions

---

## Phase Transition Protocol (Reference)

Every transition must complete all 5 steps in order:

| Step | Action | CLI |
|---|---|---|
| 1 | Summarize phase outcomes | Write + validate phase-summary JSON |
| 2 | Persist state, risks, decisions | Write + validate run-state, decision-log, task-state |
| 3 | Signal transition | `orchestrator.ts transition --to-phase <p>` |
| 4 | Clear active context | Discard working context; reload only minimal context pack |
| 5 | Human checkpoint | Present checkpoint prompt; run `orchestrator.ts checkpoint` |

**Never advance to the next phase without completing all 5 steps.**

---

## Token Budget Actions

| Threshold | % of phase_max | Required Action |
|---|---|---|
| warn | 40% | Emit `[TOKEN]` warning, continue |
| compress | 60% | Write micro-summary → run `/workflow compress` → trim context |
| emergency | 80% | Stop phase immediately → request human checkpoint before continuing |

Token limits by profile:
- `strict` / `balanced`: phase_max = 80,000, run_max = 320,000
- `fast`: phase_max = 40,000 (override in profile config)

Token estimates are approximate (character/4 heuristic in retrieval index).

---

## Error Handling: Connector Failures

| Error Class | Action |
|---|---|
| `auth` | Log to run events. Likely needs human fix. If critical → checkpoint. |
| `rate_limit` | Log. No auto-retry. If non-critical → continue with reduced confidence. |
| `timeout` | Log. Retry once manually. If still fails → degrade or checkpoint. |
| `missing_resource` | Log as gap. Continue with available evidence. |
| `unknown` | Log. Treat as critical if connector is in `critical_connectors_by_phase`. |

Critical connectors by phase (from `configs/global.json`):
- Research: none (all best-effort)
- Plan: filesystem
- Implement: filesystem, git
- Validate: filesystem

Failure response:
1. Classify the error
2. Log to `run-state.json → active_risks`
3. Add `connector_gaps` entry in current phase summary
4. If non-critical: mark affected findings `confidence: low`, continue
5. If critical: stop phase, trigger human checkpoint

---

## Memory Artifact Reference

| Artifact | Schema | Write Rule | Location |
|---|---|---|---|
| `run-state.json` | `run-state` | Every state change — validated on every write | `<run-dir>/` |
| `phase-summary-<phase>.json` | `phase-summary` | At phase completion — outcomes must be non-empty | `<run-dir>/` |
| `phase-summary-<phase>.md` | none | Companion markdown, write alongside JSON | `<run-dir>/` |
| `decision-log.json` | `decision-log` | When any decision is added or resolved | `<run-dir>/` |
| `task-state.json` | `task-state` | When tasks are created or updated | `<run-dir>/` |
| `retrieval-index.json` | `retrieval-index` | When artifacts are added; Orchestrator sets relevance_score | `<run-dir>/` |
| `run-retrospective.json` | `run-retrospective` | After run finalization | `eval/` |
| `weekly-synthesis.json` | `weekly-synthesis` | After weekly-synthesis subcommand | `eval/` |

All JSON artifacts are validated with `src/validator.ts` before writing.

---

## Confidence Rubric

This is the **authoritative** definition. All agent contracts reference this section.

| Level | Meaning |
|---|---|
| `high` | Verified by direct evidence or deterministic checks (e.g., read the file, ran the command, confirmed the output) |
| `medium` | Partially verified; minor assumptions remain (e.g., inferred from similar code patterns, partially read) |
| `low` | Inferred or incomplete evidence (e.g., connector failure prevented full verification, assumption not confirmed) |

**Assignment rules:**
- Phase agents (Research, Planner, Implementer, Validator) set `confidence` on every artifact they produce.
- The Orchestrator sets `relevance_score` using the formula in `src/memory/retrieval.ts`.
- Phase agents must never set `relevance_score`.

When a connector failure affects a finding: downgrade confidence by one level (high → medium, medium → low, low stays low).

---

## Context Pack Loading (Per-Phase Minimum)

At each phase start, load only:

1. Latest phase summary from the previous phase
2. Open risks and unresolved decisions (from `retrieval-index.json` entries tagged `risk` or `decision`)
3. Current task scope (from `task-state.json`)
4. Profile gate rules (from `configs/profiles/<profile>.json`)

Use `src/memory/retrieval.ts → queryIndex()` behavior: filter by phase + active status, rank by relevance_score, fill up to `preload_token_budget` (8,000 tokens default). Always prepend mandatory context (risks + decisions) up to `mandatory_context_token_limit` (2,000 tokens).

---

## Rollback Reference

Rollback is triggered by:
- `orchestrator.ts checkpoint --approved false`
- Direct call to `orchestrator.ts rollback --reason "<text>"`

What rollback does:
1. Sets `status = rollback_pending`
2. Finds most recent snapshot in `<run-dir>/snapshots/<phase>/`
3. Restores snapshot files to run directory
4. Sets `status = blocked`, writes `rollback_metadata` to `run-state.json`
5. Writes `rollback-report.json` with reason, failed step, and required action

After rollback, the run is `blocked`. Human must review the rollback report and either:
- Fix the issue and re-run the failed phase from the restored state
- Abandon the run and start fresh with `/workflow start`
