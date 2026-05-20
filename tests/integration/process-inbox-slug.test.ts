import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { processInboxTool } from "../../src/tools/process-inbox.js";

describe("vault_process-inbox suggested_id derivation (v1.7.2 Fix 2)", () => {
  let vault: string;

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "vault-pi-slug-"));
    mkdirSync(join(vault, "wikis", "_meta", "inbox"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it("returns a clean slug, not a path-artifact-laden string (Windows path-separator portability)", async () => {
    const filename = "2026-05-07-2327-make-audits-a-first-class-concept-in.md";
    writeFileSync(join(vault, "wikis", "_meta", "inbox", filename), "thought body");

    const result: any = await processInboxTool.handler(
      { wiki: "_meta", commit: false },
      { vaultPath: vault },
    );

    expect(result.proposals).toHaveLength(1);
    const proposal = result.proposals[0];
    expect(proposal.suggested_id).toBe("idea-make-audits-a-first-class-concept-in");

    expect(proposal.suggested_id).not.toContain(sep);
    expect(proposal.suggested_id).not.toContain("/");
    expect(proposal.suggested_id).not.toMatch(/^idea-[A-Z]:/);
  });

  it("handles filenames without a date prefix", async () => {
    writeFileSync(join(vault, "wikis", "_meta", "inbox", "random-thought.md"), "body");

    const result: any = await processInboxTool.handler(
      { wiki: "_meta", commit: false },
      { vaultPath: vault },
    );

    expect(result.proposals[0].suggested_id).toBe("idea-random-thought");
  });

  it("strips .md extension and date prefix together", async () => {
    writeFileSync(join(vault, "wikis", "_meta", "inbox", "2026-05-19-1430-test-item.md"), "body");

    const result: any = await processInboxTool.handler(
      { wiki: "_meta", commit: false },
      { vaultPath: vault },
    );

    expect(result.proposals[0].suggested_id).toBe("idea-test-item");
  });
});
