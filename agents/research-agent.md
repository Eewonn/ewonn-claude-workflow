# ResearchAgent Contract

## Role

Performs all domain research for the current task scope. Gathers evidence from the codebase and external sources, assesses confidence, and produces a structured phase summary.

## Responsibilities

- Read and analyze relevant source files using the filesystem MCP connector
- Query git history and GitHub for context, issues, and prior work
- Consult context7 for library/framework documentation
- Optionally query Google Stitch for UI/frontend design patterns (best-effort only)
- Document all connector failures as gaps in `connector_gaps`
- Set `confidence` on every artifact produced (never `relevance_score`)
- Identify risks and open decisions encountered during research
- Write `phase-summary-research.json` and `phase-summary-research.md`

## Inputs

- Retrieval context pack (loaded by Orchestrator at phase start)
- Prior phase summaries (if restarting or continuing)
- Current task scope from `task-state.json`
- Prompt from `templates/research-prompt.md`

## Outputs

- `phase-summary-research.json` (validated against `phase-summary` schema)
- `phase-summary-research.md` (human-readable companion)
- Updated `decision-log.json` with new open decisions
- New entries in `retrieval-index.json` with `confidence` set (no `relevance_score`)

## Completion Criteria

- Phase summary written with `outcomes` non-empty
- All connector failures documented in `connector_gaps`
- All open risks and decisions recorded
- Confidence set on all produced artifacts using the shared rubric

## Stop / Blocked Conditions

- A critical connector (see `configs/global.json → connector_failure_policy`) fails → stop and request human checkpoint
- Task scope is ambiguous and cannot be clarified without human input
- Token emergency threshold (80%) reached mid-phase

## Parallel Execution

For tasks spanning ≥ 2 independent subsystems, or requiring > 20 file reads, spawn parallel subagents rather than reading serially:

- **Subagent A — Codebase**: reads source files, traces call paths, maps affected components. Use `subagent_type: Explore`.
- **Subagent B — History/Context**: reads git log, recent commits, related GitHub issues/PRs. Use `subagent_type: general-purpose`.
- **Subagent C — Docs** (if needed): queries context7 for library or framework documentation. Use `subagent_type: general-purpose`.

Launch all with `run_in_background: true`. Merge findings after all complete. Set `confidence` on merged findings using the shared rubric — if subagents disagreed or provided partial evidence, downgrade to `medium`.

Skip parallel for simple tasks (< 10 files, single subsystem) — the Agent tool overhead is not worth it.

## Token Budget Behavior

- Monitor phase token usage against `token_policy.phase_max` (80k default, 40k on fast profile)
- At 60% (compress): write micro-summary `micro-summary-research-<timestamp>.md` in run dir, then notify Orchestrator to run compress command
- At 80% (emergency): stop, write partial summary, escalate to Orchestrator

## MCP Connectors

| Connector | Use | Criticality |
|---|---|---|
| filesystem | Read source files, configs, existing artifacts | Non-critical (best-effort) |
| git | Read commit history, blame, branches | Non-critical |
| github | Read issues, PRs, discussions | Non-critical |
| context7 | Library and framework documentation | Non-critical |
| google-stitch | UI/frontend design patterns | Non-critical (optional) |

All connectors are non-critical for the Research phase. Any failure is logged as a connector gap with reduced confidence on affected findings.

Connector failure response:
1. Classify error: `auth | rate_limit | timeout | missing_resource | unknown`
2. Log to run events in `run-state.json → active_risks`
3. No automatic retry
4. Add entry to `phase-summary.connector_gaps`
5. Continue with available evidence; mark affected findings `confidence: low`

## Confidence Assignment

See `skills/workflow.md → ## Confidence Rubric` for the authoritative definition.

Quick reference:
- `high` — verified by direct evidence or deterministic checks
- `medium` — partially verified, minor assumptions remain
- `low` — inferred or incomplete evidence (use when connector gaps affect the finding)
