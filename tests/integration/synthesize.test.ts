import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synthesize } from "../../src/core/synthesize.js";
import { reindex } from "../../src/core/reindex.js";

let vault: string;

beforeEach(async () => {
  vault = mkdtempSync(join(tmpdir(), "vault-syn-"));
  mkdirSync(join(vault, "wikis", "alpha", "concepts"), { recursive: true });
  mkdirSync(join(vault, "wikis", "alpha", "synthesis"), { recursive: true });
  mkdirSync(join(vault, "wikis", "alpha", "decisions"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });

  writeFileSync(join(vault, "wikis", "alpha", "concepts", "concept-auth.md"), `---
id: concept-auth
title: Auth concept
type: concept
wiki: alpha
status: active
created: 2026-04-28
updated: 2026-04-28
summary: auth
tags: [auth]
---
Body.
`);
  await reindex(vault);
});

describe("synthesize", () => {
  it("creates a synthesis page with input citations", () => {
    const result = synthesize(vault, { topic: "auth", wiki: "alpha" });
    expect(result.id).toBe("synthesis-auth");
    expect(existsSync(result.path)).toBe(true);
    const content = readFileSync(result.path, "utf8");
    expect(content).toMatch(/concept-auth/);
    expect(content).toMatch(/last_compiled/);
  });

  it("idempotent — re-running overwrites the same file", async () => {
    const r1 = synthesize(vault, { topic: "auth", wiki: "alpha" });
    await reindex(vault);
    const r2 = synthesize(vault, { topic: "auth", wiki: "alpha" });
    expect(r2.path).toBe(r1.path);
    expect(r2.was_overwrite).toBe(true);
  });
});

describe("synthesize — prose input + protected manual-notes zone", () => {
  it("when `prose` is supplied, ## Notes body is the supplied prose (not the stub)", () => {
    const prose = "This is the LLM-composed synthesis prose, citing [[concept-auth]] verbatim.";
    const result = synthesize(vault, { topic: "auth", wiki: "alpha", prose });
    const content = readFileSync(result.path, "utf8");

    expect(content).toContain("## Notes");
    expect(content).toContain(prose);
    // The stub language must not appear when prose is provided.
    expect(content).not.toContain("Hand-edit this section");
    expect(content).not.toContain("this stub is what `vault_synthesize` writes");
  });

  it("without `prose`, falls back to the existing stub paragraph (backwards-compatible)", () => {
    const result = synthesize(vault, { topic: "auth", wiki: "alpha" });
    const content = readFileSync(result.path, "utf8");
    expect(content).toContain("## Notes");
    expect(content).toContain("Hand-edit this section");
  });

  it("seeds a ## Manual notes section bounded by vault-synthesize-manual markers on first compile", () => {
    const result = synthesize(vault, { topic: "auth", wiki: "alpha" });
    const content = readFileSync(result.path, "utf8");

    expect(content).toContain("## Manual notes");
    expect(content).toContain("<!-- vault-synthesize-manual:start -->");
    expect(content).toContain("<!-- vault-synthesize-manual:end -->");
    // The seed must be empty between markers (no user content yet).
    const startIdx = content.indexOf("<!-- vault-synthesize-manual:start -->");
    const endIdx = content.indexOf("<!-- vault-synthesize-manual:end -->");
    const between = content.slice(
      startIdx + "<!-- vault-synthesize-manual:start -->".length,
      endIdx,
    );
    expect(between.trim()).toBe("");
  });

  it("orders sections as: Inputs cited → Notes → Manual notes (topic scope)", () => {
    const result = synthesize(vault, { topic: "auth", wiki: "alpha", prose: "synthesis prose" });
    const content = readFileSync(result.path, "utf8");

    const inputsIdx = content.indexOf("## Inputs cited");
    const notesIdx = content.indexOf("## Notes");
    const manualIdx = content.indexOf("## Manual notes");

    expect(inputsIdx).toBeGreaterThan(0);
    expect(notesIdx).toBeGreaterThan(inputsIdx);
    expect(manualIdx).toBeGreaterThan(notesIdx);
  });

  it("preserves user-authored manual-notes content verbatim across re-compile", async () => {
    // First compile to scaffold the page.
    const r1 = synthesize(vault, { topic: "auth", wiki: "alpha" });
    const original = readFileSync(r1.path, "utf8");

    // Simulate a user hand-editing between the manual-notes markers.
    const userBody = "Here are my own notes:\n\n- point A\n- point B with **bold**\n- [[concept-auth]] is wrong about X.";
    const edited = original.replace(
      /<!-- vault-synthesize-manual:start -->[\s\S]*?<!-- vault-synthesize-manual:end -->/,
      `<!-- vault-synthesize-manual:start -->\n${userBody}\n<!-- vault-synthesize-manual:end -->`,
    );
    writeFileSync(r1.path, edited);
    await reindex(vault);

    // Re-compile.
    synthesize(vault, { topic: "auth", wiki: "alpha", prose: "new prose, different from stub" });
    const after = readFileSync(r1.path, "utf8");

    // User's manual notes survive verbatim.
    expect(after).toContain(userBody);
    // New prose lands in ## Notes.
    expect(after).toContain("new prose, different from stub");
    // Stub gone (replaced by prose).
    expect(after).not.toContain("Hand-edit this section");
  });

  it("preserves manual-notes across many re-compiles (not just the first re-run)", async () => {
    synthesize(vault, { topic: "auth", wiki: "alpha" });
    const path1 = join(vault, "wikis", "alpha", "synthesis", "synthesis-auth.md");

    const userBody = "Sticky manual note.";
    let content = readFileSync(path1, "utf8").replace(
      /<!-- vault-synthesize-manual:start -->[\s\S]*?<!-- vault-synthesize-manual:end -->/,
      `<!-- vault-synthesize-manual:start -->\n${userBody}\n<!-- vault-synthesize-manual:end -->`,
    );
    writeFileSync(path1, content);
    await reindex(vault);

    for (let i = 0; i < 3; i++) {
      synthesize(vault, { topic: "auth", wiki: "alpha", prose: `pass ${i}` });
      content = readFileSync(path1, "utf8");
      expect(content).toContain(userBody);
      expect(content).toContain(`pass ${i}`);
    }
  });
});

