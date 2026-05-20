import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { orientTool } from "../../src/tools/orient.js";

function makeTempVault(): string {
  return mkdtempSync(join(tmpdir(), "orient-tool-"));
}

it("returns a result for an empty vault", async () => {
  const v = makeTempVault();
  const r = await orientTool.handler({ vault_path: v });
  expect(r).toHaveProperty("next_best_action");
  expect(r).toHaveProperty("reasoning");
});

describe("orientTool shape", () => {
  it("has name vault_orient", () => {
    expect(orientTool.name).toBe("vault_orient");
  });

  it("input schema rejects calls missing vault_path", () => {
    const result = orientTool.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("input schema accepts vault_path only", () => {
    const result = orientTool.inputSchema.safeParse({ vault_path: "/some/path" });
    expect(result.success).toBe(true);
  });

  it("input schema accepts vault_path with optional recent_user_message", () => {
    const result = orientTool.inputSchema.safeParse({
      vault_path: "/some/path",
      recent_user_message: "What do we know about auth?",
    });
    expect(result.success).toBe(true);
  });

  it("next_best_action and reasoning are non-empty strings", async () => {
    const v = makeTempVault();
    const r = await orientTool.handler({ vault_path: v });
    expect(typeof r.next_best_action).toBe("string");
    expect(r.next_best_action.length).toBeGreaterThan(0);
    expect(typeof r.reasoning).toBe("string");
    expect(r.reasoning.length).toBeGreaterThan(0);
  });

  it("delegates to orient core and returns result unchanged", async () => {
    const v = makeTempVault();
    const r = await orientTool.handler({ vault_path: v });
    // Empty vault has no onboarding.json, so orient returns the onboarding prompt
    expect(r.next_best_action).toContain("onboard");
  });
});
