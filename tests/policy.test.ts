import { describe, expect, it } from "vitest";
import { defaultPolicy, parsePolicy, canPublishPatch, isProtectedPath, isSafeRelativePath } from "../src/policy.js";

describe("repository policy", () => {
  it("keeps missing configuration disabled", () => {
    expect(defaultPolicy().enabled).toBe(false);
  });

  it("parses an opted-in YAML policy and applies conservative defaults", () => {
    const policy = parsePolicy(`
version: 1
enabled: true
provider: codex
categories: [docs, tests]
limits:
  max_files: 2
  max_changed_lines: 20
`);
    expect(policy.enabled).toBe(true);
    expect(policy.provider).toBe("codex");
    expect(policy.limits.maxFiles).toBe(2);
    expect(policy.exclude).toContain(".github/workflows/**");
  });

  it("blocks protected paths even when the repository includes them", () => {
    expect(isProtectedPath(".env.production")).toBe(true);
    expect(isProtectedPath(".github/workflows/ci.yml")).toBe(true);
    expect(isProtectedPath("src/index.ts")).toBe(false);
  });

  it("rejects absolute and traversal paths", () => {
    expect(isSafeRelativePath("src/index.ts")).toBe(true);
    expect(isSafeRelativePath("../secret.txt")).toBe(false);
    expect(isSafeRelativePath("C:/secret.txt")).toBe(false);
  });

  it("rejects patches outside limits or protected paths", () => {
    const policy = parsePolicy("enabled: true\nlimits: { max_files: 1, max_changed_lines: 3 }");
    expect(canPublishPatch(policy, ["src/a.ts"], 3)).toBe(true);
    expect(canPublishPatch(policy, ["src/a.ts", "src/b.ts"], 3)).toBe(false);
    expect(canPublishPatch(policy, [".env", "src/a.ts"], 1)).toBe(false);
  });
});
