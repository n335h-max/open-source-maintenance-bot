import { Octokit } from "@octokit/rest";
import { sign } from "node:crypto";
import AdmZip from "adm-zip";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BotPolicy, MergeInput } from "./types.js";
import { parsePolicy } from "./policy.js";

export class GitHubClient {
  private readonly appId: string;
  private readonly privateKey: string;
  private readonly apiUrl: string;
  constructor(private readonly base = new Octokit({ auth: process.env.GITHUB_TOKEN, baseUrl: process.env.GITHUB_API_URL })) {
    this.appId = process.env.GITHUB_APP_ID ?? "";
    this.privateKey = process.env.GITHUB_PRIVATE_KEY ?? (process.env.GITHUB_PRIVATE_KEY_PATH ? readFileSync(process.env.GITHUB_PRIVATE_KEY_PATH, "utf8") : "");
    this.apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
  }

  async installationClient(installationId: number): Promise<Octokit> {
    if (!this.appId || !this.privateKey) throw new Error("GITHUB_APP_ID and GITHUB_PRIVATE_KEY are required");
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: this.appId }));
    const unsigned = `${header}.${payload}`;
    const assertion = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), { key: this.privateKey, dsaEncoding: "der" }).toString("base64url")}`;
    const response = await this.base.request("POST /app/installations/{installation_id}/access_tokens", { installation_id: installationId, headers: { authorization: `Bearer ${assertion}`, accept: "application/vnd.github+json" } });
    return new Octokit({ auth: response.data.token, baseUrl: this.apiUrl });
  }

  async readPolicy(client: Octokit, owner: string, repo: string, ref: string): Promise<BotPolicy> {
    try {
      const response = await client.repos.getContent({ owner, repo, path: ".github/open-source-bot.yml", ref });
      if (Array.isArray(response.data) || response.data.type !== "file") return parsePolicy(undefined);
      return parsePolicy(Buffer.from(response.data.content, "base64").toString("utf8"));
    } catch (error) {
      if (isNotFound(error)) return parsePolicy(undefined);
      throw error;
    }
  }

  async downloadWorkspace(client: Octokit, owner: string, repo: string, ref: string, workspace: string): Promise<void> {
    const response = await client.repos.downloadZipballArchive({ owner, repo, ref });
    const zip = new AdmZip(Buffer.from(response.data as ArrayBuffer));
    for (const entry of zip.getEntries()) {
      const path = entry.entryName.replaceAll("\\", "/");
      if (path.startsWith("/") || path.split("/").includes("..")) throw new Error("unsafe path in GitHub archive");
    }
    zip.extractAllTo(workspace, true);
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(workspace, { withFileTypes: true }));
    const root = entries.find((entry) => entry.isDirectory());
    if (!root) throw new Error("GitHub archive did not contain a repository directory");
    const rootPath = join(workspace, root.name);
    const files = await import("node:fs/promises").then((fs) => fs.readdir(rootPath));
    for (const file of files) await import("node:fs/promises").then((fs) => fs.rename(join(rootPath, file), join(workspace, file)));
    await import("node:fs/promises").then((fs) => fs.rmdir(rootPath));
  }

  async createPullRequest(client: Octokit, owner: string, repo: string, base: string, expectedBaseSha: string, head: string, title: string, body: string, files: Map<string, string>): Promise<{ number: number; url: string }> {
    const branch = await client.repos.getBranch({ owner, repo, branch: base });
    const baseSha = branch.data.commit.sha;
    if (baseSha !== expectedBaseSha) throw new StaleBaseError(`base branch moved from ${expectedBaseSha} to ${baseSha}`);
    const baseCommit = await client.git.getCommit({ owner, repo, commit_sha: baseSha });
    const treeEntries = [];
    for (const [path, content] of files) {
      const blob = await client.git.createBlob({ owner, repo, content: Buffer.from(content).toString("base64"), encoding: "base64" });
      treeEntries.push({ path, mode: "100644" as const, type: "blob" as const, sha: blob.data.sha });
    }
    const tree = await client.git.createTree({ owner, repo, base_tree: baseCommit.data.tree.sha, tree: treeEntries });
    const commit = await client.git.createCommit({ owner, repo, message: title, tree: tree.data.sha, parents: [baseSha] });
    await client.git.createRef({ owner, repo, ref: `refs/heads/${head}`, sha: commit.data.sha });
    const pull = await client.pulls.create({ owner, repo, title, head, base, body });
    return { number: pull.data.number, url: pull.data.html_url };
  }

  async searchPublicRepositories(query: string, page = 1): Promise<Array<{ owner: string; repo: string; url: string }>> {
    const response = await this.base.search.repos({ q: query, page, per_page: 30 });
    return response.data.items.flatMap((item) => item.owner ? [{ owner: item.owner.login, repo: item.name, url: item.html_url }] : []);
  }

  async mergeInput(client: Octokit, owner: string, repo: string, number: number, base: string): Promise<MergeInput> {
    const pull = await client.pulls.get({ owner, repo, pull_number: number });
    const checks = await client.checks.listForRef({ owner, repo, ref: pull.data.head.sha });
    let requiredApprovals = 0;
    try {
      const protection = await client.repos.getBranchProtection({ owner, repo, branch: base });
      requiredApprovals = protection.data.required_pull_request_reviews?.required_approving_review_count ?? 0;
    } catch (error) {
      if (!isForbidden(error) && !isNotFound(error)) throw error;
    }
    const reviews = await client.pulls.listReviews({ owner, repo, pull_number: number });
    const latestReview = new Map<number, string>();
    for (const review of reviews.data) latestReview.set(review.user?.id ?? review.id, review.state);
    const approved = [...latestReview.values()].filter((state) => state === "APPROVED").length;
    return {
      draft: pull.data.draft ?? false,
      mergeable: pull.data.mergeable,
      baseMatches: pull.data.base.ref === base,
      checks: checks.data.check_runs.map((run) => ({ name: run.name, conclusion: run.conclusion })),
      approvals: { required: requiredApprovals, current: approved },
    };
  }

  async commentOnPullRequest(client: Octokit, owner: string, repo: string, number: number, body: string): Promise<void> {
    await client.issues.createComment({ owner, repo, issue_number: number, body });
  }
}

function isNotFound(error: unknown): boolean { return typeof error === "object" && error !== null && "status" in error && (error as { status?: number }).status === 404; }
function isForbidden(error: unknown): boolean { return typeof error === "object" && error !== null && "status" in error && (error as { status?: number }).status === 403; }
function base64url(value: string): string { return Buffer.from(value).toString("base64url"); }
export class StaleBaseError extends Error {}
