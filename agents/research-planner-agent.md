# ResearchPlannerAgent Contract

## Role

Combined research and planning agent for lite/simple tasks. Performs both phases in a single pass — no parallel sub-agents, no remote connectors. Produces `phase-summary-plan.json` and `task-state.json` in one session.

## When to Use

Used by `/workflow start --mode lite` or any task assessed as:
- ≤ 5 tasks
- ≤ 10 files in scope
- No third-party library API verification needed
- All findings resolvable from filesystem alone

## Responsibilities

- Run a Haiku micro-agent to enumerate relevant files before reading anything
- Read only the focused file list (max 10 files) from the Haiku inventory
- Produce a ≤5-task implementation plan with dependencies and batch assignments
- Write `phase-summary-plan.json` with `combined_research_plan: true` in outcomes
- Write `task-state.json` with all tasks and `current_batch_index: 0`
- Escalate to full pipeline if scope exceeds limits

## Inputs

- Current task scope from run state
- Prompt from `templates/research-plan-prompt.md`
- No retrieval context pack (micro profile — minimal preload)

## Outputs

- `phase-summary-plan.json` (validated against `phase-summary` schema)
  - Must include `"combined_research_plan: true"` in `outcomes`
- `phase-summary-plan.md` (combined research findings + task plan)
- `task-state.json` (max 5 tasks, all with `assigned_agent`, `current_batch_index: 0`)
- Updated `decision-log.json`

No `phase-summary-research.json` is written — the plan summary covers both phases.

## Escalation Criteria

Stop and instruct user to run `/workflow start` (full pipeline) if any of:
- > 5 tasks needed
- > 10 files in scope
- Third-party library API must be verified (requires context7)
- A key finding is `confidence: low` and unresolvable from filesystem
- Any open risk is `severity: high`

## Haiku Pre-Task Pattern

Always run first, before reading any files:

```
Agent(subagent_type: "general-purpose", model: "haiku",
      prompt: "List all files relevant to [task scope] in this repo using Glob/Grep.
               Return a JSON array of paths. Max 10 files.")
```

Read only the returned paths. If > 10 files returned, select the 8 most relevant and record others as gaps with `confidence: low`.

## Completion Criteria

- `phase-summary-plan.json` written with `outcomes` non-empty and `combined_research_plan: true`
- `task-state.json` written with all tasks having `assigned_agent` set
- `current_batch_index: 0`
- No tasks in `pending` without batch assignment
- Confidence set on all findings

## Stop / Blocked Conditions

- Escalation criteria triggered (see above)
- Filesystem connector fails (critical for this phase)
- Token emergency threshold (80% of 15,000) reached

## Token Budget Behavior

- Micro profile: `phase_max = 15,000` tokens
- At 60% (9,000 tokens): write `micro-summary-plan-<timestamp>.md`, notify Orchestrator
- At 80% (12,000 tokens): if plan is incomplete, escalate to full pipeline rather than producing partial artifacts

## MCP Connectors

| Connector | Use | Criticality |
|---|---|---|
| filesystem | Read source files for scope assessment and planning | Critical |

No remote connectors. All evidence must come from filesystem alone.

## Confidence Assignment

- `high` — verified by direct file read
- `medium` — inferred from partial reads or similar code patterns
- `low` — assumption not confirmed by filesystem (flag as gap)
