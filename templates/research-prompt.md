# Research Phase Prompt

## Context

- Run ID: `{{run_id}}`
- Profile: `{{profile}}`
- Task scope: `{{task_scope}}`
- Prior phase summary: `{{prior_phase_summary}}` *(none if first run)*

## Objective

Gather all evidence needed to understand the problem and inform a concrete implementation plan.

Produce findings with explicit confidence levels. Document every gap where a connector failure prevented complete evidence.

## Parallel Execution Strategy

**Use parallel subagents** when the task spans ≥ 2 independent subsystems or requires > 20 file reads:

1. Launch all subagents with `run_in_background: true`:
   - **Subagent A** (`subagent_type: Explore`): read source files, trace call paths, map affected components
   - **Subagent B** (`subagent_type: general-purpose`): read git log, recent commits, find related PRs/issues
   - **Subagent C** (`subagent_type: general-purpose`, only if library docs needed): query context7 for framework APIs
2. After all complete, merge findings into a unified set of outcomes.
3. Where subagents disagreed or had incomplete evidence, set `confidence: medium` or lower.

**Skip parallel for simple tasks** (< 10 files, single subsystem) — overhead is not worth it.

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

**`phase-summary-research.json`** (required):
- `summary_id`: generate a unique ID
- `outcomes`: at least one outcome string describing what was learned (non-empty)
- `open_risks`: all risks discovered during research
- `unresolved_decisions`: decisions that must be made before planning
- `connector_gaps`: any connector failures with error class and affected findings
- `token_summary.tokens_used`: approximate token count for this phase

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
