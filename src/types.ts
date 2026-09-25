export type ProviderName = "claude" | "codex";
export type JobState = "received" | "analyzing" | "proposing" | "implementing" | "validating" | "published" | "skipped" | "failed";
export type JobKind = "repository_scan" | "public_discovery" | "merge_evaluation";
export type FindingCategory = "tests" | "docs" | "dependencies" | "lint" | "type_safety" | "small_bugfix";
export type MergeStatus = "ready" | "pending_checks" | "blocked" | "conflicted" | "unknown";

export interface BotPolicy {
  version: 1;
  enabled: boolean;
  provider: ProviderName;
  mode: "suggest" | "pull_request";
  categories: FindingCategory[];
  include: string[];
  exclude: string[];
  commands: { test: string | null; lint: string | null };
  limits: { maxFiles: number; maxChangedLines: number };
}

export interface AnalysisInput {
  owner: string;
  repo: string;
  commitSha: string;
  workspace: string;
  policy: BotPolicy;
  projectType: string;
}

export interface Finding {
  category: FindingCategory;
  title: string;
  rationale: string;
  evidence: string[];
  confidence: number;
  severity: "low" | "medium";
  affectedFiles: string[];
}

export interface AnalysisResult {
  findings: Finding[];
  summary?: string;
}

export interface ImplementationInput extends AnalysisInput {
  finding: Finding;
}

export interface ImplementationResult {
  summary: string;
  changedFiles: string[];
  changedLines: number;
}

export interface ValidationResult {
  command: string;
  exitCode: number | null;
  output: string;
  passed: boolean;
}

export interface AgentProvider {
  analyze(input: AnalysisInput): Promise<AnalysisResult>;
  implement(input: ImplementationInput): Promise<ImplementationResult>;
}

export interface MergeInput {
  draft: boolean;
  mergeable: boolean | null;
  baseMatches: boolean;
  checks: Array<{ name: string; conclusion: string | null }>;
  approvals: { required: number; current: number };
}

export interface MergeResult {
  status: MergeStatus;
  reasons: string[];
}

export interface JobRecord {
  id: string;
  installationId?: number;
  owner: string;
  repo: string;
  commitSha?: string;
  kind: JobKind;
  state: JobState;
  payload: Record<string, unknown>;
}
