import { Command } from "commander";
import { Database } from "./db.js";
import { GitHubClient } from "./github.js";
import { JobQueue } from "./queue.js";

const program = new Command().name("bot").description("Open Source Maintenance Bot");

program.command("scan")
  .argument("<repository>", "owner/repo")
  .requiredOption("--sha <sha>", "commit SHA")
  .option("--installation <id>", "GitHub App installation ID")
  .action(async (repository: string, options: { sha: string; installation?: string }) => {
    const [owner, repo] = repository.split("/");
    if (!owner || !repo) throw new Error("repository must be owner/repo");
    const db = new Database(); await db.migrate();
    const id = await new JobQueue(db).enqueue({ owner, repo, commitSha: options.sha, installationId: options.installation ? Number(options.installation) : undefined, kind: "repository_scan", payload: {} });
    console.log(JSON.stringify({ jobId: id })); await db.close();
  });

program.command("discover")
  .requiredOption("--query <query>", "GitHub search query")
  .action(async (options: { query: string }) => {
    const results = await new GitHubClient().searchPublicRepositories(options.query);
    console.log(JSON.stringify({ query: options.query, repositories: results }, null, 2));
  });

program.parseAsync().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
