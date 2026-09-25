import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "./db.js";
import { GitHubClient, StaleBaseError } from "./github.js";
import { canPublishPatch, selectFinding } from "./policy.js";
import { AgentProvider } from "./types.js";
import { createWorkspace, removeWorkspace, Sandbox } from "./sandbox.js";
import { JobRecord, ValidationResult } from "./types.js";
import { evaluateMergeReadiness } from "./merge.js";

export class MaintenanceWorkflow {
  constructor(private readonly db: Database, private readonly github: GitHubClient, private readonly providers: Record<string, AgentProvider>, private readonly sandbox: Sandbox) {}

  async run(job: JobRecord): Promise<void> {
    if (job.kind === "merge_evaluation") {
      await this.evaluateMerge(job);
      return;
    }
    if (job.kind !== "repository_scan" || !job.installationId || !job.commitSha) {
      await this.db.setState(job.id, "skipped");
      return;
    }
    const client = await this.github.installationClient(job.installationId);
    const workspace = await createWorkspace();
    try {
      const policy = await this.github.readPolicy(client, job.owner, job.repo, job.commitSha);
      if (!policy.enabled || policy.mode !== "pull_request") { await this.db.setState(job.id, "skipped"); return; }
      await this.github.downloadWorkspace(client, job.owner, job.repo, job.commitSha, workspace);
      const provider = this.providers[policy.provider];
      if (!provider) throw new Error(`provider ${policy.provider} is not configured`);
      await this.db.audit(job.id, "analysis_started", { provider: policy.provider, commitSha: job.commitSha });
      const analysis = await provider.analyze({ owner: job.owner, repo: job.repo, commitSha: job.commitSha, workspace, policy, projectType: await detectProjectType(workspace) });
      await this.db.setState(job.id, "proposing");
      const finding = selectFinding(policy, analysis.findings);
      if (!finding) { await this.db.setState(job.id, "skipped"); return; }
      await this.db.recordFinding(job.id, finding);
      await this.db.audit(job.id, "finding_selected", { title: finding.title, category: finding.category });
      await this.db.setState(job.id, "implementing");
      const before = await snapshot(workspace);
      const implementation = await provider.implement({ owner: job.owner, repo: job.repo, commitSha: job.commitSha, workspace, policy, projectType: await detectProjectType(workspace), finding });
      const after = await snapshot(workspace);
      const diff = diffSnapshots(before, after);
      if (diff.deletedFiles.length > 0 || !canPublishPatch(policy, diff.changedFiles, diff.changedLines)) { await this.db.setState(job.id, "skipped", "patch exceeded policy limits, deleted files, or touched a protected path"); return; }
      await this.db.setState(job.id, "validating");
      const validations = await runValidations(policy.commands, workspace, this.sandbox);
      for (const validation of validations) await this.db.recordValidation(job.id, validation);
      if (validations.some((validation) => !validation.passed)) { await this.db.setState(job.id, "skipped", "validation failed or was unavailable"); return; }
      const files = new Map<string, string>();
      for (const file of diff.changedFiles) files.set(file, await readFile(join(workspace, file), "utf8"));
      const base = String((job.payload.defaultBranch as string | undefined) ?? "main");
      const head = `bot/${job.commitSha.slice(0, 12)}/${finding.category}`;
      const pull = await this.github.createPullRequest(client, job.owner, job.repo, base, job.commitSha, head, `[bot] ${finding.title}`, buildPullBody(finding, { ...implementation, changedFiles: diff.changedFiles }, validations), files);
      await this.db.recordPullRequest(job.id, job.owner, job.repo, pull.number, pull.url);
      await this.db.audit(job.id, "pull_request_created", pull);
      await this.db.setState(job.id, "published");
    } catch (error) {
      await this.db.setState(job.id, error instanceof StaleBaseError ? "received" : "failed", error instanceof Error ? error.message : String(error));
      throw error;
    } finally { await removeWorkspace(workspace); }
  }

