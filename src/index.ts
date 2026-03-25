/**
 * ewonn-claude-workflow — help and entry point
 *
 * This file prints help text. All real logic lives in orchestrator.ts and validator.ts.
 */

console.log(`
ewonn-claude-workflow — Hybrid AI Workflow Orchestration System
Pipeline: Research → Plan → Implement → Validate

─── TypeScript CLI Tools ──────────────────────────────────────────

Orchestrator (state machine):
  npx tsx src/orchestrator.ts init       --profile <strict|balanced|fast> [--run-id <id>]
  npx tsx src/orchestrator.ts status     [--run-dir <path>]
  npx tsx src/orchestrator.ts transition --to-phase <phase> [--run-dir <path>]
  npx tsx src/orchestrator.ts checkpoint --approved <true|false> --reason "<text>" [--run-dir <path>]
  npx tsx src/orchestrator.ts rollback   --reason "<text>" [--run-dir <path>]
  npx tsx src/orchestrator.ts compress   --phase <phase> --tokens-used <n> [--run-dir <path>]
  npx tsx src/orchestrator.ts finalize   --status <completed|failed> [--run-dir <path>]

Validator (JSON schema check):
  npx tsx src/validator.ts <schema-name> <file-path>

  Schemas: run-state, phase-summary, decision-log, task-state,
           retrieval-index, run-retrospective, weekly-synthesis,
           improvement-deployment

  Exit codes: 0=valid, 1=schema invalid, 2=usage error, 3=semantic invalid

─── Claude Code Skill ─────────────────────────────────────────────

  /workflow start [--profile <p>] [--run-id <id>]
  /workflow transition --to <phase>
  /workflow status
  /workflow compress
  /workflow checkpoint --approved <bool> --reason "<text>"
  /workflow validate
  /workflow retrospective
  /workflow weekly-synthesis

  See skills/workflow.md for the full skill reference.

─── Key Files ─────────────────────────────────────────────────────

  configs/global.json          Global token policy and path config
  configs/profiles/            strict / balanced (default) / fast
  memory/schema/               8 JSON schemas (all artifacts validated on write)
  memory/templates/            Empty starter artifacts copied at init
  agents/                      5 agent contract .md files
  templates/                   5 prompt template .md files
  runs/<run-id>/               Per-run artifacts (created by init)
  eval/                        Retrospectives and weekly synthesis outputs

─── Token Budget Defaults ─────────────────────────────────────────

  phase_max:  80,000 tokens   (40k for fast profile)
  run_max:   320,000 tokens
  warn:          40%
  compress:      60%  → generate micro-summary, trim context
  emergency:     80%  → reduce context aggressively

  Token counts are approximate (character/4 heuristic for retrieval index).
`);
