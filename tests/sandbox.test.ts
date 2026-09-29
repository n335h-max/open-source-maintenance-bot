import { describe, expect, it } from "vitest";
import { buildDockerArgs, validateAgentImage } from "../src/sandbox.js";

describe("agent sandbox boundary", () => {
  it("requires a versioned or digest-pinned agent image", () => {
    expect(() => validateAgentImage("open-source-maintenance-agent:latest")).toThrow(/pinned/i);
    expect(() => validateAgentImage("open-source-maintenance-agent:0.1.0")).not.toThrow();
    expect(() => validateAgentImage("registry.example/agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).not.toThrow();
  });

  it("keeps the agent offline and does not pass GitHub credentials or a Docker socket", () => {
    const args = buildDockerArgs("open-source-maintenance-agent:0.1.0", "C:/workspace", "codex", ["exec"]);
    expect(args).toContain("--network=none");
    expect(args).toContain("--read-only");
    expect(args).toContain("--cap-drop=ALL");
    expect(args.some((arg) => arg.includes("GITHUB_TOKEN") || arg.includes("GITHUB_PRIVATE_KEY"))).toBe(false);
    expect(args.some((arg) => arg.includes("docker.sock"))).toBe(false);
  });
});
