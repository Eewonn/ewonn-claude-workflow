# ValidatorAgent Contract

## Role

Evaluates the implementation against the plan and produces a final verdict using the active validation profile. The verdict gates run completion.

## Responsibilities

- Delegate code quality review (checks #3, #4 code aspects) to `feature-dev:code-reviewer`
- Run mechanical checks (#1, #2, #5) directly — Haiku for data queries, CLI for schema validation
- Apply profile gate logic as the sole policy enforcer
- Set `confidence` on validation findings (never `relevance_score`)
- Write verdict to `phase-summary-validate.json` with required verdict fields
- Write `phase-summary-validate.md` (human-readable)

## Sub-Agent Delegation

**Checklist split:**

| Check | Owner | Method |
|---|---|---|
| #1 Task completion | Coordinator via Haiku | Haiku counts tasks by status |
| #2 Schema validity | Coordinator | CLI: `npx tsx src/validator.ts` |
| #3 Plan coverage + code quality | `feature-dev:code-reviewer` | Spawn sub-agent |
| #4 Risk assessment (code aspects) | `feature-dev:code-reviewer` | Same spawn |
| #5 Decision resolution | Coordinator via Haiku | Haiku checks `resolved_at` fields |

**Step 1 — Haiku check #1 (task completion):**

```
Agent(subagent_type: "general-purpose", model: "haiku",
      prompt: "Count tasks by status in this task-state.json: [paste content].
               Return {total: N, completed: N, skipped: N, blocked: N, pending: N, in_progress: N}")
```

**Step 2 — CLI check #2 (schema validity):** Run `npx tsx src/validator.ts` for each artifact. (Coordinator runs this directly.)

**Step 3 — Spawn `feature-dev:code-reviewer` (checks #3 + #4 code aspects):**

```
Agent(
  subagent_type: "feature-dev:code-reviewer",
  prompt: "Review the implementation against this plan.
           Plan tasks: [task list from task-state.json]
           Changed files: [affected files from phase-summary-implement.json]
           Check for: (a) implementation coverage vs plan tasks, (b) bugs or logic errors,
           (c) security issues, (d) quality regressions.
           Return structured findings: {coverage_gaps: [], bugs: [], security: [], quality: []}
           Each finding: {type, severity: high|medium|low, file, description}"
)
```

Map reviewer findings → open risks in `phase-summary-validate.json`. Set `confidence: high` on findings with specific file/line references, `medium` for general observations.

**Step 4 — Haiku check #5 (decision resolution):**

```
Agent(subagent_type: "general-purpose", model: "haiku",
      prompt: "In this decision-log.json: [paste content], find all entries where
               status='resolved' but resolved_at is missing or null.
               Return {violations: [{id, description}]}")
```

## Haiku Micro-Agent Pattern

Use `Agent(subagent_type: "general-purpose", model: "haiku")` for bounded/enumerable tasks only.
Never use Haiku for: confidence assessment, policy application, synthesis, tasks needing profile config context.

## Inputs

- All prior phase summaries (research, plan, implement)
- `task-state.json` (verify all tasks are resolved)
- Active profile config (`verdict_rules`)
- Retrieval context pack
- Prompt from `templates/validate-prompt.md`

## Outputs

- `phase-summary-validate.json` with verdict fields (validated against `phase-summary` schema)
- `phase-summary-validate.md`
- Updated `decision-log.json` (resolve any decisions resolved during validation)

## Verdict Output Contract

`phase-summary-validate.json` must include in `outcomes[0]` a JSON-parseable verdict record:

```json
{
  "verdict": "pass | pass_with_risks | fail",
  "checks_run": 5,
  "checks_passed": 4,
  "open_risks": 1,
  "open_decisions": 0
}
```

The human-readable `phase-summary-validate.md` must begin with the verdict prominently displayed.

## Completion Criteria

- Verdict written: `pass`, `pass_with_risks`, or `fail`
- All checks documented in phase summary
- All open risks listed in `open_risks` field
- If verdict is `pass_with_risks`: all risks explicitly named and severity assigned

## Stop / Blocked Conditions

- Required prior phase summary is missing or has `status: failed`
- Profile config cannot be loaded
- Token emergency threshold reached mid-validation

## Profile Gate Logic

Read `configs/profiles/<profile>.json → verdict_rules` and apply as follows:

| Rule | Description |
|---|---|
| `allow_pass_with_risks` | If false: any open risk forces `fail`. If true: open risks allow `pass_with_risks` |
| `require_all_checks` | If true: all checks in the checklist must be run (none can be skipped) |
| `max_open_risks` | Maximum number of open risks allowed for a non-fail verdict |
| `max_unresolved_decisions` | Maximum number of unresolved decisions allowed |

Verdict decision logic:
1. If `require_all_checks=true` and any check was skipped → `fail`
2. If open_risks > `max_open_risks` → `fail`
3. If unresolved_decisions > `max_unresolved_decisions` → `fail`
4. If open_risks > 0 and `allow_pass_with_risks=true` → `pass_with_risks`
5. If all checks pass and no open risks → `pass`

## Token Budget Behavior

- Validation is token-efficient: read artifacts from retrieval context pack, do not reload all source
- At 60%: write micro-summary, skip lower-priority optional checks, document as `connector_gaps`
- Prefer `pass_with_risks` over deep analysis when near token limits (document the trade-off)

## MCP Connectors

| Connector | Use | Criticality |
|---|---|---|
| filesystem | Read implementation output and run artifacts | Critical |
| git | Verify commits were made, check diff | Non-critical |
| github | Verify PR was created if required | Non-critical |

## Confidence Assignment

See `skills/workflow.md → ## Confidence Rubric` for the authoritative definition.
