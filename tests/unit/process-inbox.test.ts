// vault-mcp/tests/unit/process-inbox.test.ts
//
// Regression suite for the vault.process-inbox tool's commit:false branch
// (the "suggest" phase). Pins bug-2026-05-15 #1: on Windows, suggested_id
// embedded the full absolute path because the slug builder split on "/"
// only, leaving backslashed paths intact.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processInboxTool } from "../../src/tools/process-inbox.js";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-pin-"));
  mkdirSync(join(vault, "wikis", "alpha", "inbox"), { recursive: true });
  // .active-wiki so resolveWiki has something to fall back on.
  writeFileSync(join(vault, ".active-wiki"), "alpha");
});

describe("vault.process-inbox (commit:false) — suggested_id derivation", () => {
  it("regression bug-2026-05-15 #1: suggested_id contains no path separators", async () => {
    // Write an inbox item with the canonical "YYYY-MM-DD-HHMM-slug.md" filename.
    const filename = "2026-05-07-2350-question-should-portsandbox-go-oss-signa.md";
    writeFileSync(
      join(vault, "wikis", "alpha", "inbox", filename),
      "should portsandbox go oss?",
    );
    const out = await processInboxTool.handler(
      { wiki: "alpha", commit: false },
      { vaultPath: vault },
    );
    expect(out.proposals).toHaveLength(1);
    const sid = out.proposals[0].suggested_id;
    // The bug: sid was `idea-C:\Users\brett\...\<filename without .md>`.
    // Hard invariants that must hold on Windows AND POSIX:
    expect(sid).not.toMatch(/[\/]/);     // no path separators
    expect(sid).not.toMatch(/^[a-z]+-[A-Z]:/); // no drive letter after type prefix
    expect(sid).toMatch(/^idea-/);
    // The slug body must be derived from the filename stem (date-time prefix
    // stripped) — i.e. it should contain "portsandbox" but not the full path.
    expect(sid).toContain("portsandbox");
  });

  it("strips the YYYY-MM-DD-HHMM- prefix from the filename when present", async () => {
    const filename = "2026-05-07-2350-some-thought.md";
    writeFileSync(
      join(vault, "wikis", "alpha", "inbox", filename),
      "body",
    );
    const out = await processInboxTool.handler(
      { wiki: "alpha", commit: false },
      { vaultPath: vault },
    );
    expect(out.proposals[0].suggested_id).toBe("idea-some-thought");
  });

  it("leaves filenames without the date-time prefix alone (no over-strip)", async () => {
    const filename = "raw-capture.md";
    writeFileSync(
      join(vault, "wikis", "alpha", "inbox", filename),
      "body",
    );
    const out = await processInboxTool.handler(
      { wiki: "alpha", commit: false },
      { vaultPath: vault },
    );
    expect(out.proposals[0].suggested_id).toBe("idea-raw-capture");
  });

  it("returns empty proposals when the inbox is empty", async () => {
    const out = await processInboxTool.handler(
      { wiki: "alpha", commit: false },
      { vaultPath: vault },
    );
    expect(out.proposals).toEqual([]);
  });
});

describe("vault.process-inbox (commit:true) — transactional / auto-mkdir", () => {
  // Regression bug-2026-05-15 #2 — committing a batch errored ENOENT
  // mid-batch when the target type subdir (e.g. `questions/`) didn't exist.
  // Items past the failure were silently skipped. Fix: auto-mkdir the target
  // directory at promotion time so the batch completes.
  it("auto-creates the target type subdirectory when missing", async () => {
    const filename = "2026-05-07-2300-some-question.md";
    writeFileSync(
      join(vault, "wikis", "alpha", "inbox", filename),
      "is this a question?",
    );
    // Deliberately do NOT mkdir wikis/alpha/questions — the bug was that
    // promoteInboxItem expected the dir to exist.
    const inboxPath = join(vault, "wikis", "alpha", "inbox", filename);
    const out = await processInboxTool.handler(
      {
        wiki: "alpha",
        commit: true,
        items: [
          {
            inbox_path: inboxPath,
            type: "question",
            id: "question-is-this-a-question",
          },
        ],
      },
      { vaultPath: vault },
    );
    expect(out.promoted).toHaveLength(1);
    expect(out.promoted[0].to).toContain(join("alpha", "questions"));
  });

  it("promotes earlier items, then auto-mkdir for later items needing different dirs", async () => {
    // Two items, two different target type subdirs. Neither dir pre-exists.
    // Both must promote.
    writeFileSync(
      join(vault, "wikis", "alpha", "inbox", "first.md"),
      "first body",
    );
    writeFileSync(
      join(vault, "wikis", "alpha", "inbox", "second.md"),
      "second body",
    );
    const out = await processInboxTool.handler(
      {
        wiki: "alpha",
        commit: true,
        items: [
          {
            inbox_path: join(vault, "wikis", "alpha", "inbox", "first.md"),
            type: "idea",
            id: "idea-first",
          },
          {
            inbox_path: join(vault, "wikis", "alpha", "inbox", "second.md"),
            type: "question",
            id: "question-second",
          },
        ],
      },
      { vaultPath: vault },
    );
    expect(out.promoted).toHaveLength(2);
    expect(out.promoted[0].id).toBe("idea-first");
    expect(out.promoted[1].id).toBe("question-second");
  });
});
