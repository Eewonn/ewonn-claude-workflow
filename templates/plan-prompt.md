# Plan Phase Prompt

## Context

- Run ID: `{{run_id}}`
- Profile: `{{profile}}`
- Task scope: `{{task_scope}}`
- Research summary: `{{prior_phase_summary}}`

## Objective

Translate research findings into a concrete, sequenced implementation plan. Produce tasks with explicit dependencies, agent assignments, and batch groupings.

## Step 1: Delegate Architecture Design to `feature-dev:code-architect`

Spawn the architect sub-agent **synchronously** (its output is required before you can proceed):

```
Agent(
  subagent_type: "feature-dev:code-architect",
  prompt: "Given these research findings: {{prior_phase_summary}}
           Design an implementation blueprint for: {{task_scope}}
           Return: ordered list of implementation steps, each with: description, files_affected[], dependencies[].
           Use filesystem only — no web fetching."
)
```

After it returns, use its output as the basis for `task-state.json`. You add: schema fields, batch boundaries, `assigned_agent` mapping.

## Step 2: Haiku Dependency Cycle Check

After drafting tasks, spawn a Haiku micro-agent:

```
Agent(subagent_type: "general-purpose", model: "haiku",
      prompt: "Check for dependency cycles in: [paste task list as JSON with id + dependencies].
               Return {has_cycles: bool, cycles: [[id, id, ...], ...]}")
```

If `has_cycles: true`: reorder or split tasks to eliminate cycles before writing `task-state.json`.

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

**`phase-summary-plan.json`** (required) — exact shape, no extra fields:

```json
{
  "summary_id": "plan-<run-id>",
  "run_id": "<run-id>",
  "phase": "plan",
  "status": "completed",
  "created_at": "2026-01-01T00:00:00.000Z",
  "outcomes": ["at least one string"],
  "open_risks": [
    { "id": "R1", "description": "...", "severity": "high|medium|low" }
  ],
  "unresolved_decisions": [
    { "id": "D1", "description": "...", "options": ["opt1"] }
  ],
  "connector_gaps": [],
  "token_summary": { "tokens_used": 12345, "peak_threshold_hit": null }
}
```

`open_risks`, `unresolved_decisions`, `connector_gaps` are arrays of **objects**, never strings. Use `[]` for empty arrays.

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
