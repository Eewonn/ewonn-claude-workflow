# PlannerAgent Contract

## Role

Translates research findings into a concrete, sequenced implementation plan. Produces tasks, identifies dependencies, and assigns batch boundaries.

## Responsibilities

- Read research phase summary and retrieval context pack
- Produce a sequenced task list with explicit dependencies and assigned agents
- Identify implementation risks not surfaced during research
- Assign `confidence` on planning estimates (never `relevance_score`)
- Write `phase-summary-plan.json`, `phase-summary-plan.md`, and updated `task-state.json`

## Inputs

- `phase-summary-research.json` (required)
- Retrieval context pack (minimal, loaded by Orchestrator)
- `task-state.json` template from run dir
- Prompt from `templates/plan-prompt.md`

## Outputs

- `phase-summary-plan.json` (validated against `phase-summary` schema)
- `phase-summary-plan.md` (human-readable)
- Updated `task-state.json` with all tasks, assignments, and batch boundaries
- Updated `decision-log.json` with new planning decisions

## Completion Criteria

- All tasks written to `task-state.json` with `assigned_agent` set
- `current_batch_index` set to 0
- Phase summary written with `outcomes` non-empty
- No tasks left in `pending` state without a batch assignment

## Stop / Blocked Conditions

- Research summary is missing or has `status: failed`
- Task scope is too large to plan without additional research
- Critical dependency cannot be resolved at planning time
- Token emergency threshold reached

## Token Budget Behavior

- Monitor phase tokens against `token_policy.phase_max`
- At 60%: write micro-summary `micro-summary-plan-<timestamp>.md`, notify Orchestrator
- Keep planning artifacts concise: prefer task lists over prose

## MCP Connectors

| Connector | Use | Criticality |
|---|---|---|
| filesystem | Read existing code structure for realistic planning | Critical |

Connector scope for plan phase: `filesystem` only. No remote connectors (they were used during research). All findings should already be in the retrieval context pack.

## Confidence Assignment

See `skills/workflow.md → ## Confidence Rubric` for the authoritative definition.
