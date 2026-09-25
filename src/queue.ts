import { Database } from "./db.js";
import { JobKind } from "./types.js";

export class JobQueue {
  constructor(private readonly db: Database) {}
  async enqueue(input: { installationId?: number; owner: string; repo: string; commitSha?: string; kind: JobKind; payload?: Record<string, unknown> }): Promise<string> {
    return this.db.enqueue({ ...input, payload: input.payload ?? {} });
  }
}
