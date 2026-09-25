import Fastify, { FastifyInstance } from "fastify";
import { pathToFileURL } from "node:url";
import { Database } from "./db.js";
import { verifyWebhook } from "./webhook.js";
import { JobQueue } from "./queue.js";

export interface ServerDeps { db: Database; queue: JobQueue; webhookSecret: string; }

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true });
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => done(null, body));
  app.get("/healthz", async () => ({ ok: true }));
  app.post("/github/webhook", async (request, reply) => {
    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
    const signature = request.headers["x-hub-signature-256"];
    const delivery = request.headers["x-github-delivery"];
    const event = request.headers["x-github-event"];
    if (typeof signature !== "string" || typeof delivery !== "string" || typeof event !== "string" || !verifyWebhook(rawBody, signature, deps.webhookSecret)) return reply.code(401).send({ error: "invalid webhook" });
    if (!(await deps.db.recordDelivery(delivery, event))) return reply.code(202).send({ accepted: true, duplicate: true });
    const payload = JSON.parse(rawBody) as Record<string, any>;
    const repository = payload.repository as Record<string, any> | undefined;
    if (!repository?.owner?.login || !repository.name) return reply.code(202).send({ accepted: true, ignored: true });
    const installationId = payload.installation?.id as number | undefined;
    const defaultBranch = repository.default_branch as string | undefined;
    const commitSha = event === "push" ? payload.after as string : payload.pull_request?.head?.sha as string | undefined;
    const shouldScan = event === "push" && payload.ref === `refs/heads/${defaultBranch}`;
    const headRef = payload.pull_request?.head?.ref as string | undefined;
    const pullNumber = payload.pull_request?.number ?? payload.check_run?.pull_requests?.[0]?.number ?? payload.check_suite?.pull_requests?.[0]?.number;
    const checkHeadRef = payload.check_run?.pull_requests?.[0]?.head?.ref ?? payload.check_suite?.pull_requests?.[0]?.head?.ref;
    const shouldEvaluate = (event === "pull_request" && headRef?.startsWith("bot/")) || ((event === "check_run" || event === "check_suite") && checkHeadRef?.startsWith("bot/") && typeof pullNumber === "number");
    if (shouldScan || shouldEvaluate) {
      await deps.queue.enqueue({ installationId, owner: repository.owner.login, repo: repository.name, commitSha, kind: shouldEvaluate ? "merge_evaluation" : "repository_scan", payload: { event, defaultBranch, action: payload.action, pullNumber, pullUrl: payload.pull_request?.html_url } });
    }
    return reply.code(202).send({ accepted: true });
  });
  return app;
}

async function main(): Promise<void> {
  const db = new Database();
  await db.migrate();
  const app = buildServer({ db, queue: new JobQueue(db), webhookSecret: process.env.WEBHOOK_SECRET ?? "" });
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error); process.exit(1); });
