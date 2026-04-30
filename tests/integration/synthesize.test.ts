import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synthesize } from "../../src/core/synthesize.js";
import { reindex } from "../../src/core/reindex.js";

let vault: string;

beforeEach(() => {
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
  reindex(vault);
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

  it("idempotent — re-running overwrites the same file", () => {
    const r1 = synthesize(vault, { topic: "auth", wiki: "alpha" });
    reindex(vault);
    const r2 = synthesize(vault, { topic: "auth", wiki: "alpha" });
    expect(r2.path).toBe(r1.path);
    expect(r2.was_overwrite).toBe(true);
  });
});

describe("synthesize — by_agent + scope (Plan C.1b)", () => {
  let memVault: string;

  beforeEach(() => {
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
    reindex(memVault);
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
