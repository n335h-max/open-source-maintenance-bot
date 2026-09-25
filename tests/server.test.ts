import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { signWebhook } from "../src/webhook.js";

describe("GitHub webhook intake", () => {
  it("authenticates, deduplicates, and enqueues an opted-in scan event", async () => {
    const deliveries = new Set<string>();
    const jobs: unknown[] = [];
    const db = {
      recordDelivery: async (id: string) => !deliveries.has(id) && (deliveries.add(id), true),
    };
    const queue = { enqueue: async (job: unknown) => { jobs.push(job); return "job-1"; } };
    const app = buildServer({ db: db as never, queue: queue as never, webhookSecret: "secret" });
    const body = JSON.stringify({
      repository: { name: "demo", owner: { login: "alice" }, default_branch: "main" },
      installation: { id: 42 },
      ref: "refs/heads/main",
      after: "abc123",
    });
    const headers = {
      "x-github-delivery": "delivery-1",
      "x-github-event": "push",
      "x-hub-signature-256": signWebhook(body, "secret"),
      "content-type": "application/json",
    };
    const first = await app.inject({ method: "POST", url: "/github/webhook", headers, payload: body });
    const second = await app.inject({ method: "POST", url: "/github/webhook", headers, payload: body });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(jobs).toHaveLength(1);
    await app.close();
  });

  it("rejects forged webhook requests", async () => {
    const app = buildServer({ db: {} as never, queue: {} as never, webhookSecret: "secret" });
    const result = await app.inject({ method: "POST", url: "/github/webhook", headers: { "x-github-delivery": "x", "x-github-event": "push", "x-hub-signature-256": "sha256=bad", "content-type": "application/json" }, payload: "{}" });
    expect(result.statusCode).toBe(401);
    await app.close();
  });
});
