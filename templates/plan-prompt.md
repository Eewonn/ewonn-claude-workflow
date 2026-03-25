# Plan Phase Prompt

## Context

- Run ID: `{{run_id}}`
- Profile: `{{profile}}`
- Task scope: `{{task_scope}}`
- Research summary: `{{prior_phase_summary}}`

## Objective

Translate research findings into a concrete, sequenced implementation plan. Produce tasks with explicit dependencies, agent assignments, and batch groupings.

## Planning Rules

- Every task must have an `assigned_agent` from: `OrchestratorAgent`, `ResearchAgent`, `PlannerAgent`, `ImplementerAgent`, `ValidatorAgent`
- Tasks must have explicit dependencies listed by ID
- Batch groupings must respect dependencies (tasks in batch N can only depend on tasks in batches < N)
- Identify and document implementation risks not surfaced in research
- Keep plan focused on the task scope — do not expand scope without recording it as a decision

## Output Contract

**`task-state.json`** (required):
- All tasks written with status `pending`
- `current_batch_index: 0`
- Each task has `id`, `title`, `phase`, `assigned_agent`, `created_at`, `updated_at`
- Validate before writing:
  ```bash
  npx tsx src/validator.ts task-state <run-dir>/task-state.json
  ```

**`phase-summary-plan.json`** (required):
- `outcomes`: at least one outcome describing what the plan covers
- `open_risks`: implementation risks identified during planning
- `unresolved_decisions`: decisions that must be resolved before or during implementation
- `token_summary.tokens_used`: approximate token count

**`phase-summary-plan.md`** (required):
- Plan overview (2–4 sentences)
- Task count and batch count
- Critical path summary
- Open risks
- Any scope decisions made

Validate `phase-summary-plan.json` before writing:
```bash
npx tsx src/validator.ts phase-summary <run-dir>/phase-summary-plan.json
```

Update `decision-log.json` with any new planning decisions.

## Stop Conditions

- Research summary is missing (`status: failed`) — cannot plan without research
- Task scope expands significantly during planning — record as decision, request human input
- Dependency cycle detected that cannot be resolved
- Token emergency threshold reached
