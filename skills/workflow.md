# Workflow Orchestration Skill

Enforce Research → Plan → Implement → Validate with persistent memory, subagent optimization, and human checkpoint gates.

## MANDATORY RULES — enforce always, no shortcuts

1. **Init first.** Run `wf init` before any research, reads, or file changes. No exceptions.
2. **Haiku for file inventory.** Always spawn a Haiku agent to enumerate relevant files before reading them. Never guess or enumerate manually.
3. **Subagent threshold (hard rule).**
   - < 10 files, single subsystem → read directly, no subagents
   - ≥ 2 subsystems OR > 20 file reads → spawn `feature-dev:code-explorer` + `general-purpose` (git context) in parallel with `run_in_background: true`
4. **Hard stop at checkpoints.** After presenting a checkpoint block, take zero action — no reads, no writes, no tool calls — until the user explicitly types APPROVE or DENY.
5. **Write and validate before transitioning.** Never call `wf transition` without the phase-summary JSON written and schema-validated first.
6. **Always pass `--run-dir` after init.** After `wf init`, capture the run directory path from the init output and store it in a variable for the session:
   ```
   # Init output contains:  run_dir: /abs/path/to/.workflow/<run-id>
   # Store it immediately:
   RUN_DIR="/abs/path/to/.workflow/<run-id>"
   ```
   Pass `--run-dir $RUN_DIR` to every subsequent `wf` command: `transition`, `checkpoint`, `replan`, `compress`, `finalize`, `validate`. Never rely on the `runs/current` symlink — it lives in the workflow project, not in the target project's directory.

---

## CLI — `wf` (works from any directory)

```bash
wf init --profile <micro|balanced|strict|fast> --run-dir "$PWD/.workflow"
wf status [--run-dir <path>]
wf transition --to-phase <plan|implement|validate> [--run-dir <path>]
wf checkpoint --approved <true|false> --reason "<text>" [--run-dir <path>]
wf compress --phase <phase> --tokens-used <n> [--run-dir <path>]
wf finalize --status <completed|failed> [--run-dir <path>]
wf replan --phase <research|plan|implement|validate> [--run-dir <path>]
wf list
wf abort [--reason "<text>"]
wf validate <schema> <file>
```

**Always pass `--run-dir "$PWD/.workflow"` to `init`.** This puts run artifacts in the target project, not the workflow project. Add `.workflow/` to the project's `.gitignore` if it isn't already.

---

## /workflow start [--mode <mode>]

### Step 0 — Mode selection (skip if --mode already provided)

Ask: "What's the task?" then:

| Signal | Mode |
|---|---|
| Single file, < 15 min, no design decisions | `quick` |
| Known bug, 1–3 files | `bugfix` |
| Small feature, ≤ 5 files, clear scope | `lite` |
| Multi-file, uncertain scope, or design decisions needed | `full` |

State the recommendation and wait for confirmation before proceeding.

---

### `quick` mode — no run directory, no artifacts

1. Read relevant files directly.
2. Make the changes.
3. Summarize in 3–5 bullets: what changed, why, any caveats.
4. Offer to commit.

**Escalate** to `lite` or `full` if scope expands beyond 3 files or a design decision appears.

---

### `bugfix` mode — Implement → Validate

1. `wf init --profile micro --run-dir "$PWD/.workflow"`
2. Fix the bug.
3. Write `$PWD/.workflow/<run-id>/phase-summary-implement.json` → validate → transition → validate phase → finalize.

---

### `lite` mode — Research+Plan combined → Implement → Validate

1. `wf init --profile micro --run-dir "$PWD/.workflow"`
2. Spawn `research-planner` agent: Haiku inventory → focused reads → ≤5-task plan in one pass.
   - Produces `phase-summary-plan.json` + `task-state.json`
   - If scope exceeds 5 tasks or 10 files, escalate to `full`
3. **CHECKPOINT** (research+plan → implement)
4. Implement tasks.
5. **CHECKPOINT** (implement → validate)
6. Validate. Finalize.

---

### `full` mode — Research → Plan → Implement → Validate

