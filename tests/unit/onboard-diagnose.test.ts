import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDiagnostics } from "../../src/core/onboard-diagnose.js";
import { PRIMER_MARKER_START } from "../../src/core/ai-primer-template.js";

function makeTmpHome(): string {
  return mkdtempSync(join(tmpdir(), "diag-home-"));
}

function makeClaudeDir(home: string): string {
  const dir = join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  return dir;
}

it("flags missing primer with a fix instruction", () => {
  const home = makeTmpHome();
  const checks = runDiagnostics({ home });
  const primer = checks.find((c) => c.name === "AI-primer present");
  expect(primer?.ok).toBe(false);
  expect(primer?.fix).toMatch(/stoa onboard/);
});

describe("runDiagnostics", () => {
  describe("AI-primer check", () => {
    it("fails when ~/.claude/CLAUDE.md does not exist", () => {
      const home = makeTmpHome();
      const checks = runDiagnostics({ home });
      const check = checks.find((c) => c.name === "AI-primer present")!;
      expect(check.ok).toBe(false);
      expect(check.detail).toMatch(/does not exist/);
      expect(check.fix).toBeTruthy();
      expect(check.fix).toMatch(/stoa onboard/);
    });

    it("fails when CLAUDE.md exists but has no primer marker", () => {
      const home = makeTmpHome();
      const claudeDir = makeClaudeDir(home);
      writeFileSync(join(claudeDir, "CLAUDE.md"), "# Some existing content\n\nNo primer here.", "utf8");
      const checks = runDiagnostics({ home });
      const check = checks.find((c) => c.name === "AI-primer present")!;
      expect(check.ok).toBe(false);
      expect(check.fix).toMatch(/stoa onboard/);
    });

    it("passes when CLAUDE.md contains PRIMER_MARKER_START", () => {
      const home = makeTmpHome();
      const claudeDir = makeClaudeDir(home);
      writeFileSync(join(claudeDir, "CLAUDE.md"), `${PRIMER_MARKER_START}\nsome primer content\n`, "utf8");
      const checks = runDiagnostics({ home });
      const check = checks.find((c) => c.name === "AI-primer present")!;
      expect(check.ok).toBe(true);
      expect(check.fix).toBeUndefined();
    });
  });

  describe("MCP entry check", () => {
    it("fails when settings.json does not exist", () => {
      const home = makeTmpHome();
      const checks = runDiagnostics({ home });
      const check = checks.find((c) => c.name === "Claude Code MCP entry")!;
      expect(check.ok).toBe(false);
      expect(check.fix).toMatch(/stoa onboard/);
    });

    it("fails when settings.json has no mcpServers.stoa entry", () => {
      const home = makeTmpHome();
      const claudeDir = makeClaudeDir(home);
      writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ mcpServers: {} }), "utf8");
      const checks = runDiagnostics({ home });
      const check = checks.find((c) => c.name === "Claude Code MCP entry")!;
      expect(check.ok).toBe(false);
      expect(check.fix).toMatch(/stoa onboard/);
    });

    it("fails when settings.json is malformed JSON", () => {
      const home = makeTmpHome();
      const claudeDir = makeClaudeDir(home);
      writeFileSync(join(claudeDir, "settings.json"), "{ not valid json }", "utf8");
      const checks = runDiagnostics({ home });
      const check = checks.find((c) => c.name === "Claude Code MCP entry")!;
      expect(check.ok).toBe(false);
      expect(check.fix).toBeTruthy();
      // Should not throw — error lands in detail
      expect(check.detail).toMatch(/Could not parse/);
    });

    it("passes when settings.json has mcpServers.stoa", () => {
      const home = makeTmpHome();
      const claudeDir = makeClaudeDir(home);
      writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ mcpServers: { stoa: { command: "stoa" } } }), "utf8");
      const checks = runDiagnostics({ home });
      const check = checks.find((c) => c.name === "Claude Code MCP entry")!;
      expect(check.ok).toBe(true);
      expect(check.fix).toBeUndefined();
    });
  });

  describe("vault path check", () => {
    it("is omitted when vaultPath is not supplied", () => {
      const home = makeTmpHome();
      const checks = runDiagnostics({ home });
      const check = checks.find((c) => c.name === "Vault path");
      expect(check).toBeUndefined();
    });

    it("returns 3 checks when vaultPath is supplied", () => {
      const home = makeTmpHome();
      const vaultPath = mkdtempSync(join(tmpdir(), "vault-"));
      const checks = runDiagnostics({ home, vaultPath });
      expect(checks.length).toBeGreaterThanOrEqual(3);
      const names = checks.map((c) => c.name);
      expect(names).toContain("AI-primer present");
      expect(names).toContain("Claude Code MCP entry");
      expect(names).toContain("Vault path");
    });

    it("fails when vaultPath does not exist", () => {
      const home = makeTmpHome();
      const checks = runDiagnostics({ home, vaultPath: "/nonexistent/path/to/vault" });
      const check = checks.find((c) => c.name === "Vault path")!;
      expect(check.ok).toBe(false);
      expect(check.fix).toBeTruthy();
    });

    it("passes when vaultPath exists and is writable", () => {
      const home = makeTmpHome();
      const vaultPath = mkdtempSync(join(tmpdir(), "vault-"));
      const checks = runDiagnostics({ home, vaultPath });
      const check = checks.find((c) => c.name === "Vault path")!;
      expect(check.ok).toBe(true);
    });
  });

  describe("all failed checks have a non-empty fix string", () => {
    it("every ok:false check has a non-empty fix", () => {
      const home = makeTmpHome();
      const checks = runDiagnostics({ home, vaultPath: "/nonexistent/path/to/vault" });
      for (const check of checks) {
        if (!check.ok) {
          expect(check.fix, `check "${check.name}" has ok:false but no fix`).toBeTruthy();
          expect(check.fix!.length, `check "${check.name}" has empty fix string`).toBeGreaterThan(0);
        }
      }
    });
  });
});
