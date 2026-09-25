import { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { JobKind, JobRecord, JobState } from "./types.js";
import { Finding, ValidationResult } from "./types.js";

export class Database {
  readonly pool: Pool;
  constructor(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) throw new Error("DATABASE_URL is required");
    this.pool = new Pool({ connectionString });
  }

  async migrate(): Promise<void> {
    await this.pool.query(readFileSync("db/migrations/001_init.sql", "utf8"));
  }

  async recordDelivery(deliveryId: string, eventName: string): Promise<boolean> {
    const result = await this.pool.query("insert into webhook_deliveries(delivery_id, event_name) values($1, $2) on conflict do nothing", [deliveryId, eventName]);
    return result.rowCount === 1;
  }

  async enqueue(input: Omit<JobRecord, "id" | "state"> & { state?: JobState }): Promise<string> {
    const id = randomUUID();
    await this.pool.query("insert into jobs(id, installation_id, owner, name, commit_sha, kind, state, payload) values($1,$2,$3,$4,$5,$6,$7,$8)", [id, input.installationId ?? null, input.owner, input.repo, input.commitSha ?? null, input.kind, input.state ?? "received", input.payload]);
    return id;
  }

  async claimNext(): Promise<JobRecord | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query("select * from jobs where state = 'received' and available_at <= now() order by created_at for update skip locked limit 1");
      const row = result.rows[0];
      if (!row) { await client.query("commit"); return undefined; }
      await client.query("update jobs set state = 'analyzing', locked_at = now(), attempts = attempts + 1, updated_at = now() where id = $1", [row.id]);
      await client.query("commit");
      return rowToJob(row);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally { client.release(); }
  }

  async setState(id: string, state: JobState, error?: string): Promise<void> {
    await this.pool.query("update jobs set state=$2, last_error=$3, updated_at=now() where id=$1", [id, state, error ?? null]);
  }

  async audit(jobId: string, eventType: string, data: Record<string, unknown>): Promise<void> {
    await this.pool.query("insert into audit_events(job_id, event_type, data) values($1,$2,$3)", [jobId, eventType, data]);
  }

  async recordFinding(jobId: string, finding: Finding): Promise<void> {
    await this.pool.query("insert into findings(job_id, category, title, rationale, evidence, confidence, severity, affected_files) values($1,$2,$3,$4,$5,$6,$7,$8)", [jobId, finding.category, finding.title, finding.rationale, finding.evidence, finding.confidence, finding.severity, finding.affectedFiles]);
  }

  async recordValidation(jobId: string, result: ValidationResult): Promise<void> {
    await this.pool.query("insert into validation_runs(job_id, command, exit_code, output, passed) values($1,$2,$3,$4,$5)", [jobId, result.command, result.exitCode, result.output, result.passed]);
  }

  async recordPullRequest(jobId: string, owner: string, repo: string, number: number, url: string, mergeStatus = "unknown", reasons: string[] = []): Promise<void> {
    await this.pool.query("insert into pull_requests(job_id, owner, name, number, url, merge_status, merge_reasons) values($1,$2,$3,$4,$5,$6,$7) on conflict (job_id) do update set number=$4, url=case when $5 = '' then pull_requests.url else $5 end, merge_status=$6, merge_reasons=$7, updated_at=now()", [jobId, owner, repo, number, url, mergeStatus, reasons]);
  }

  async close(): Promise<void> { await this.pool.end(); }
}

function rowToJob(row: Record<string, unknown>): JobRecord {
  return { id: String(row.id), installationId: row.installation_id == null ? undefined : Number(row.installation_id), owner: String(row.owner), repo: String(row.name), commitSha: row.commit_sha == null ? undefined : String(row.commit_sha), kind: row.kind as JobKind, state: row.state as JobState, payload: (row.payload ?? {}) as Record<string, unknown> };
}
