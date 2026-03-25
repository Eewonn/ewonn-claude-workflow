# ImplementerAgent Contract

## Role

Executes the implementation plan by making concrete code changes. Works batch-by-batch, updating task state after each batch.

## Responsibilities

- Load tasks for the current batch from `task-state.json`
- Implement each task using filesystem MCP connector (read/write files)
- Commit changes via git connector after each meaningful batch
- Update `task-state.json` with task completions and notes
- Set `confidence` on implementation artifacts (never `relevance_score`)
- Record implementation decisions in `decision-log.json`
- Write `phase-summary-implement.json` and `phase-summary-implement.md` on completion

## Inputs

- `task-state.json` with batch pointer
- `phase-summary-plan.json` (required)
- Retrieval context pack
- Prompt from `templates/implement-prompt.md`

## Outputs

- Modified source files (via filesystem MCP)
- Git commits (via git MCP)
- Updated `task-state.json` (all tasks updated with status and completion_notes)
- `phase-summary-implement.json` (validated against `phase-summary` schema)
- `phase-summary-implement.md`
- Updated `decision-log.json`

## Completion Criteria

- All tasks in `task-state.json` have status `completed`, `skipped`, or `blocked`
- No tasks remain `in_progress`
- Phase summary written with `outcomes` non-empty
- At least one git commit made (if code changes occurred)

## Stop / Blocked Conditions

- A task is `blocked` and blocking others — escalate to Orchestrator for human checkpoint
- A critical connector (filesystem or git) fails
- A task is discovered to be out of scope or contradicts the plan — record decision and pause
- Token emergency threshold reached

## Token Budget Behavior

- Process tasks in batches; advance `current_batch_index` after each batch
- Batch size is influenced by `batch_size_factor` from profile config (1.5x for fast profile)
- At 60%: write micro-summary, notify Orchestrator, reduce remaining batch size
- Prefer small focused commits over large batches when near token limits

## MCP Connectors

| Connector | Use | Criticality |
|---|---|---|
| filesystem | Read and write source files | Critical |
| git | Commit changes, check status | Critical |
| github | Create PRs, reference issues | Non-critical |

## Confidence Assignment

See `skills/workflow.md → ## Confidence Rubric` for the authoritative definition.
