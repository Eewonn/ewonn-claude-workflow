import type {
  RetrievalIndexEntry,
  RetrievalQuery,
  RetrievalResult,
  Confidence,
  WriteResult,
} from '../types.js';
import { readArtifact, writeArtifact } from './store.js';

// Confidence → weight mapping
const CONFIDENCE_WEIGHT: Record<Confidence, number> = {
  high: 1.0,
  medium: 0.65,
  low: 0.3,
};

/**
 * Compute the relevance score for a retrieval index entry.
 *
 * Formula:
 *   confidence_weight × recency_factor × phase_match_bonus
 *   capped at 1.0
 *
 * recency_factor = 1 / (1 + age_in_hours / 24)
 *   → 1.0 if just updated, ~0.5 at 24h, ~0.2 at 96h
 *
 * phase_match_bonus = 1.2 if entry.phase === query.phase, else 1.0
 */
export function computeRelevanceScore(
  entry: RetrievalIndexEntry,
  query: RetrievalQuery,
  now: Date,
): number {
  const confidenceWeight = CONFIDENCE_WEIGHT[entry.confidence];
  const ageMs = now.getTime() - new Date(entry.updated_at).getTime();
  const ageInHours = ageMs / 3_600_000;
  const recencyFactor = 1 / (1 + ageInHours / 24);
  const phaseMatchBonus = entry.phase === query.phase ? 1.2 : 1.0;
  return Math.min(1.0, confidenceWeight * recencyFactor * phaseMatchBonus);
}

/**
 * Query the retrieval index at `indexPath`.
 *
 * Returns active entries filtered by phase and optional task_ids,
 * ranked by relevance score descending, accumulated until token_budget is reached.
 *
 * Unresolved risk and decision entries (identified by tags) are always prepended
 * and do not count toward the main token budget.
 */
export async function queryIndex(
  indexPath: string,
  query: RetrievalQuery,
): Promise<RetrievalResult> {
  const index = await readArtifact<{ entries: RetrievalIndexEntry[] }>(indexPath);
  const now = new Date();

  // Filter: active entries matching phase and (optionally) task_ids
  const active = index.entries.filter((e) => {
    if (e.status !== 'active') return false;
    if (e.phase !== query.phase) return false;
    if (query.task_ids && query.task_ids.length > 0) {
      const hasMatch = query.task_ids.some((id) => e.task_ids.includes(id));
      if (!hasMatch) return false;
    }
    return true;
  });

  // Separate mandatory context (risks/decisions) from ranked entries
  const mandatory = active.filter(
    (e) => e.tags.includes('risk') || e.tags.includes('decision'),
  );
  const ranked = active
    .filter((e) => !e.tags.includes('risk') && !e.tags.includes('decision'))
    .map((e) => ({
      entry: e,
      score: computeRelevanceScore(e, query, now),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tiebreaker: more recently updated first
      return new Date(b.entry.updated_at).getTime() - new Date(a.entry.updated_at).getTime();
    })
    .map((x) => x.entry);

  // Build result: mandatory first, then ranked up to token budget
  const result: RetrievalIndexEntry[] = [...mandatory];
  let tokensAccumulated = mandatory.reduce((s, e) => s + e.token_weight, 0);

  for (const entry of ranked) {
    if (tokensAccumulated + entry.token_weight > query.token_budget) break;
    result.push(entry);
    tokensAccumulated += entry.token_weight;
  }

  return { entries: result, total_tokens: tokensAccumulated };
}

/**
 * Update (upsert) a single entry in the retrieval index.
 * If an entry with the same `id` exists, it is replaced. Otherwise appended.
 */
export async function updateIndexEntry(
  indexPath: string,
  entry: RetrievalIndexEntry,
): Promise<WriteResult> {
  const index = await readArtifact<{
    index_id: string;
    run_id: string;
    entries: RetrievalIndexEntry[];
    last_updated: string;
  }>(indexPath);

  const idx = index.entries.findIndex((e) => e.id === entry.id);
  if (idx >= 0) {
    index.entries[idx] = entry;
  } else {
    index.entries.push(entry);
  }

  index.last_updated = new Date().toISOString();
  return writeArtifact(indexPath, 'retrieval-index', index);
}

/**
 * Build a context pack (ordered list of entries) from a retrieval result,
 * trimmed to fit within `tokenBudget`.
 */
export function buildContextPack(
  result: RetrievalResult,
  tokenBudget: number,
): RetrievalIndexEntry[] {
  const pack: RetrievalIndexEntry[] = [];
  let total = 0;
  for (const entry of result.entries) {
    if (total + entry.token_weight > tokenBudget) break;
    pack.push(entry);
    total += entry.token_weight;
  }
  return pack;
}
