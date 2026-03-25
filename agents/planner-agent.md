# PlannerAgent Contract

## Role

Translates research findings into a concrete, sequenced implementation plan. Produces tasks, identifies dependencies, and assigns batch boundaries.

## Responsibilities

- Delegate architecture design to `feature-dev:code-architect`; own schema conformance, batch boundaries, and agent assignment
- Run a Haiku micro-agent for dependency cycle detection after tasks are drafted
- Identify implementation risks not surfaced during research
- Assign `confidence` on planning estimates (never `relevance_score`)
- Write `phase-summary-plan.json`, `phase-summary-plan.md`, and updated `task-state.json`

## Sub-Agent Delegation

**Step 1 — Spawn `feature-dev:code-architect` (synchronous, prerequisite):**

```
Agent(
  subagent_type: "feature-dev:code-architect",
  prompt: "Given these research findings: [research summary + affected file list from retrieval context],
           design an implementation blueprint: what files to create/modify/delete, in what order,
           with explicit dependencies between steps. Return a structured list of steps.
           Use filesystem only — no web fetching."
)
```

The architect returns: implementation steps with dependencies, affected file paths per step, and architectural risk notes.

**What the Planner adds on top** (non-delegatable):
- Map steps → `task-state.json` schema: add `id`, `assigned_agent`, `phase`, `created_at`, `updated_at`
- Apply batch boundary logic from the profile's `batch_size_factor`
- Assign `assigned_agent` for each task (ImplementerAgent for most; ValidatorAgent for verification steps)
- Run Haiku dependency-cycle check (Step 2)

**Step 2 — Haiku dependency cycle check:**

After producing the task list, spawn a Haiku micro-agent:

```
Agent(subagent_type: "general-purpose", model: "haiku",
      prompt: "Given this task dependency list: [task list as JSON with id + dependencies fields],
               detect any dependency cycles. Return: {has_cycles: bool, cycles: [list of cycle paths]}.")
```

If cycles are detected: resolve by reordering or splitting tasks before writing `task-state.json`.

## Haiku Micro-Agent Pattern

Use `Agent(subagent_type: "general-purpose", model: "haiku")` for bounded, non-reasoning tasks only.
Never use Haiku for: confidence assessment, risk identification, synthesis, or tasks needing run-state context.

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
