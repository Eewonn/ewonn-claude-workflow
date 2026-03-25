# Validate Phase Prompt

## Context

- Run ID: `{{run_id}}`
- Profile: `{{profile}}`
- Task scope: `{{task_scope}}`
- Implementation summary: `{{prior_phase_summary}}`

## Objective

Evaluate the implementation against the plan using the active validation profile. Produce a verdict that gates run completion.

## Profile Behavior

Load `configs/profiles/{{profile}}.json` and read `verdict_rules`:

| Rule | What it means |
|---|---|
| `allow_pass_with_risks` | Can the run pass if open risks remain? |
| `require_all_checks` | Must all checks be run (none skipped)? |
| `max_open_risks` | Maximum open risks for a non-fail verdict |
| `max_unresolved_decisions` | Maximum unresolved decisions for a non-fail verdict |

## Checklist

Run the following checks, recording pass/fail for each:

1. **Task completion** — all tasks in `task-state.json` are resolved (`completed` or `skipped`; no `pending` or `in_progress`)
2. **Schema validity** — all run artifacts pass schema validation:
   ```bash
   npx tsx src/validator.ts run-state <run-dir>/run-state.json
   npx tsx src/validator.ts phase-summary <run-dir>/phase-summary-research.json
   npx tsx src/validator.ts phase-summary <run-dir>/phase-summary-plan.json
   npx tsx src/validator.ts phase-summary <run-dir>/phase-summary-implement.json
   npx tsx src/validator.ts task-state <run-dir>/task-state.json
   npx tsx src/validator.ts decision-log <run-dir>/decision-log.json
   ```
3. **Plan coverage** — implementation outcomes in `phase-summary-implement.json` cover the tasks in `task-state.json`
4. **Risk assessment** — all `open_risks` from prior phases are either resolved or explicitly carried forward
5. **Decision resolution** — all `resolved` decisions in `decision-log.json` have `resolved_at` set

## Verdict Decision Logic

Apply in order:
1. If `require_all_checks=true` and any check was skipped → **fail**
2. If open_risks count > `max_open_risks` → **fail**
3. If unresolved_decisions count > `max_unresolved_decisions` → **fail**
4. If open_risks > 0 and `allow_pass_with_risks=true` → **pass_with_risks**
5. If all checks pass and no open risks → **pass**

## Output Contract

**`phase-summary-validate.json`** (required):
- `outcomes[0]` must be a JSON-parseable verdict record:
  ```json
  {"verdict":"pass","checks_run":5,"checks_passed":5,"open_risks":0,"open_decisions":0}
  ```
- `open_risks`: all risks carried forward with severity
- `token_summary.tokens_used`: approximate token count
- Validate before writing:
  ```bash
  npx tsx src/validator.ts phase-summary <run-dir>/phase-summary-validate.json
  ```

**`phase-summary-validate.md`** (required):
- Verdict prominently at top
- Check results table
- Open risks (if any) with severity
- Recommendation for next steps

## Stop Conditions

- A required prior phase summary is missing or `status: failed`
- Profile config cannot be loaded
- Token emergency threshold reached mid-validation
