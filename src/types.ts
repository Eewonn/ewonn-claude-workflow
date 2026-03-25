/**
 * Shared TypeScript types for the workflow orchestration system.
 *
 * IMPORT CONVENTION (NodeNext ESM): All relative imports in TypeScript source
 * must use the .js extension, even when importing .ts files.
 * Example: import { RunState } from './types.js'
 */

// ---------------------------------------------------------------------------
// Primitive union types
// ---------------------------------------------------------------------------

export type RunStatus =
  | 'initializing'
  | 'running'
  | 'checkpoint_pending'
  | 'rollback_pending'
  | 'blocked'
  | 'completed'
  | 'failed';

export type Phase = 'research' | 'plan' | 'implement' | 'validate';

export type ValidationProfile = 'strict' | 'balanced' | 'fast';

export type ValidationVerdict = 'pass' | 'pass_with_risks' | 'fail';

export type Confidence = 'high' | 'medium' | 'low';

export type TokenThreshold = 'warn' | 'compress' | 'emergency';

export type ConnectorErrorClass =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'missing_resource'
  | 'unknown';

export type AgentName =
  | 'OrchestratorAgent'
  | 'ResearchAgent'
  | 'PlannerAgent'
  | 'ImplementerAgent'
  | 'ValidatorAgent';

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'blocked'
  | 'skipped';

export type RiskSeverity = 'high' | 'medium' | 'low';

export type FailureSeverity = 'critical' | 'major' | 'minor';

export type ChangeTargetType = 'config' | 'prompt' | 'skill' | 'process';

export type ArtifactStatus = 'active' | 'superseded' | 'archived';

export type ConnectorScope = 'full' | 'reduced';

export type FinalRunStatus = 'completed' | 'blocked' | 'failed';

// ---------------------------------------------------------------------------
// Token policy
// ---------------------------------------------------------------------------

export interface TokenPolicy {
  phase_max: number;
  run_max: number;
  warn_at: number;    // fraction 0–1
  compress_at: number;
  emergency_at: number;
}

// ---------------------------------------------------------------------------
// Core memory artifact interfaces
// ---------------------------------------------------------------------------

export interface CheckpointRecord {
  phase: Phase;
  approved: boolean;
  timestamp: string;  // ISO date-time
  reason?: string;
}

export interface RollbackMetadata {
  reason: string;
  failed_step: string;
  restored_at: string;  // ISO date-time
}

export interface TokenUsage {
  phase_tokens: number;
  run_tokens: number;
  last_threshold_triggered: TokenThreshold | null;
}

export interface RunState {
  run_id: string;
  status: RunStatus;
  current_phase: Phase | null;
  profile: ValidationProfile;
  phases_completed: Phase[];
  created_at: string;
  updated_at: string;
  token_usage: TokenUsage;
  checkpoint_history: CheckpointRecord[];
  active_risks: string[];
  unresolved_decisions: string[];  // decision IDs
  rollback_metadata: RollbackMetadata | null;
  run_dir: string;
}

export interface RiskEntry {
  id: string;
  description: string;
  severity: RiskSeverity;
}

export interface DecisionEntry {
  id: string;
  description: string;
  options?: string[];
}

export interface ConnectorGap {
  connector: string;
  operation: string;
  error_class: ConnectorErrorClass;
  affected_findings: string;
}

export interface PhaseSummaryTokenSummary {
  tokens_used: number;
  peak_threshold_hit: TokenThreshold | null;
}

export interface PhaseSummary {
  summary_id: string;
  run_id: string;
  phase: Phase;
  status: 'completed' | 'blocked' | 'failed';
  outcomes: string[];  // minItems: 1
  open_risks: RiskEntry[];
  unresolved_decisions: DecisionEntry[];
  connector_gaps: ConnectorGap[];
  token_summary: PhaseSummaryTokenSummary;
  created_at: string;
}

export interface DecisionLogEntry {
  id: string;
  phase: Phase;
  description: string;
  options?: string[];
  chosen_option?: string;
  rationale?: string;
  status: 'open' | 'resolved' | 'deferred';
  risk_level: RiskSeverity;
  created_at: string;
  resolved_at?: string;  // required when status=resolved (code-level check)
}

export interface DecisionLog {
  log_id: string;
  run_id: string;
  entries: DecisionLogEntry[];
}

export interface TaskEntry {
  id: string;
  title: string;
  phase: Phase;
  status: TaskStatus;
  dependencies?: string[];
  assigned_agent: AgentName;
  created_at: string;
  updated_at: string;
  completion_notes?: string;
  batch_index?: number;
}

export interface TaskState {
  task_log_id: string;
  run_id: string;
  tasks: TaskEntry[];
  current_batch_index: number;
}

export interface RetrievalIndexEntry {
  id: string;
  artifact_path: string;
  run_id: string;
  phase: Phase;
  task_ids: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
  confidence: Confidence;
  relevance_score: number;  // 0–1
  token_weight: number;     // estimated token size (integer)
  dependencies: string[];
  status: ArtifactStatus;
}

export interface RetrievalIndex {
  index_id: string;
  run_id: string;
  entries: RetrievalIndexEntry[];
  last_updated: string;
}

// ---------------------------------------------------------------------------
// Improvement loop interfaces
// ---------------------------------------------------------------------------

export interface PhaseMetrics {
  tokens_used: number;
  duration_seconds: number;
  checkpoint_count: number;
}

