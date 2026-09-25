import { Database } from "./db.js";
import { GitHubClient } from "./github.js";
import { DockerSandbox } from "./sandbox.js";
import { ClaudeCodeProvider, CodexProvider } from "./providers.js";
import { MaintenanceWorkflow } from "./workflow.js";

async function main(): Promise<void> {
  const db = new Database();
  await db.migrate();
  const workflow = new MaintenanceWorkflow(db, new GitHubClient(), { claude: new ClaudeCodeProvider(), codex: new CodexProvider() }, new DockerSandbox());
  while (true) {
    const job = await db.claimNext();
    if (!job) { await new Promise((resolve) => setTimeout(resolve, 1000)); continue; }
    try { await workflow.run(job); } catch (error) { console.error(JSON.stringify({ jobId: job.id, error: error instanceof Error ? error.message : String(error) })); }
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
