import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOnboardingState, writeOnboardingState } from "../../src/core/onboarding-state.js";
import type { OnboardingState } from "../../src/core/onboarding-state.js";

const SAMPLE_STATE: OnboardingState = {
  role: "engineering",
  interaction_mode: "active",
  work_surfaces: ["code-review", "planning"],
  team_or_solo: "solo",
  client: "claude-code",
  vault_path: "/tmp/testvault",
  interview_completed_at: "2026-05-20T12:00:00Z",
};

describe("onboarding-state", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-onboarding-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("returns null when no state file exists", () => {
    expect(readOnboardingState(vaultPath)).toBeNull();
  });

  it("returns null when state file contains malformed JSON", () => {
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "onboarding.json"), "{ bad json }", "utf8");
    expect(readOnboardingState(vaultPath)).toBeNull();
  });

  it("creates _index directory if absent and writes state", () => {
    // _index does not exist; writeOnboardingState should create it
    writeOnboardingState(vaultPath, SAMPLE_STATE);
    expect(existsSync(join(vaultPath, "_index", "onboarding.json"))).toBe(true);
  });

  it("round-trips: written state equals read state", () => {
    writeOnboardingState(vaultPath, SAMPLE_STATE);
    const result = readOnboardingState(vaultPath);
    expect(result).toEqual(SAMPLE_STATE);
  });

  it("persists all seven required fields", () => {
    writeOnboardingState(vaultPath, SAMPLE_STATE);
    const result = readOnboardingState(vaultPath);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.role).toBe(SAMPLE_STATE.role);
    expect(result.interaction_mode).toBe(SAMPLE_STATE.interaction_mode);
    expect(result.work_surfaces).toEqual(SAMPLE_STATE.work_surfaces);
    expect(result.team_or_solo).toBe(SAMPLE_STATE.team_or_solo);
    expect(result.client).toBe(SAMPLE_STATE.client);
    expect(result.vault_path).toBe(SAMPLE_STATE.vault_path);
    expect(result.interview_completed_at).toBe(SAMPLE_STATE.interview_completed_at);
  });

  it("overwrites existing state on a second write", () => {
    writeOnboardingState(vaultPath, SAMPLE_STATE);
    const updated: OnboardingState = {
      ...SAMPLE_STATE,
      role: "sales",
      interaction_mode: "passive",
    };
    writeOnboardingState(vaultPath, updated);
    const result = readOnboardingState(vaultPath);
    expect(result?.role).toBe("sales");
    expect(result?.interaction_mode).toBe("passive");
  });
});
