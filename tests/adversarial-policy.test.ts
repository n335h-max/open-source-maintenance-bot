import { describe, expect, it } from "vitest";
import { canPublishPatch, parsePolicy, selectFinding } from "../src/policy.js";

describe("untrusted repository policy boundaries", () => {
  it("rejects agent patches targeting secrets, workflows, or traversal paths", () => {
    const policy = parsePolicy("enabled: true");
    expect(canPublishPatch(policy, [".env.production"], 1)).toBe(false);
    expect(canPublishPatch(policy, [".github/workflows/ci.yml"], 1)).toBe(false);
    expect(canPublishPatch(policy, ["../outside.txt"], 1)).toBe(false);
  });

  it("does not select a finding whose evidence path escapes the workspace", () => {
    const policy = parsePolicy("enabled: true");
    expect(selectFinding(policy, [{
      category: "docs",
      title: "Prompt injection",
      rationale: "untrusted fixture",
      evidence: ["README.md"],
      confidence: 0.99,
      severity: "low",
      affectedFiles: ["../../secrets.txt"],
    }])).toBeUndefined();
  });
});
