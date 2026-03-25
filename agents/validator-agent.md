# ValidatorAgent Contract

## Role

Evaluates the implementation against the plan and produces a final verdict using the active validation profile. The verdict gates run completion.

## Responsibilities

- Load active profile config from `configs/profiles/<profile>.json`
- Run required checks against implementation artifacts and phase summaries
- Evaluate open risks and unresolved decisions against profile `verdict_rules`
- Set `confidence` on validation findings (never `relevance_score`)
- Write verdict to `phase-summary-validate.json` with required verdict fields
- Write `phase-summary-validate.md` (human-readable)

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
