/**
 * JSON schema validator CLI and importable module.
 *
 * CLI usage:
 *   npx tsx src/validator.ts <schema-name> <file-path>
 *
 * Exit codes:
 *   0 — valid
 *   1 — schema validation failed
 *   2 — usage error (wrong args, file not found, etc.)
 *   3 — semantic validation failed (cross-field logic)
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import type { ValidationResult, AjvError } from './types.js';

const SCHEMA_NAMES = [
  'run-state',
  'phase-summary',
  'decision-log',
  'task-state',
  'retrieval-index',
  'run-retrospective',
  'weekly-synthesis',
  'improvement-deployment',
] as const;

export type SchemaName = (typeof SCHEMA_NAMES)[number];

export interface AjvValidator {
  validate(schemaName: string, data: unknown): ValidationResult;
  validateFile(schemaName: string, filePath: string): Promise<ValidationResult>;
}

/**
 * Create an AJV validator instance with all 8 schemas loaded from `schemaDir`.
 */
export function createValidator(schemaDir: string): AjvValidator {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  // Load all schema files from the schema directory
  const files = readdirSync(schemaDir).filter((f) => f.endsWith('.schema.json'));
  for (const file of files) {
    const schemaPath = join(schemaDir, file);
    const raw = readFileSync(schemaPath);
    const schema = JSON.parse(raw.toString('utf-8')) as { $id: string };
    ajv.addSchema(schema, schema.$id);
  }

  function validate(schemaName: string, data: unknown): ValidationResult {
    const valid = ajv.validate(schemaName, data) as boolean;
    return {
      valid,
      errors: valid ? null : (ajv.errors as AjvError[]),
      schemaName,
    };
  }

  async function validateFile(schemaName: string, filePath: string): Promise<ValidationResult> {
    const raw = await readFile(filePath, 'utf-8');
    const data: unknown = JSON.parse(raw);
    const result = validate(schemaName, data);
    return { ...result, filePath };
  }

  return { validate, validateFile };
}

// ---------------------------------------------------------------------------
// Synchronous file reader (used during validator initialization only)
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: npx tsx src/validator.ts <schema-name> <file-path>');
    console.error(`Available schemas: ${SCHEMA_NAMES.join(', ')}`);
    process.exit(2);
  }

  const [schemaName, filePath] = args as [string, string];
  const projectRoot = resolve(fileURLToPath(import.meta.url), '..', '..');

  // Load global config to find schema dir
  let schemaDir: string;
  try {
    const cfgRaw = readFileSync(join(projectRoot, 'configs', 'global.json')).toString('utf-8');
    const cfg = JSON.parse(cfgRaw) as { memory_schema_dir: string };
    schemaDir = join(projectRoot, cfg.memory_schema_dir);
  } catch {
    schemaDir = join(projectRoot, 'memory', 'schema');
  }

  const validator = createValidator(schemaDir);

  let result: ValidationResult;
  try {
    result = await validator.validateFile(schemaName, filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`ERROR: ${msg}`);
    process.exit(2);
  }

  if (result.valid) {
    console.log(`VALID: ${schemaName} at ${filePath}`);
    process.exit(0);
  } else {
    console.error(`INVALID: ${schemaName} at ${filePath}`);
    for (const error of result.errors ?? []) {
      const path = error.instancePath || '/';
      console.error(`  ${path}: ${error.message ?? error.keyword}`);
    }
    process.exit(1);
  }
}

// Run if this is the CLI entry point.
// Use fileURLToPath to handle spaces in paths (new URL().pathname would URL-encode them).
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