1. `wf init --profile balanced --run-dir "$PWD/.workflow"`
2. Apply subagent threshold rule (MANDATORY RULE 3) to determine dispatch strategy.
3. Execute research. Write `phase-summary-research.json` → validate.
4. **CHECKPOINT** (research → plan)
5. Planner agent: produce `phase-summary-plan.json` + `task-state.json` → validate.
6. **CHECKPOINT** (plan → implement)
7. Implementer: execute tasks batch-by-batch. Write `phase-summary-implement.json` → validate.
8. **CHECKPOINT** (implement → validate)
9. Validator: produce final verdict. Write `phase-summary-validate.json` → validate.
10. **CHECKPOINT** (validate → done) → finalize.

---

## Checkpoint Protocol — HARD STOP

At every phase transition:

1. Write phase-summary JSON: `wf validate phase-summary <run-dir>/phase-summary-<phase>.json`
2. Persist state: ensure `run-state.json`, `decision-log.json`, `task-state.json` are written and validated.
3. Signal transition: `wf transition --to-phase <next>`
4. Present this block:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CHECKPOINT: <current_phase> complete
Run: <run_id>
Next phase: <next_phase>
Key outcomes: <bullet list>
Open risks: <count>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reply APPROVE or DENY (with a reason).
```

5. **STOP. Take no action until the user replies.**
6. On APPROVE: `wf checkpoint --approved true --reason "<reason>"` → load next phase context → proceed.
7. On DENY: `wf checkpoint --approved false --reason "<reason>"` → read rollback-report.json → report to user.

---

## Token Budget

| Threshold | Action |
|---|---|
| 40% of phase_max | Warn `[TOKEN 40%]`, continue |
| 60% | Write micro-summary → `wf compress --phase <p> --tokens-used <n>` → trim context |
| 80% | STOP → present checkpoint before continuing |

---

## Session Resume

At `/workflow start`, first check if `$PWD/.workflow/current` exists:
- If yes: run `wf status` and ask the user whether to resume or start fresh.
- If no: proceed with mode selection.

---

## Phase Summary JSON — Required Shape

When writing any `phase-summary-<phase>.json`, it **must** match this structure exactly. No extra fields allowed (`additionalProperties: false`).

```json
{
  "summary_id": "<phase>-<run-id>",
  "run_id": "<run-id>",
  "phase": "research|plan|implement|validate",
  "status": "completed|blocked|failed",
  "created_at": "2026-01-01T00:00:00.000Z",
  "outcomes": ["at least one string"],
  "open_risks": [
    { "id": "R1", "description": "...", "severity": "high|medium|low" }
  ],
  "unresolved_decisions": [
    { "id": "D1", "description": "...", "options": ["opt1", "opt2"] }
  ],
  "connector_gaps": [
    { "connector": "...", "operation": "...", "error_class": "auth|rate_limit|timeout|missing_resource|unknown", "affected_findings": "..." }
  ],
  "token_summary": {
    "tokens_used": 12345,
    "peak_threshold_hit": null
  }
}
```

`open_risks`, `unresolved_decisions`, `connector_gaps` must be arrays of objects — not strings. Use `[]` for empty arrays. `peak_threshold_hit` is `null` or one of `"warn"`, `"compress"`, `"emergency"`.

---

## Other subcommands

**`/workflow status`** — `wf status`

**`/workflow abort`** — `wf abort --reason "<reason>"`

**`wf replan --phase <phase>`** — After a DENY/rollback sets `status=blocked`, resets state to `checkpoint_pending` targeting the given phase. Allows re-entering the checkpoint flow without manually editing `run-state.json`. Follow with `wf checkpoint --approved true --reason "<reason>"` once a revised plan is ready.

**`/workflow list`** — `wf list`

**`/workflow retrospective`** — Read all phase summaries → write `eval/retro-<run-id>.json` + `.md` → `wf finalize --status completed`

**`/workflow weekly-synthesis`** — Aggregate `eval/retro-*.json` files → write `eval/weekly-synthesis-<date>.json` + `.md`
