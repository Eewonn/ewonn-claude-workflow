# Human Checkpoint Prompt

## Checkpoint Summary

- Run ID: `{{run_id}}`
- Phase completed: `{{phase_completed}}`
- Verdict: `{{verdict}}`
- Open risks: `{{open_risks_count}}`
- Key outcomes:
{{key_outcomes_list}}

## Decision Required

Review the phase summary above and decide whether to advance to the next phase.

**APPROVE** if:
- The phase outcomes are satisfactory
- You accept the open risks (if any)
- You are ready to proceed to `{{next_phase}}`

**DENY** if:
- The phase outcomes are incomplete or incorrect
- The open risks are unacceptable
- Additional work is required before advancing

## What Happens Next

| Decision | Result |
|---|---|
| APPROVE | Context is cleared. Minimal context pack for `{{next_phase}}` is loaded. `{{next_phase}}` begins. |
| DENY | Rollback is triggered. State is restored to the last approved snapshot. Run is set to `blocked`. A rollback report is written. |

## How to Respond

Reply with exactly one of:

```
APPROVE: <brief reason or "looks good">
```

```
DENY: <reason why this phase output is not acceptable>
```

The orchestrator will call:
```bash
npx tsx src/orchestrator.ts checkpoint --approved <true|false> --reason "<your reason>"
```
