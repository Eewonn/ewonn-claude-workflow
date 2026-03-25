# Workflow Cheatsheet

A practical guide to using this system in your daily work.

---

## Picking the right command

This is the most important decision. Match the command to the task size:

| Task | Command |
|---|---|
| Single-file fix, typo, quick edit | `/workflow quick` |
| Known bug, 1–3 files, cause already clear | `/workflow start --mode bugfix` |
| Small feature, 1–5 files, scope is clear | `/workflow start --mode lite` |
| Multi-file feature, uncertain scope | `/workflow start` |
| Large feature, production change | `/workflow start --profile strict` |

If you're unsure, just run `/workflow start` — Claude will assess the task and recommend a lighter mode if appropriate.

---

## Quick reference

```
/workflow quick                         Zero-ceremony: read → implement → summarize
/workflow start                         Full pipeline (balanced profile)
/workflow start --mode bugfix           Implement → Validate only (known bugs)
/workflow start --mode lite             Plan → Implement → Validate (small features)
/workflow start --profile fast          Full pipeline, lower token limits
/workflow status                        Show current run state
/workflow list                          Show all past runs
/workflow abort --reason "..."          Cancel in-progress run
/workflow validate                      Schema-check all current artifacts
/workflow retrospective                 Generate improvement report after run
/workflow weekly-synthesis              Aggregate reports across multiple runs
```

At a checkpoint, respond with:
```
APPROVE: <your reason>
DENY: <your reason>
```

---

## /workflow quick — for simple tasks

The fastest path. No phases, no checkpoints, no JSON artifacts.

```
/workflow quick
```

Claude will ask what the task is, read the relevant files, make the change, and give you a 3–5 bullet summary. That's it.

**Good for:** single-file fixes, renaming things, adding a prop, fixing a typo, quick explorations.

**Not for:** anything touching auth, database schema, or 3+ files — Claude will tell you to upgrade if it hits that mid-task.

---

## Step-by-step: A full run

### 1. Open Claude Code in your project

Navigate to the project you want to work on. This system works from any project directory — the skill is global.

### 2. Start a run

```
/workflow start
```

Claude will ask what the task is, then assess complexity before initializing. If it looks like a bugfix or small feature, it will say so and let you confirm or override.

**Example task scopes that work well:**
> "Add email verification to the signup flow — users should receive a confirmation email and can't log in until verified"

> "Refactor the data fetching layer to use React Query instead of manual useEffect/useState"

> "Investigate why the dashboard loads slowly for users with >100 items and fix the root cause"

### 3. Let Research run

Claude investigates the codebase, reads relevant files, checks git history, and consults docs. For complex tasks touching multiple subsystems, it may spawn parallel subagents to speed this up — you'll see them finish before it continues.

It documents findings with confidence levels (`high / medium / low`). You don't need to do anything. If Claude asks a question, answer it.

When research is done, Claude will present a **checkpoint**.

---

## The checkpoint moment

This is the most important interaction. At the end of each phase, Claude shows you a summary and waits.

**What it looks like:**

```
── Checkpoint: research → plan ──────────────────
Run:       20260325-143022-a4f1c2
Profile:   balanced
Verdict:   completed
Open risks: 2

Key outcomes:
  - Found that auth middleware uses JWT stored in localStorage (XSS risk)
  - Dashboard query loads all items, no pagination
  - Two related components share duplicated logic that can be extracted

Unresolved decisions:
  - Should we use httpOnly cookies or keep localStorage with added CSRF protection?

Next phase: plan

APPROVE or DENY?
─────────────────────────────────────────────────
```

**Your response options:**

| What you type | What happens |
|---|---|
| `APPROVE: looks good` | Plan phase begins |
| `APPROVE: proceed but watch the auth decision` | Plan phase begins, your note is logged |
| `DENY: the auth risk is unacceptable, research more` | Run rolls back, Claude re-investigates |

Type your response in plain English. The `APPROVE:` / `DENY:` prefix is what triggers the next step. Whatever follows the colon is your reason — be specific, it helps the retrospective.

---

## Picking a profile

Profiles only matter for the full pipeline (`/workflow start`). Bugfix and lite modes use the `micro` profile automatically.

```
/workflow start --profile <strict|balanced|fast>
```

