import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { refreshProfileMemoryTool } from "../../src/tools/refresh-profile-memory.js";
import { reindex } from "../../src/core/reindex.js";
import { parseFrontmatter } from "../../src/core/frontmatter.js";

describe("vault.refresh-profile-memory", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-rpm-"));
    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_agents", "synthesis"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "alpha", "journal"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });

    writeFileSync(join(profilesDir, "profile-charmander.md"),
      `---
id: profile-charmander
title: Charmander
type: profile
wiki: _agents
status: active
created: 2026-04-29
updated: 2026-04-29
summary: Backend
pokemon_type: fire
evolution_stage: basic
autonomy_level: restricted
moveset: [move-tdd-cycle]
applies_to: [claude-code]
---
`);
    writeFileSync(join(vaultPath, "wikis", "alpha", "journal", "journal-2026-04-29-1000-a.md"),
      `---
id: journal-2026-04-29-1000-a
title: Journal a
type: journal
wiki: alpha
created: 2026-04-29T10:00:00Z
author: agent:charmander
---
charmander journal a
`);
    writeFileSync(join(vaultPath, "wikis", "alpha", "journal", "journal-2026-04-29-1100-b.md"),
      `---
id: journal-2026-04-29-1100-b
title: Journal b
type: journal
wiki: alpha
created: 2026-04-29T11:00:00Z
author: agent:charmander
---
charmander journal b
`);
    await reindex(vaultPath);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("writes a memory synthesis at wikis/_agents/synthesis/synthesis-<bare>-memory.md", async () => {
    const r = await refreshProfileMemoryTool.handler({ pokemon_id: "profile-charmander" }, { vaultPath });
    expect(r.memory_page_id).toBe("synthesis-charmander-memory");
    expect(r.path).toBe(join(vaultPath, "wikis", "_agents", "synthesis", "synthesis-charmander-memory.md"));
    expect(existsSync(r.path)).toBe(true);
    expect(r.inputs_used_count).toBe(2);
    expect(r.last_compiled).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("idempotent — re-running overwrites the same file with same id and updated last_compiled", async () => {
    const r1 = await refreshProfileMemoryTool.handler({ pokemon_id: "profile-charmander" }, { vaultPath });
    const r2 = await refreshProfileMemoryTool.handler({ pokemon_id: "profile-charmander" }, { vaultPath });
    expect(r2.path).toBe(r1.path);
    expect(r2.memory_page_id).toBe(r1.memory_page_id);
    expect(existsSync(r1.path)).toBe(true);
    const { frontmatter } = parseFrontmatter(readFileSync(r1.path, "utf8"));
    expect(frontmatter.scope).toBe("memory");
    expect(frontmatter.by_agent).toBe("charmander");
  });

  it("throws when pokemon_id has no profile", async () => {
    await expect(
      refreshProfileMemoryTool.handler({ pokemon_id: "profile-nonexistent" }, { vaultPath })
    ).rejects.toThrow(/profile not found|not.found|PROFILE_NOT_FOUND/i);
  });
});