export interface FailureRecord {
  type: string;
  phase: Phase;
  severity: FailureSeverity;
  root_cause: string;
  resolution_attempted: boolean;
}

export interface PromptIssue {
  template: string;
  issue: string;
  severity: RiskSeverity;
}

export interface SkillGap {
  skill_name: string;
  gap_description: string;
}

export interface RecommendedChange {
  target_type: ChangeTargetType;
  target: string;
  description: string;
  priority: RiskSeverity;
}

export interface RunRetrospective {
  run_id: string;
  profile: ValidationProfile;
  final_status: FinalRunStatus;
  phase_metrics: Record<Phase, PhaseMetrics>;
  failures: FailureRecord[];
  blocked_reasons: string[];
  successful_patterns: string[];
  prompt_issues: PromptIssue[];
  skill_gaps: SkillGap[];
  recommended_changes: RecommendedChange[];
  created_at: string;
}

export interface BlockerCluster {
  cluster_name: string;
  frequency: number;
  affected_phases: Phase[];
  example_run_ids: string[];
}

export interface ProfileStats {
  run_count: number;
  avg_tokens: number;
  avg_duration_seconds: number;
  pass_rate: number;
}

export interface TokenEfficiencyPoint {
  week_offset: number;
  avg_phase_tokens: number;
  compress_trigger_rate: number;
}

export interface PromptChange {
  template: string;
  change_description: string;
  priority: RiskSeverity;
  affected_runs: string[];
}

export interface SkillChange {
  skill_name: string;
  change_description: string;
  priority: RiskSeverity;
}

export interface ApprovedAction {
  action_id: string;
  type: ChangeTargetType;
  target: string;
  description: string;
  approved_by: string;
  approved_at: string;
}

export interface WeeklySynthesis {
  synthesis_id: string;
  window_start: string;
  window_end: string;
  run_count: number;
  run_ids: string[];
  blocker_clusters: BlockerCluster[];
  profile_comparison: Partial<Record<ValidationProfile, ProfileStats>>;
  token_efficiency_trends: TokenEfficiencyPoint[];
  top_prompt_changes: PromptChange[];
  top_skill_changes: SkillChange[];
  expected_impact: string;
  approved_actions: ApprovedAction[];
  created_at: string;
}

export interface ImprovementDeployment {
  deployment_id: string;
  window_start: string;
  window_end: string;
  actions_reviewed: number;
  actions_approved: number;
  actions_applied: number;
  actions_failed: number;
  affected_files: string[];
  validation_result: 'pass' | 'fail';
  rollback_required: boolean;
  approver: string;
  applied_at: string;
}

// ---------------------------------------------------------------------------
// Config interfaces
// ---------------------------------------------------------------------------

export interface VerdictRules {
  allow_pass_with_risks: boolean;
  require_all_checks: boolean;
  max_open_risks: number;
  max_unresolved_decisions: number;
}

export interface ProfileConfig {
  profile: ValidationProfile;
  verdict_rules: VerdictRules;
  token_policy_overrides: Partial<TokenPolicy>;
  batch_size_factor: number;
  connector_scope: ConnectorScope;
  notes?: string;
}

export interface RetrievalConfig {
  preload_token_budget: number;
  always_include_unresolved_risks: boolean;
  always_include_latest_decisions: boolean;
  max_entries_per_query: number;
  mandatory_context_token_limit: number;
}

export interface ConnectorFailurePolicy {
  auto_retry: boolean;
  critical_connectors_by_phase: Record<Phase, string[]>;
}

export interface WeeklySynthesisConfig {
  trigger: 'manual' | 'auto';
  min_runs_required: number;
}

export interface ImprovementLoopConfig {
  generate_retrospective: boolean;
  retrospective_on_blocked: boolean;
  retrospective_on_failed: boolean;
}

export interface GlobalConfig {
  schema_version: string;
  default_profile: ValidationProfile;
  run_id_format: string;
  runs_dir: string;
  eval_dir: string;
  memory_schema_dir: string;
  memory_templates_dir: string;
  token_policy: TokenPolicy;
  retrieval: RetrievalConfig;
  connector_failure_policy: ConnectorFailurePolicy;
  weekly_synthesis: WeeklySynthesisConfig;
  improvement_loop: ImprovementLoopConfig;
}

// ---------------------------------------------------------------------------
// Orchestrator internal types
// ---------------------------------------------------------------------------

export interface OrchestratorContext {
  runId: string;
  phase: Phase;
  profile: ValidationProfile;
  runDir: string;
}

export interface CheckpointResult {
  approved: boolean;
  reason?: string;
}

export interface RollbackReport {
  reason: string;
  failed_step: string;
  restored_phase: Phase;
  required_action: string;
  rolled_back_at: string;
}

// ---------------------------------------------------------------------------
// Memory store / retrieval types
// ---------------------------------------------------------------------------

export interface WriteResult {
  success: boolean;
  errors?: string[];
}

export interface RetrievalQuery {
  phase: Phase;
  task_ids?: string[];
  token_budget: number;
}

export interface RetrievalResult {
  entries: RetrievalIndexEntry[];
  total_tokens: number;
}

// ---------------------------------------------------------------------------
// Validator types
// ---------------------------------------------------------------------------

export interface AjvError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: AjvError[] | null;
  schemaName: string;
  filePath?: string;
}