|   Profile   | Use when                                                                                                               |
|-------------|------------------------------------------------------------------------------------------------------------------------|
|  `balanced` | Almost everything. The default.                                                                                        |
|  `strict`   | Production deployments, security changes, anything that must ship clean. Zero open risks allowed at the end.           |
|  `fast`     | Prototyping, "I just want to see if this approach works." Lower token limits, skips some checks.                       |
|  `micro`    | Used automatically by `--mode bugfix` and `--mode lite`. Not set manually.                                             |

You can't change the profile mid-run. If you need to switch, abort and restart.

---

## Common scenarios

### "I just want a quick fix"

```
/workflow quick
```

Tell Claude what to fix. It reads, changes, summarizes. No checkpoints, no ceremony.

---

### "I know the bug, I just need it fixed"

```
/workflow start --mode bugfix
```

Describe the bug. Claude skips Research and Plan, goes straight to implementing and validating. One checkpoint gate at the end.

---

### "I want to add a small feature"

```
/workflow start --mode lite
```

Claude makes a quick plan (max 5 tasks), you approve it, then it implements and validates. Two checkpoint gates total.

---

### "I want to check where things are"

```
/workflow status
```

Shows: current phase, run ID, token usage, open risks, completed phases.

The Stop hook also auto-shows status after every Claude response (if a run is active).

---

### "Claude said the token budget is at 60%"

This is the compress threshold. Claude will:
1. Write a micro-summary of what it's working on
2. Run the compress command
3. Continue with trimmed context

You don't need to do anything. If Claude asks you to confirm, say yes.

---

### "Something went wrong / I want to start over"

**If you're at a checkpoint:** type `DENY: <reason>`. Claude rolls back to the last snapshot and blocks the run.

**If you're mid-phase:**
```
/workflow abort --reason "decided to change approach"
```

Then start fresh:
```
/workflow start
```

---

### "I denied a checkpoint — now what?"

Run is in `blocked` state. Claude will show you the rollback report. You have two options:

1. **Fix the issue and re-run the phase** — tell Claude what to do differently, then proceed
2. **Start fresh** — `/workflow start` with a refined task scope

---

### "The run finished — what do I do?"

```
/workflow retrospective
```

Claude reads all the phase summaries and generates:
- `eval/retro-<run-id>.json` — structured feedback
- `eval/retro-<run-id>.md` — human summary: what worked, what blocked, what to improve

After a few runs:
```
/workflow weekly-synthesis
```

This clusters patterns across runs and suggests config/prompt improvements.

---

### "I want to see all my past runs"

```
/workflow list
```

---

## What the phases actually do

|     Phase     | What Claude does                                                       | What you do                                   |
|---------------|------------------------------------------------------------------------|-----------------------------------------------|
| **Research**  | Reads code, git history, docs. May spawn parallel subagents for complex tasks. | Describe the task. Answer questions if asked. |
| **Plan**      | Creates a sequenced task list with dependencies and batch assignments. | Review the checkpoint. Deny if the plan looks wrong. |
| **Implement** | Executes tasks batch-by-batch. Commits after each batch.               | Review the checkpoint. Check the commits if you want. |
| **Validate**  | Checks the implementation against the plan. Produces a verdict.        | Review the final checkpoint. Approve = run complete. |

Which phases run depends on mode:

| Mode | Phases |
|---|---|
| `quick` | None — direct implementation |
| `bugfix` | Implement → Validate |
| `lite` | Plan → Implement → Validate |
| `full` | Research → Plan → Implement → Validate |

---

## NOTE

**`/workflow quick` leaves no artifacts.** It's intentionally stateless — no run directory, no JSON files, no `/workflow status`. If you need a record, commit manually.

**Bugfix/lite modes use a tight token budget.** The `micro` profile sets phase_max to 15k tokens. If a task turns out to be bigger than expected and you're hitting budget warnings, abort and use the full pipeline with `fast` profile instead.

**Don't switch projects mid-run.** The `runs/current` symlink points to the run for the project you started from. Running `/workflow status` from a different project directory won't find it.

**The fast profile uses filesystem only.** Git, GitHub, context7, and google-stitch are skipped. Fine for prototyping; use balanced if you need full research.

**Compress is automatic, not manual.** When Claude hits 60% of the phase token budget, it compresses automatically. You'll see a `[TOKEN]` notice. Don't interrupt it.

**Abort preserves data.** Aborting a run doesn't delete anything. All phase summaries, task state, and snapshots are kept. You can inspect them in `runs/<run-id>/`.

**One active run at a time.** `runs/current` points to one run. Starting a new run updates the symlink. Old runs are still in `runs/` by their ID.