  private async evaluateMerge(job: JobRecord): Promise<void> {
    if (!job.installationId || typeof job.payload.pullNumber !== "number") { await this.db.setState(job.id, "skipped"); return; }
    try {
      const client = await this.github.installationClient(job.installationId);
      const base = String(job.payload.defaultBranch ?? "main");
      const input = await this.github.mergeInput(client, job.owner, job.repo, job.payload.pullNumber, base);
      const result = evaluateMergeReadiness(input);
      await this.db.recordPullRequest(job.id, job.owner, job.repo, job.payload.pullNumber, String(job.payload.pullUrl ?? ""), result.status, result.reasons);
      await this.github.commentOnPullRequest(client, job.owner, job.repo, job.payload.pullNumber, `### Merge readiness: \`${result.status}\`\n\n${result.reasons.length ? result.reasons.map((reason) => `- ${reason}`).join("\n") : "No blocking conditions detected."}\n\nThis status is informational; the bot never merges automatically.`);
      await this.db.audit(job.id, "merge_readiness_evaluated", { status: result.status, reasons: result.reasons, pullNumber: job.payload.pullNumber });
      await this.db.setState(job.id, "published");
    } catch (error) {
      await this.db.setState(job.id, "failed", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

async function detectProjectType(workspace: string): Promise<string> {
  const files = await readdir(workspace);
  if (files.includes("package.json")) return "node";
  if (files.includes("pyproject.toml") || files.includes("requirements.txt")) return "python";
  if (files.includes("pom.xml") || files.includes("build.gradle")) return "jvm";
  if (files.includes("go.mod")) return "go";
  return "unknown";
}

async function runValidations(commands: { test: string | null; lint: string | null }, workspace: string, sandbox: Sandbox): Promise<ValidationResult[]> {
  const configured = [commands.test, commands.lint].filter((command): command is string => Boolean(command));
  if (configured.length === 0) return [{ command: "none", exitCode: null, output: "No validation command configured", passed: false }];
  const results: ValidationResult[] = [];
  for (const command of configured) {
    try {
      const result = await sandbox.run("sh", ["-lc", command], workspace, Number(process.env.AGENT_TIMEOUT_MS ?? 600_000));
      results.push({ command, exitCode: result.exitCode, output: `${result.stdout}\n${result.stderr}`.slice(-10000), passed: result.exitCode === 0 });
    } catch (error) {
      results.push({ command, exitCode: null, output: error instanceof Error ? error.message : String(error), passed: false });
    }
  }
  return results;
}

async function snapshot(root: string, relative = ""): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) for (const [file, value] of await snapshot(root, path)) result.set(file, value);
    else if (entry.isFile()) result.set(path, (await readFile(join(root, path))).toString("base64"));
  }
  return result;
}

function diffSnapshots(before: Map<string, string>, after: Map<string, string>): { changedFiles: string[]; deletedFiles: string[]; changedLines: number } {
  const changedFiles = [...after.keys()].filter((file) => before.get(file) !== after.get(file));
  const deletedFiles = [...before.keys()].filter((file) => !after.has(file));
  const changedLines = changedFiles.reduce((total, file) => {
    const oldLines = (before.get(file) ? Buffer.from(before.get(file)!, "base64").toString("utf8") : "").split(/\r?\n/).length;
    const newLines = Buffer.from(after.get(file)!, "base64").toString("utf8").split(/\r?\n/).length;
    return total + Math.max(oldLines, newLines);
  }, 0);
  return { changedFiles, deletedFiles, changedLines };
}

function buildPullBody(finding: { title: string; rationale: string; evidence: string[]; category: string }, implementation: { summary: string; changedFiles: string[] }, validations: ValidationResult[]): string {
  const checks = validations.map((result) => `- \`${result.command}\`: ${result.passed ? "passed" : "failed"}`).join("\n");
  return `## Automated maintenance proposal\n\n**Category:** ${finding.category}\n\n${finding.rationale}\n\n### Evidence\n${finding.evidence.map((item) => `- ${item}`).join("\n")}\n\n### Changes\n${implementation.summary}\n\nChanged files: ${implementation.changedFiles.map((file) => `\`${file}\``).join(", ")}\n\n### Validation\n${checks}\n\nThis PR was created by the Open Source Maintenance Bot. It does not merge automatically.`;
}
