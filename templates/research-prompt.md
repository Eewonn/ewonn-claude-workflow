# Research Phase Prompt

## Context

- Run ID: `{{run_id}}`
- Profile: `{{profile}}`
- Task scope: `{{task_scope}}`
- Prior phase summary: `{{prior_phase_summary}}` *(none if first run)*

## Objective

Gather all evidence needed to understand the problem and inform a concrete implementation plan.

Produce findings with explicit confidence levels. Document every gap where a connector failure prevented complete evidence.

## Step 0: Haiku Pre-Tasks (always, before anything else)

Run one or more Haiku micro-agents to enumerate the relevant file list before spawning expensive sub-agents. This costs ~500 tokens and prevents broad exploration.

```
Agent(subagent_type: "general-purpose", model: "haiku",
      prompt: "List all files relevant to [task scope] in this repo. Use Glob/Grep. Return a JSON array of paths.")
```

Use Haiku pre-tasks for: file inventory, import extraction, symbol listing. The resulting file list is passed as explicit context to the main sub-agents below.

## Dispatch Decision

| Condition | Mode |
|---|---|
| ≥ 2 independent subsystems OR > 20 file reads | Parallel sub-agents |
| < 10 files, single subsystem | Serial — read focused file list directly |

## Parallel Sub-Agent Execution (after Haiku pre-tasks)

1. Launch with `run_in_background: true`:
   - **Subagent A** (`subagent_type: feature-dev:code-explorer`): trace execution paths, map affected components and dependencies. Provide the file list from Haiku pre-tasks as explicit scope.
   - **Subagent B** (`subagent_type: general-purpose`): read git log, recent commits, find related PRs/issues
   - **Subagent C** (`subagent_type: general-purpose`, only if library docs needed): query context7 for framework APIs
2. After all complete, merge findings into a unified set of outcomes.
3. Where sub-agents disagreed or had incomplete evidence, set `confidence: medium` or lower.

**Skip parallel for simple tasks** (< 10 files, single subsystem) — overhead is not worth it. Use Haiku file inventory, then read files directly.

## Connector Usage (ordered by preference)

1. **context7** — library/framework documentation and API references
2. **git / github** — commit history, issues, PRs, prior work
3. **filesystem** — existing source files, configs, test patterns
4. **google-stitch** — UI/frontend design patterns *(best-effort; skip if unavailable)*

All connectors are non-critical for this phase. If a connector fails:
1. Classify the error (auth, rate_limit, timeout, missing_resource, unknown)
2. Continue with available evidence
3. Mark affected findings with `confidence: low`
4. Add an entry to `connector_gaps` in the phase summary

## Output Contract

Before signaling phase complete, write the following artifacts:

**`phase-summary-research.json`** (required) — exact shape, no extra fields:

```json
{
  "summary_id": "research-<run-id>",
  "run_id": "<run-id>",
  "phase": "research",
  "status": "completed",
  "created_at": "2026-01-01T00:00:00.000Z",
  "outcomes": ["at least one string"],
  "open_risks": [
    { "id": "R1", "description": "...", "severity": "high|medium|low" }
  ],
  "unresolved_decisions": [
    { "id": "D1", "description": "...", "options": ["opt1"] }
  ],
  "connector_gaps": [
    { "connector": "...", "operation": "...", "error_class": "auth|rate_limit|timeout|missing_resource|unknown", "affected_findings": "..." }
  ],
  "token_summary": { "tokens_used": 12345, "peak_threshold_hit": null }
}
```

`open_risks`, `unresolved_decisions`, `connector_gaps` are arrays of **objects**, never strings. Use `[]` for empty arrays.

**`phase-summary-research.md`** (required):
- Executive summary (2–4 sentences)
- Key findings with confidence level
- Open risks (if any)
- Connector gaps (if any)
- Recommended focus areas for planning

Validate `phase-summary-research.json` before writing:
```bash
npx tsx src/validator.ts phase-summary <run-dir>/phase-summary-research.json
```

Also update `decision-log.json` with any new open decisions and `retrieval-index.json` with new artifact entries (set `confidence`, leave `relevance_score: 0` — the Orchestrator sets it).

## Stop Conditions

- A critical connector fails (none are critical for research — all failures are graceful degrades)
- Task scope is so ambiguous that research cannot proceed without human clarification
- Token emergency threshold (80% of phase_max) is reached mid-phase
