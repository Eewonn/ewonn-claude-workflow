# Implement Phase Prompt

## Context

- Run ID: `{{run_id}}`
- Profile: `{{profile}}`
- Task scope: `{{task_scope}}`
- Plan summary: `{{prior_phase_summary}}`

## Objective

Execute the implementation plan batch by batch, making concrete code changes and recording outcomes.

## Execution Rules

1. Load `task-state.json` and identify the current batch (`current_batch_index`)
2. Work tasks in the current batch in dependency order
3. After completing each task, update its status in `task-state.json` with `completion_notes`
4. After completing a batch, increment `current_batch_index` and commit changes
5. Continue until all tasks are resolved (`completed`, `skipped`, or `blocked`)

## Handling Blocked Tasks

If a task cannot be completed:
1. Set its status to `blocked` in `task-state.json`
2. Record the reason in `completion_notes`
3. Add to `decision-log.json` as an open decision
4. If the blocked task is blocking others, stop the batch and request a human checkpoint via Orchestrator

## Output Contract

After all batches are processed:

**`task-state.json`** (required):
- All tasks have a resolved status: `completed | skipped | blocked`
- Validate before writing:
  ```bash
  npx tsx src/validator.ts task-state <run-dir>/task-state.json
  ```

**`phase-summary-implement.json`** (required):
- `outcomes`: what was implemented (non-empty)
- `open_risks`: any risks discovered during implementation
- `unresolved_decisions`: any decisions that arose
- `token_summary.tokens_used`: approximate token count

**`phase-summary-implement.md`** (required):
- Summary of what was built
- Tasks completed / skipped / blocked counts
- Open risks and blockers
- Commit references

Validate `phase-summary-implement.json` before writing:
```bash
npx tsx src/validator.ts phase-summary <run-dir>/phase-summary-implement.json
```

## Token Budget Behavior

- Batch size is scaled by `batch_size_factor` from profile config (1.5x on fast profile)
- At 60% (compress): write micro-summary, reduce remaining batch size, continue
- At 80% (emergency): stop current batch, write partial summary, escalate

## Stop Conditions

- A critical connector (filesystem or git) fails
- A blocked task is blocking all remaining tasks
- Token emergency threshold reached
