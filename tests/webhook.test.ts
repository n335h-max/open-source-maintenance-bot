import { describe, expect, it } from "vitest";
import { signWebhook, verifyWebhook } from "../src/webhook.js";

describe("webhook authentication", () => {
  it("accepts a valid GitHub signature and rejects a forged one", () => {
    const body = JSON.stringify({ action: "opened" });
    const signature = signWebhook(body, "secret");
    expect(verifyWebhook(body, signature, "secret")).toBe(true);
    expect(verifyWebhook(body, signature, "wrong")).toBe(false);
    expect(verifyWebhook(body, "sha256=bad", "secret")).toBe(false);
  });
});
