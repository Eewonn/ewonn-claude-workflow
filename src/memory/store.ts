import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createValidator } from '../validator.js';
import type {
  GlobalConfig,
  ProfileConfig,
  TokenPolicy,
  ValidationProfile,
  WriteResult,
  DecisionLog,
} from '../types.js';

// Resolve project root relative to this file (src/memory/ → project root)
// Use fileURLToPath to correctly handle spaces in directory paths.
const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(__filename), '..', '..');

let _globalConfig: GlobalConfig | null = null;

/** Load and cache global config. */
export async function loadGlobalConfig(): Promise<GlobalConfig> {
  if (_globalConfig) return _globalConfig;
  const raw = await readFile(join(PROJECT_ROOT, 'configs', 'global.json'), 'utf-8');
  _globalConfig = JSON.parse(raw) as GlobalConfig;
  return _globalConfig;
}

/** Load a profile config by name. */
export async function loadProfileConfig(profile: ValidationProfile): Promise<ProfileConfig> {
  const raw = await readFile(
    join(PROJECT_ROOT, 'configs', 'profiles', `${profile}.json`),
    'utf-8',
  );
  return JSON.parse(raw) as ProfileConfig;
}

/** Merge global token policy with profile overrides (profile wins on defined keys). */
export function mergeTokenPolicy(
  global: TokenPolicy,
  overrides: Partial<TokenPolicy>,
): TokenPolicy {
  return { ...global, ...overrides };
}

/**
 * Read and parse a JSON artifact from disk.
 * Throws if the file does not exist or is not valid JSON.
 */
export async function readArtifact<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

/**
 * Validate `data` against `schemaName` and write it to `filePath` as JSON.
 * Never writes if schema validation fails — throws instead.
 *
 * Additional semantic checks performed before write:
 * - decision-log: entries with status=resolved must have resolved_at
 * - improvement-deployment: actions_applied + actions_failed <= actions_approved
 */
export async function writeArtifact<T>(
  filePath: string,
  schemaName: string,
  data: T,
): Promise<WriteResult> {
  const cfg = await loadGlobalConfig();
  const validator = createValidator(join(PROJECT_ROOT, cfg.memory_schema_dir));
  const result = validator.validate(schemaName, data);

  if (!result.valid) {
    const messages = (result.errors ?? [])
      .map((e) => `  ${e.instancePath || '/'} ${e.message ?? e.keyword}`)
      .join('\n');
    throw new Error(`Schema validation failed for ${schemaName}:\n${messages}`);
  }

  // Semantic checks
  if (schemaName === 'decision-log') {
    const log = data as unknown as DecisionLog;
    for (const entry of log.entries) {
      if (entry.status === 'resolved' && !entry.resolved_at) {
        throw new Error(
          `Semantic validation failed: decision-log entry "${entry.id}" has status=resolved but missing resolved_at`,
        );
      }
    }
  }

  if (schemaName === 'improvement-deployment') {
    const dep = data as Record<string, number>;
    if (dep['actions_applied'] + dep['actions_failed'] > dep['actions_approved']) {
      throw new Error(
        `Semantic validation failed: improvement-deployment actions_applied (${dep['actions_applied']}) + actions_failed (${dep['actions_failed']}) > actions_approved (${dep['actions_approved']})`,
      );
    }
  }

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  return { success: true };
}

/**
 * Copy a named template file into the destination path.
 * `templateName` should be the base name, e.g. "run-state.template.json".
 */
export async function copyTemplate(
  templateName: string,
  destPath: string,
): Promise<void> {
  const cfg = await loadGlobalConfig();
  const src = join(PROJECT_ROOT, cfg.memory_templates_dir, templateName);
  await mkdir(dirname(destPath), { recursive: true });
  await copyFile(src, destPath);
}

/**
 * Create the run directory at `<runsDir>/<runId>/` and return its absolute path.
 * `runsDir` is relative to project root (e.g. "runs").
 */
export async function ensureRunDir(runId: string, runsDir: string): Promise<string> {
  const absDir = join(PROJECT_ROOT, runsDir, runId);
  await mkdir(join(absDir, 'snapshots'), { recursive: true });
  return absDir;
}
