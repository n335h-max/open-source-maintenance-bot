import { describe, expect, it } from "vitest";
import { parseAgentJson } from "../src/providers.js";

describe("provider output contract", () => {
  it("accepts bounded analysis output", () => {
    const result = parseAgentJson(`{"findings":[{"category":"docs","title":"Improve README","rationale":"The setup is missing","evidence":["README.md"],"confidence":0.9,"severity":"low","affectedFiles":["README.md"]}]}`, "analysis");
    expect(result.findings).toHaveLength(1);
  });

  it("rejects malformed provider output", () => {
    expect(() => parseAgentJson("not json", "analysis")).toThrow("invalid agent output");
  });
});
