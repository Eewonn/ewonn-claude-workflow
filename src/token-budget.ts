import type { TokenPolicy, TokenThreshold } from './types.js';

/**
 * Returns the highest-priority threshold currently triggered, or null if below warn threshold.
 * Priority: emergency > compress > warn > null
 */
export function checkThreshold(
  tokensUsed: number,
  policy: TokenPolicy,
  maxTokens: number,
): TokenThreshold | null {
  const ratio = tokensUsed / maxTokens;
  if (ratio >= policy.emergency_at) return 'emergency';
  if (ratio >= policy.compress_at) return 'compress';
  if (ratio >= policy.warn_at) return 'warn';
  return null;
}

/** Returns true if the compress threshold is currently active. */
export function shouldCompress(
  tokensUsed: number,
  policy: TokenPolicy,
  maxTokens: number,
): boolean {
  return tokensUsed / maxTokens >= policy.compress_at;
}

/** Returns true if the emergency threshold is currently active. */
export function shouldEmergency(
  tokensUsed: number,
  policy: TokenPolicy,
  maxTokens: number,
): boolean {
  return tokensUsed / maxTokens >= policy.emergency_at;
}

/**
 * Returns a single-line budget status string for display or logging.
 * Example: "[TOKEN] phase: 34,200 / 80,000 (42.8%) — WARN threshold active"
 */
export function formatBudgetStatus(
  tokensUsed: number,
  policy: TokenPolicy,
  maxTokens: number,
): string {
  const pct = ((tokensUsed / maxTokens) * 100).toFixed(1);
  const used = tokensUsed.toLocaleString();
  const max = maxTokens.toLocaleString();
  const threshold = checkThreshold(tokensUsed, policy, maxTokens);
  const suffix = threshold ? ` — ${threshold.toUpperCase()} threshold active` : '';
  return `[TOKEN] phase: ${used} / ${max} (${pct}%)${suffix}`;
}

/** Estimate token count from a string using the character/4 heuristic. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
