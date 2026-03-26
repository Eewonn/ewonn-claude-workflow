/**
 * State machine CLI for workflow run management.
 *
 * Usage: npx tsx src/orchestrator.ts <command> [options]
 *
 * Commands:
 *   init       --profile <p> [--run-id <id>] [--run-dir <path>]
 *   status     [--run-dir <dir>]
 *   transition --to-phase <phase> [--run-dir <dir>]
 *   checkpoint --approved <true|false> --reason <text> [--run-dir <dir>]
 *   rollback   --reason <text> [--run-dir <dir>]
 *   replan     --phase <phase> [--run-dir <dir>]
 *   compress   --phase <phase> --tokens-used <n> [--run-dir <dir>]
 *   finalize   --status <completed|failed> [--run-dir <dir>]
 */

import { readFile, writeFile, mkdir, cp, rename, rm, symlink, unlink } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import type {
  RunState,
  Phase,
  ValidationProfile,
  RollbackReport,
  RetrievalIndex,
} from './types.js';
import { writeArtifact, readArtifact, copyTemplate, ensureRunDir, loadGlobalConfig } from './memory/store.js';

// Use fileURLToPath to correctly handle spaces in directory paths.
const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(__filename), '..');

// ---------------------------------------------------------------------------
// Utility exports
// ---------------------------------------------------------------------------

/** Generate a run ID in the format YYYYMMDD-HHmmss-{6hex}. */
export function generateRunId(): string {
  const now = new Date();
  const date = now.toISOString().replace(/[-:T]/g, '').slice(0, 15).replace(/\./g, '');
  // YYYYMMDD-HHmmss
  const datePart = `${date.slice(0, 8)}-${date.slice(8, 14)}`;
  const hex = randomBytes(3).toString('hex');
  return `${datePart}-${hex}`;
}

const PHASE_ORDER: Phase[] = ['research', 'plan', 'implement', 'validate'];

export function phaseOrder(): Phase[] {
  return [...PHASE_ORDER];
}

