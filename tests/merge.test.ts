import { describe, expect, it } from "vitest";
import { evaluateMergeReadiness } from "../src/merge.js";

describe("merge readiness", () => {
  it("is ready only when checks and mergeability are green", () => {
    expect(evaluateMergeReadiness({
      draft: false,
      mergeable: true,
      baseMatches: true,
      checks: [{ name: "test", conclusion: "success" }],
      approvals: { required: 0, current: 0 },
    })).toEqual({ status: "ready", reasons: [] });
  });

  it("reports pending checks instead of treating them as failures", () => {
    expect(evaluateMergeReadiness({
      draft: false,
      mergeable: true,
      baseMatches: true,
      checks: [{ name: "test", conclusion: "queued" }],
      approvals: { required: 0, current: 0 },
    })).toEqual({ status: "pending_checks", reasons: ["test is queued"] });
  });

  it("blocks conflicts, drafts, stale bases, and failed checks", () => {
    expect(evaluateMergeReadiness({
      draft: true,
      mergeable: false,
      baseMatches: false,
      checks: [{ name: "lint", conclusion: "failure" }],
      approvals: { required: 2, current: 1 },
    })).toEqual({
      status: "conflicted",
      reasons: ["pull request is draft", "pull request has conflicts", "base branch changed", "lint failed", "needs 1 approval(s)"],
    });
  });
});
