import { minimatch } from "minimatch";
import { z } from "zod";
import { BotPolicy, FindingCategory, ProviderName } from "./types.js";
import YAML from "yaml";

const categories: FindingCategory[] = ["tests", "docs", "dependencies", "lint", "type_safety", "small_bugfix"];
const protectedGlobs = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  ".github/workflows/**",
  "**/Dockerfile",
  "**/docker-compose*.yml",
  "**/docker-compose*.yaml",
  "terraform/**",
  "infra/**",
  "deploy/**",
  "migrations/**",
  "**/generated/**",
];

const rawSchema = z.object({
  version: z.literal(1).default(1),
  enabled: z.boolean().default(false),
  provider: z.enum(["claude", "codex"]).default("codex"),
  mode: z.enum(["suggest", "pull_request"]).default("pull_request"),
  categories: z.array(z.enum(categories as [FindingCategory, ...FindingCategory[]])).default(categories),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  commands: z.object({ test: z.string().nullable().default(null), lint: z.string().nullable().default(null) }).default({}),
  limits: z.object({ max_files: z.number().int().positive().default(10), max_changed_lines: z.number().int().positive().default(300) }).default({}),
});

export function defaultPolicy(): BotPolicy {
  return {
    version: 1,
    enabled: false,
    provider: "codex",
    mode: "pull_request",
    categories,
    include: [],
    exclude: [...protectedGlobs],
    commands: { test: null, lint: null },
    limits: { maxFiles: 10, maxChangedLines: 300 },
  };
}

export function parsePolicy(source: string | undefined): BotPolicy {
  if (!source?.trim()) return defaultPolicy();
  const parsed = rawSchema.parse(YAML.parse(source));
  return {
    version: parsed.version,
    enabled: parsed.enabled,
    provider: parsed.provider as ProviderName,
    mode: parsed.mode,
    categories: parsed.categories as FindingCategory[],
    include: parsed.include,
    exclude: [...protectedGlobs, ...parsed.exclude],
    commands: parsed.commands,
    limits: { maxFiles: parsed.limits.max_files, maxChangedLines: parsed.limits.max_changed_lines },
  };
}

export function isProtectedPath(path: string): boolean {
  return !isSafeRelativePath(path) || protectedGlobs.some((glob) => minimatch(path, glob, { dot: true }));
}

export function isSafeRelativePath(path: string): boolean {
  if (!path || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
  const parts = path.split("/");
  return !parts.includes("..") && parts.every((part) => part !== "");
}

export function isAllowedPath(policy: BotPolicy, path: string): boolean {
  if (isProtectedPath(path)) return false;
  if (policy.exclude.some((glob) => minimatch(path, glob, { dot: true }))) return false;
  return policy.include.length === 0 || policy.include.some((glob) => minimatch(path, glob, { dot: true }));
}

export function canPublishPatch(policy: BotPolicy, files: string[], changedLines: number): boolean {
  return files.length > 0 &&
    files.length <= policy.limits.maxFiles &&
    changedLines <= policy.limits.maxChangedLines &&
    files.every((file) => isAllowedPath(policy, file));
}

export function selectFinding(policy: BotPolicy, findings: Array<import("./types.js").Finding>): import("./types.js").Finding | undefined {
  return findings
    .filter((finding) => policy.categories.includes(finding.category))
    .filter((finding) => finding.confidence >= 0.75)
    .filter((finding) => finding.affectedFiles.every((file) => isAllowedPath(policy, file)))
    .sort((a, b) => b.confidence - a.confidence)[0];
}