describe("synthesize — by_agent + scope (Plan C.1b)", () => {
  let memVault: string;

  beforeEach(async () => {
    memVault = mkdtempSync(join(tmpdir(), "vault-syn-mem-"));
    mkdirSync(join(memVault, "wikis", "_agents", "synthesis"), { recursive: true });
    mkdirSync(join(memVault, "wikis", "alpha", "synthesis"), { recursive: true });
    mkdirSync(join(memVault, "wikis", "alpha", "journal"), { recursive: true });
    mkdirSync(join(memVault, "wikis", "alpha", "tasks"), { recursive: true });
    mkdirSync(join(memVault, "_index"), { recursive: true });

    // Two journals authored by charmander, one by squirtle, one task claimed by charmander
    writeFileSync(join(memVault, "wikis", "alpha", "journal", "journal-2026-04-29-1000-x.md"),
      `---
id: journal-2026-04-29-1000-x
title: Journal x
type: journal
wiki: alpha
created: 2026-04-29T10:00:00Z
author: agent:charmander
---
charmander did x
`);
    writeFileSync(join(memVault, "wikis", "alpha", "journal", "journal-2026-04-29-1100-y.md"),
      `---
id: journal-2026-04-29-1100-y
title: Journal y
type: journal
wiki: alpha
created: 2026-04-29T11:00:00Z
author: agent:charmander
---
charmander did y
`);
    writeFileSync(join(memVault, "wikis", "alpha", "journal", "journal-2026-04-29-1200-z.md"),
      `---
id: journal-2026-04-29-1200-z
title: Journal z
type: journal
wiki: alpha
created: 2026-04-29T12:00:00Z
author: agent:squirtle
---
squirtle did z
`);
    writeFileSync(join(memVault, "wikis", "alpha", "tasks", "task-feat-x.md"),
      `---
id: task-feat-x
title: feat x
type: task
wiki: alpha
status: completed
created: 2026-04-29
updated: 2026-04-29
claimed_by: agent:charmander
---
`);
    await reindex(memVault);
  });

  afterEach(() => {
    rmSync(memVault, { recursive: true, force: true });
  });

  it("scope=memory writes to wikis/_agents/synthesis/synthesis-<by_agent>-memory.md", () => {
    const r = synthesize(memVault, { topic: "track record", by_agent: "charmander", scope: "memory" });
    expect(r.id).toBe("synthesis-charmander-memory");
    expect(r.path).toBe(join(memVault, "wikis", "_agents", "synthesis", "synthesis-charmander-memory.md"));
    expect(existsSync(r.path)).toBe(true);
  });

  it("scope=memory gathers all of by_agent's journals + claimed tasks (bypasses topic recall)", () => {
    const r = synthesize(memVault, { topic: "track record", by_agent: "charmander", scope: "memory" });
    expect(r.inputs_used).toContain("journal-2026-04-29-1000-x");
    expect(r.inputs_used).toContain("journal-2026-04-29-1100-y");
    expect(r.inputs_used).toContain("task-feat-x");
    expect(r.inputs_used).not.toContain("journal-2026-04-29-1200-z");
  });

  it("scope=memory throws when by_agent is missing", () => {
    expect(() => synthesize(memVault, { topic: "track record", scope: "memory" }))
      .toThrow(/by_agent.*required.*memory|scope.*memory.*by_agent/i);
  });

  it("by_agent with scope=topic filters recall results to that agent's pages only", () => {
    const r = synthesize(memVault, { topic: "journal", wiki: "alpha", by_agent: "charmander", scope: "topic" });
    expect(r.inputs_used).toContain("journal-2026-04-29-1000-x");
    expect(r.inputs_used).toContain("journal-2026-04-29-1100-y");
    expect(r.inputs_used).not.toContain("journal-2026-04-29-1200-z");
  });
});