/** Returns the next phase after `current`, or null if validate is complete. */
export function getNextPhase(current: Phase | null): Phase | null {
  if (current === null) return 'research';
  const idx = PHASE_ORDER.indexOf(current);
  if (idx === -1 || idx === PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[idx + 1] ?? null;
}

/** Return the absolute path to run-state.json within a run directory. */
export function resolveRunStatePath(runDir: string): string {
  return join(runDir, 'run-state.json');
}

/**
 * Atomically snapshot the current phase artifacts into <runDir>/snapshots/<phase>/.
 * Writes to a .tmp directory first, then renames for atomicity.
 */
export async function snapshotPhase(runDir: string, phase: Phase): Promise<void> {
  const snapshotTmp = join(runDir, 'snapshots', `${phase}.tmp`);
  const snapshotFinal = join(runDir, 'snapshots', phase);

  // Files to snapshot: run-state, phase-summary, decision-log, task-state
  const filesToSnapshot = [
    'run-state.json',
    `phase-summary-${phase}.json`,
    'decision-log.json',
    'task-state.json',
  ];

  await mkdir(snapshotTmp, { recursive: true });

  for (const file of filesToSnapshot) {
    const src = join(runDir, file);
    if (existsSync(src)) {
      await writeFile(
        join(snapshotTmp, file),
        await readFile(src),
      );
    }
  }

  // Atomic rename: back up old snapshot, rename tmp → final, then remove backup
  const bakDir = `${snapshotFinal}.bak`;
  if (existsSync(snapshotFinal)) {
    await cp(snapshotFinal, bakDir, { recursive: true });
  }
  await rename(snapshotTmp, snapshotFinal);
  // Clean up backup after successful rename so they don't accumulate
  if (existsSync(bakDir)) {
    await rm(bakDir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Helper: resolve run dir (defaults to runs/current symlink)
// ---------------------------------------------------------------------------

async function resolveRunDir(explicit?: string): Promise<string> {
  if (explicit) return resolve(explicit);
  const cfg = await loadGlobalConfig();
  const current = join(PROJECT_ROOT, cfg.runs_dir, 'current');
  if (!existsSync(current)) {
    throw new Error(
      'No --run-dir provided and runs/current symlink does not exist. Run `init` first.',
    );
  }
  return resolve(current);
}

// ---------------------------------------------------------------------------
// Command: init
// ---------------------------------------------------------------------------

async function cmdInit(args: Record<string, string>): Promise<void> {
  const cfg = await loadGlobalConfig();
  const profile = (args['profile'] ?? cfg.default_profile) as ValidationProfile;
  const runId = args['run-id'] ?? generateRunId();

  let runDir: string;
  if (args['run-dir']) {
    // Place run artifacts in the caller-specified directory (e.g. $PWD/.workflow/<run-id>)
    runDir = resolve(join(args['run-dir'], runId));
    await mkdir(join(runDir, 'snapshots'), { recursive: true });
  } else {
    runDir = await ensureRunDir(runId, cfg.runs_dir);
  }
  const now = new Date().toISOString();

  // Copy all templates into run dir
  const templates = [
    ['run-state.template.json', 'run-state.json'],
    ['phase-summary.template.json', `phase-summary-research.json`],
    ['decision-log.template.json', 'decision-log.json'],
    ['task-state.template.json', 'task-state.json'],
    ['retrieval-index.template.json', 'retrieval-index.json'],
  ];

  for (const [tmpl, dest] of templates) {
    await copyTemplate(tmpl!, join(runDir, dest!));
  }

  // Write initial run-state
  const runState: RunState = {
    run_id: runId,
    status: 'initializing',
    current_phase: null,
    pending_phase: null,
    profile,
    phases_completed: [],
    created_at: now,
    updated_at: now,
    token_usage: { phase_tokens: 0, run_tokens: 0, last_threshold_triggered: null },
    checkpoint_history: [],
    active_risks: [],
    unresolved_decisions: [],
    rollback_metadata: null,
    run_dir: runDir,
  };
  await writeArtifact(join(runDir, 'run-state.json'), 'run-state', runState);

  // Patch retrieval-index with run_id and timestamp
  const indexPath = join(runDir, 'retrieval-index.json');
  const idx = await readArtifact<RetrievalIndex>(indexPath);
  idx.index_id = `idx-${runId}`;
  idx.run_id = runId;
  idx.last_updated = now;
  await writeArtifact(indexPath, 'retrieval-index', idx);

  // Update runs/current symlink (atomic: create new then rename)
  const currentLink = join(PROJECT_ROOT, cfg.runs_dir, 'current');
  const tmpLink = join(PROJECT_ROOT, cfg.runs_dir, 'current.tmp');
  try { await unlink(tmpLink); } catch { /* ignore */ }
  await symlink(runDir, tmpLink);
  try { await unlink(currentLink); } catch { /* ignore */ }
  await rename(tmpLink, currentLink);

  console.log(`INIT: ${runDir} created with profile=${profile}`);
  console.log(`  run_dir: ${runDir}`);
  console.log(`  runs/current → ${runDir}`);
}

// ---------------------------------------------------------------------------
// Command: status
// ---------------------------------------------------------------------------

async function cmdStatus(args: Record<string, string>): Promise<void> {
  const runDir = await resolveRunDir(args['run-dir']);
  const state = await readArtifact<RunState>(join(runDir, 'run-state.json'));
  const idx = await readArtifact<RetrievalIndex>(join(runDir, 'retrieval-index.json'));

  const entriesByPhase = PHASE_ORDER.map((p) => ({
    phase: p,
    count: idx.entries.filter((e) => e.phase === p && e.status === 'active').length,
  }));

  console.log('\n── Run Status ──────────────────────────────');
  console.log(`  run_id:             ${state.run_id}`);
  console.log(`  status:             ${state.status}`);
  console.log(`  profile:            ${state.profile}`);
  console.log(`  current_phase:      ${state.current_phase ?? '(none)'}`);
  console.log(`  phases_completed:   [${state.phases_completed.join(', ')}]`);
  console.log(`  active_risks:       ${state.active_risks.length}`);
  console.log(`  unresolved_decisions: ${state.unresolved_decisions.length}`);
  console.log(`  token_usage:`);
  console.log(`    phase_tokens:     ${state.token_usage.phase_tokens.toLocaleString()}`);
  console.log(`    run_tokens:       ${state.token_usage.run_tokens.toLocaleString()}`);
  console.log(`    last_threshold:   ${state.token_usage.last_threshold_triggered ?? 'none'}`);
  console.log(`  checkpoints:        ${state.checkpoint_history.length}`);
  console.log(`  retrieval_index:`);
  for (const { phase, count } of entriesByPhase) {
    console.log(`    ${phase.padEnd(10)}: ${count} active entries`);
  }
  console.log('────────────────────────────────────────────\n');
}

// ---------------------------------------------------------------------------
// Command: transition
// ---------------------------------------------------------------------------

async function cmdTransition(args: Record<string, string>): Promise<void> {
  const toPhase = args['to-phase'] as Phase | undefined;
  if (!toPhase || !PHASE_ORDER.includes(toPhase)) {
    throw new Error(`--to-phase must be one of: ${PHASE_ORDER.join(', ')}`);
  }

  const runDir = await resolveRunDir(args['run-dir']);
  const statePath = join(runDir, 'run-state.json');
  const state = await readArtifact<RunState>(statePath);

  if (state.status !== 'running' && state.status !== 'initializing') {
    throw new Error(
      `Cannot transition: run status is "${state.status}", expected "running" or "initializing"`,
    );
  }

  // Snapshot current phase before transitioning
  if (state.current_phase) {
    await snapshotPhase(runDir, state.current_phase);
    console.log(`  Snapshot created: snapshots/${state.current_phase}/`);
  }

  const now = new Date().toISOString();
  state.status = 'checkpoint_pending';
  state.pending_phase = toPhase;
  state.updated_at = now;
  await writeArtifact(statePath, 'run-state', state);

  console.log('\n── Transition Protocol ─────────────────────');
  console.log(`  Phase: ${state.current_phase ?? '(start)'} → ${toPhase}`);
  console.log('  Status set to: checkpoint_pending');
  console.log('\n  Before checkpoint approval, complete all 5 steps:');
  console.log('  1. ✓ Summarize phase outcomes in phase-summary.json');
  console.log('  2. ✓ Persist summary, state, risks, unresolved decisions');
  console.log('  3. ✓ Clear active context (do not carry stale context forward)');
  console.log('  4. ✓ Reload minimal next-phase context pack');
  console.log('  5. → Present human checkpoint (APPROVE or DENY)');
  console.log('\n  Next: npx tsx src/orchestrator.ts checkpoint --approved <true|false> --reason "<text>"');
  console.log('────────────────────────────────────────────\n');
}

// ---------------------------------------------------------------------------
// Command: checkpoint
// ---------------------------------------------------------------------------

async function cmdCheckpoint(args: Record<string, string>): Promise<void> {
  const approved = args['approved'] === 'true';
  const reason = args['reason'] ?? '';

  const runDir = await resolveRunDir(args['run-dir']);
  const statePath = join(runDir, 'run-state.json');
  const state = await readArtifact<RunState>(statePath);

  if (state.status !== 'checkpoint_pending') {
    throw new Error(
      `Cannot process checkpoint: run status is "${state.status}", expected "checkpoint_pending"`,
    );
  }

  const now = new Date().toISOString();
  // Use pending_phase stored by `transition`, falling back to computed next phase
  const targetPhase: Phase | null = state.pending_phase ?? getNextPhase(state.current_phase);

  if (approved) {
    const completingPhase = state.current_phase;

    if (targetPhase === null && state.current_phase === 'validate') {
      // All phases done — mark validate complete and auto-finalize
      if (completingPhase && !state.phases_completed.includes(completingPhase)) {
        state.phases_completed.push(completingPhase);
      }
      state.pending_phase = null;
      state.status = 'completed';
      console.log('CHECKPOINT: approved — all phases complete, run finalized');
    } else if (targetPhase) {
      // Mark completing phase done, advance to target
      if (completingPhase && !state.phases_completed.includes(completingPhase)) {
        state.phases_completed.push(completingPhase);
      }
      state.current_phase = targetPhase;
      state.pending_phase = null;
      state.status = 'running';
      // Reset phase token counter on new phase
      state.token_usage.phase_tokens = 0;
      state.token_usage.last_threshold_triggered = null;
      console.log(`CHECKPOINT: approved — advancing to phase "${targetPhase}"`);
    } else {
      state.pending_phase = null;
      state.status = 'running';
      console.log('CHECKPOINT: approved — continuing current phase');
    }

    state.checkpoint_history.push({
      phase: state.current_phase ?? ('research' as Phase),
      approved: true,
      timestamp: now,
      reason: reason || 'approved',
    });
  } else {
    // Denied — trigger rollback
    state.checkpoint_history.push({
      phase: state.current_phase ?? ('research' as Phase),
      approved: false,
      timestamp: now,
      reason,
    });
    state.updated_at = now;
    await writeArtifact(statePath, 'run-state', state);

    console.log(`CHECKPOINT: denied — reason: ${reason}`);
    console.log('  Triggering rollback...');
    await cmdRollback({ reason: `checkpoint denied: ${reason}`, 'run-dir': runDir });
    return;
  }

  state.updated_at = now;
  await writeArtifact(statePath, 'run-state', state);
}

// ---------------------------------------------------------------------------
// Command: rollback
// ---------------------------------------------------------------------------

async function cmdRollback(args: Record<string, string>): Promise<void> {
  const reason = args['reason'] ?? 'unspecified';
  const runDir = await resolveRunDir(args['run-dir']);
  const statePath = join(runDir, 'run-state.json');
  const state = await readArtifact<RunState>(statePath);
  const now = new Date().toISOString();

  // Find the most recent valid snapshot to restore
  const snapshotsDir = join(runDir, 'snapshots');
  let restoredPhase: Phase | null = null;

  for (let i = PHASE_ORDER.length - 1; i >= 0; i--) {
    const phase = PHASE_ORDER[i]!;
    const snapshotDir = join(snapshotsDir, phase);
    if (existsSync(snapshotDir)) {
      restoredPhase = phase;

      // Restore snapshot files back to run dir
      const snapshotFiles = readdirSync(snapshotDir);
      for (const file of snapshotFiles) {
        await writeFile(join(runDir, file), await readFile(join(snapshotDir, file)));
      }
      break;
    }
  }

  if (!restoredPhase) {
    // No snapshot — restore to initial state
    state.status = 'blocked';
    state.current_phase = null;
    state.rollback_metadata = { reason, failed_step: 'no snapshot available', restored_at: now };
    state.updated_at = now;
    await writeArtifact(statePath, 'run-state', state);
  } else {
    // Re-read state after restoration (snapshot may have had different state)
    const restoredState = await readArtifact<RunState>(statePath);
    restoredState.status = 'blocked';
    restoredState.rollback_metadata = {
      reason,
      failed_step: `transition from ${restoredPhase}`,
      restored_at: now,
    };
    restoredState.updated_at = now;
    await writeArtifact(statePath, 'run-state', restoredState);
  }

  // Write rollback report
  const report: RollbackReport = {
    reason,
    failed_step: restoredPhase
      ? `transition from ${restoredPhase}`
      : 'no snapshot available — restored to initial state',
    restored_phase: restoredPhase ?? 'research',
    required_action: 'Review rollback report, resolve the issue, then restart from the restored phase.',
    rolled_back_at: now,
  };
  await writeFile(join(runDir, 'rollback-report.json'), JSON.stringify(report, null, 2) + '\n');

  console.log('\n── Rollback Report ─────────────────────────');
  console.log(`  Reason:          ${reason}`);
  console.log(`  Restored to:     ${restoredPhase ?? '(initial state)'}`);
  console.log(`  Failed step:     ${report.failed_step}`);
  console.log(`  Required action: ${report.required_action}`);
  console.log(`  Report written:  ${join(runDir, 'rollback-report.json')}`);
  console.log('────────────────────────────────────────────\n');
}

// ---------------------------------------------------------------------------
// Command: compress
// ---------------------------------------------------------------------------

async function cmdCompress(args: Record<string, string>): Promise<void> {
  const phase = args['phase'] as Phase | undefined;
  const tokensUsed = parseInt(args['tokens-used'] ?? '0', 10);

  if (!phase || !PHASE_ORDER.includes(phase)) {
    throw new Error(`--phase must be one of: ${PHASE_ORDER.join(', ')}`);
  }

  const runDir = await resolveRunDir(args['run-dir']);

  // Check that a micro-summary file exists for this phase before updating state
  const microSummaries = existsSync(runDir)
    ? readdirSync(runDir).filter(
        (f) => f.startsWith(`micro-summary-${phase}-`) && f.endsWith('.md'),
      )
    : [];

  if (microSummaries.length === 0) {
    const example = `micro-summary-${phase}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`;
    console.error(`COMPRESS ERROR: No micro-summary found for phase "${phase}".`);
    console.error(`  Before running compress, write a micro-summary file to:`);
    console.error(`    ${runDir}/${example}`);
    console.error(`  The micro-summary should capture: key findings, active decisions, open risks, current task scope.`);
    process.exit(1);
  }

  const statePath = join(runDir, 'run-state.json');
  const state = await readArtifact<RunState>(statePath);
  const now = new Date().toISOString();

  // Update token usage
  state.token_usage.phase_tokens = tokensUsed;
  state.token_usage.run_tokens += tokensUsed;
  state.token_usage.last_threshold_triggered = 'compress';
  state.updated_at = now;
  await writeArtifact(statePath, 'run-state', state);

  // Mark older retrieval index entries as superseded
  const indexPath = join(runDir, 'retrieval-index.json');
  const idx = await readArtifact<{
    index_id: string;
    run_id: string;
    entries: Array<{ phase: Phase; status: string; updated_at: string }>;
    last_updated: string;
  }>(indexPath);

  let supersededCount = 0;
  for (const entry of idx.entries) {
    if (entry.phase === phase && entry.status === 'active') {
      // Entries older than the current session (before today) are superseded
      const entryAge = Date.now() - new Date(entry.updated_at).getTime();
      if (entryAge > 60 * 60 * 1000) {
        // older than 1 hour
        entry.status = 'superseded';
        supersededCount++;
      }
    }
  }
  idx.last_updated = now;
  await writeArtifact(indexPath, 'retrieval-index', idx);

  console.log(`COMPRESS: phase="${phase}", tokens_used=${tokensUsed.toLocaleString()}`);
  console.log(`  Micro-summary found: ${microSummaries[0]}`);
  console.log(`  Superseded ${supersededCount} stale retrieval index entries`);
  console.log('  Next: trim stale context and continue with active scope only');
}

// ---------------------------------------------------------------------------
// Command: finalize
// ---------------------------------------------------------------------------

async function cmdFinalize(args: Record<string, string>): Promise<void> {
  const finalStatus = args['status'] as 'completed' | 'failed' | undefined;
  if (finalStatus !== 'completed' && finalStatus !== 'failed') {
    throw new Error('--status must be "completed" or "failed"');
  }

  const runDir = await resolveRunDir(args['run-dir']);
  const statePath = join(runDir, 'run-state.json');
  const state = await readArtifact<RunState>(statePath);
  const now = new Date().toISOString();

  if (finalStatus === 'completed' && state.phases_completed.length < 4) {
    console.warn(
      `Warning: finalizing as "completed" but only ${state.phases_completed.length}/4 phases are recorded as complete.`,
    );
  }

  state.status = finalStatus;
  state.updated_at = now;
  await writeArtifact(statePath, 'run-state', state);

  console.log(`FINALIZE: run ${state.run_id} → ${finalStatus}`);
  if (finalStatus === 'completed') {
    console.log('  Next: run `/workflow retrospective` to generate improvement artifacts');
  }
}

// ---------------------------------------------------------------------------
// Command: list
// ---------------------------------------------------------------------------

async function cmdList(_args: Record<string, string>): Promise<void> {
  const cfg = await loadGlobalConfig();
  const runsDir = join(PROJECT_ROOT, cfg.runs_dir);

  if (!existsSync(runsDir)) {
    console.log('No runs directory found.');
    return;
  }

  const entries = readdirSync(runsDir, { withFileTypes: true });
  const runDirs = entries
    .filter((e) => e.isDirectory() && /^\d{8}-\d{6}-[0-9a-f]{6}$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse(); // newest first

  if (runDirs.length === 0) {
    console.log('No runs found. Start one with: npx tsx src/orchestrator.ts init --profile balanced');
    return;
  }

  console.log('\n── Runs ──────────────────────────────────────────────────────────────');
  console.log('  RUN ID                    PROFILE    STATUS               PHASES');
  console.log('  ───────────────────────────────────────────────────────────────────');

  for (const runId of runDirs) {
    const statePath = join(runsDir, runId, 'run-state.json');
    if (!existsSync(statePath)) continue;
    try {
      const state = await readArtifact<RunState>(statePath);
      const phases = state.phases_completed.length > 0
        ? `[${state.phases_completed.join(', ')}]`
        : '(none)';
      const profile = state.profile.padEnd(10);
      const status = state.status.padEnd(20);
      console.log(`  ${runId}  ${profile} ${status} ${phases}`);
    } catch {
      console.log(`  ${runId}  (unreadable — run-state.json may be corrupt)`);
    }
  }
  console.log('─────────────────────────────────────────────────────────────────────\n');
}

// ---------------------------------------------------------------------------
// Command: replan
// ---------------------------------------------------------------------------

async function cmdReplan(args: Record<string, string>): Promise<void> {
  const phase = args['phase'] as Phase | undefined;
  if (!phase || !PHASE_ORDER.includes(phase)) {
    throw new Error(`--phase must be one of: ${PHASE_ORDER.join(', ')}`);
  }

  const runDir = await resolveRunDir(args['run-dir']);
  const statePath = join(runDir, 'run-state.json');
  const state = await readArtifact<RunState>(statePath);

  if (state.status !== 'blocked') {
    throw new Error(
      `Cannot replan: run status is "${state.status}", expected "blocked"`,
    );
  }

  const now = new Date().toISOString();
  state.status = 'checkpoint_pending';
  state.pending_phase = phase;
  state.updated_at = now;
  await writeArtifact(statePath, 'run-state', state);

  console.log(`REPLAN: status reset to "checkpoint_pending"`);
  console.log(`  Pending phase:   ${phase}`);
  console.log(`  Next: revise your plan, then run:`);
  console.log(`    wf checkpoint --approved true --reason "<reason>" --run-dir ${runDir}`);
}

// ---------------------------------------------------------------------------
// Command: abort
// ---------------------------------------------------------------------------

async function cmdAbort(args: Record<string, string>): Promise<void> {
  const reason = args['reason'] ?? 'user aborted';
  const runDir = await resolveRunDir(args['run-dir']);
  const statePath = join(runDir, 'run-state.json');
  const state = await readArtifact<RunState>(statePath);
  const now = new Date().toISOString();

  const terminalStatuses = ['completed', 'failed'];
  if (terminalStatuses.includes(state.status)) {
    throw new Error(`Cannot abort: run "${state.run_id}" is already ${state.status}.`);
  }

  state.status = 'failed';
  state.updated_at = now;
  state.rollback_metadata = {
    reason: `aborted: ${reason}`,
    failed_step: `aborted at phase ${state.current_phase ?? '(none)'}`,
    restored_at: now,
  };
  await writeArtifact(statePath, 'run-state', state);

  console.log(`\nABORT: run ${state.run_id} → failed`);
  console.log(`  Phase at abort: ${state.current_phase ?? '(none)'}`);
  console.log(`  Reason:         ${reason}`);
  console.log('  Run data preserved. Start fresh with: npx tsx src/orchestrator.ts init');
  console.log('');
}

// ---------------------------------------------------------------------------
// CLI argument parser
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { command: string; args: Record<string, string> } {
  const [command, ...rest] = argv;
  if (!command) throw new Error('No command provided');

  const args: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return { command, args };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('Usage: npx tsx src/orchestrator.ts <command> [options]');
    console.error('Commands: init, status, list, transition, checkpoint, rollback, replan, compress, finalize, abort');
    process.exit(2);
  }

  const { command, args } = parseArgs(argv);

  try {
    switch (command) {
      case 'init':       await cmdInit(args); break;
      case 'status':     await cmdStatus(args); break;
      case 'list':       await cmdList(args); break;
      case 'transition': await cmdTransition(args); break;
      case 'checkpoint': await cmdCheckpoint(args); break;
      case 'rollback':   await cmdRollback(args); break;
      case 'replan':     await cmdReplan(args); break;
      case 'compress':   await cmdCompress(args); break;
      case 'finalize':   await cmdFinalize(args); break;
      case 'abort':      await cmdAbort(args); break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error('Valid commands: init, status, list, transition, checkpoint, rollback, replan, compress, finalize, abort');
        process.exit(2);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`ERROR: ${msg}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
