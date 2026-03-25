# Research + Plan Phase Prompt (Lite Mode)

## Context

- Run ID: `{{run_id}}`
- Profile: `micro`
- Task scope: `{{task_scope}}`

## Objective

Research and plan in one pass. Produce a focused implementation plan (max 5 tasks) using only filesystem evidence.

## Step 1: Haiku File Inventory (always first)

Before reading any files, enumerate the relevant file list cheaply:

```
Agent(subagent_type: "general-purpose", model: "haiku",
      prompt: "List all files relevant to this task in the repo: {{task_scope}}
               Use Glob and Grep. Return a JSON array of file paths. Max 10 files.")
```

Read only the files returned. If > 10 files, pick the 8 most relevant and note the rest as gaps with `confidence: low`.

## Step 2: Escalation Check

After the Haiku inventory, stop and escalate to `/workflow start` (full pipeline) if:
- > 10 files are needed
- A third-party library API must be verified
- Any finding would be `confidence: low` due to missing external context
- The task clearly requires > 5 implementation tasks

Tell the user: "Scope exceeds lite mode — recommend `/workflow start --profile balanced`."

## Step 3: Research (direct reads)

Read the focused file list. For each file, note:
- What it does relevant to the task
- What needs to change
- Any risks or open decisions

Set `confidence` on each finding:
- `high` — verified by direct read
- `medium` — inferred from partial read
- `low` — assumption not confirmed

## Step 4: Plan (max 5 tasks)

Produce an implementation plan from your research findings:

- Maximum 5 tasks — if more are needed, escalate
- Every task needs: `title`, `assigned_agent`, `dependencies` (by task ID), `batch_index`
- Most tasks should be `assigned_agent: ImplementerAgent`
- Batch groupings must respect dependencies

## Output Contract

**`task-state.json`** (required):
- All tasks with status `pending`, `current_batch_index: 0`
- Each task: `id`, `title`, `phase`, `assigned_agent`, `created_at`, `updated_at`
- Validate before writing:
  ```bash
  npx tsx src/validator.ts task-state <run-dir>/task-state.json
  ```

**`phase-summary-plan.json`** (required):
- `outcomes` must be non-empty and include `"combined_research_plan: true"` as one entry
- `open_risks`: any risks found during research or planning
- `unresolved_decisions`: decisions that must be resolved before implementation
- `token_summary.tokens_used`: approximate token count
- Validate before writing:
  ```bash
  npx tsx src/validator.ts phase-summary <run-dir>/phase-summary-plan.json
  ```

**`phase-summary-plan.md`** (required):
- Research findings (2–3 bullets: what was learned)
- Task list with batch groupings
- Open risks (if any)

Update `decision-log.json` with any new decisions.

## Stop Conditions

- Escalation criteria triggered (see Step 2)
- Filesystem connector fails
- Token emergency threshold (80% of 15,000 = 12,000 tokens) reached — escalate rather than produce partial artifacts
