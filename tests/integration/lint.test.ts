import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lint } from "../../src/core/lint.js";
import { lintTool } from "../../src/tools/lint.js";
import { reindex } from "../../src/core/reindex.js";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-lint-"));
  mkdirSync(join(vault, "wikis", "alpha", "concepts"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
});

describe("lint", () => {
  it("flags wiki missing map.md", () => {
    writeFileSync(join(vault, "wikis", "alpha", "concepts", "concept-x.md"), `---
id: concept-x
title: X
type: concept
wiki: alpha
status: active
created: 2026-04-28
updated: 2026-04-28
summary: x
---
body
`);
    reindex(vault);
    const result = lint(vault);
    expect(result.diagnostics.some(d => d.code === "MISSING_MAP")).toBe(true);
  });

  it("flags pages with snippet but no implementation", () => {
    writeFileSync(join(vault, "wikis", "alpha", "map.md"), `---
id: map-alpha
title: alpha
type: map
wiki: alpha
status: active
created: 2026-04-28
updated: 2026-04-28
summary: m
---
m
`);
    writeFileSync(join(vault, "wikis", "alpha", "concepts", "concept-snip.md"), `---
id: concept-snip
title: Snip
type: concept
wiki: alpha
status: active
created: 2026-04-28
updated: 2026-04-28
summary: s
---

\`\`\`typescript snippet:my-snippet
foo();
\`\`\`
`);
    reindex(vault);
    const result = lint(vault);
    expect(result.diagnostics.some(d => d.code === "SNIPPET_NO_IMPLEMENTATION")).toBe(true);
  });

  it("returns empty diagnostics on a healthy fixture", () => {
    writeFileSync(join(vault, "wikis", "alpha", "map.md"), `---
id: map-alpha
title: alpha
type: map
wiki: alpha
status: active
created: 2026-04-28
updated: 2026-04-28
summary: m
---
m
`);
    writeFileSync(join(vault, "wikis", "alpha", "concepts", "concept-clean.md"), `---
id: concept-clean
title: Clean
type: concept
wiki: alpha
status: active
created: 2026-04-28
updated: 2026-04-28
summary: c
---
clean body, no snippet, no issues
`);
    reindex(vault);
    const result = lint(vault);
    expect(result.summary.errors).toBe(0);
  });
});

describe("v1.5 — lint checks", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-lint-v15-"));
    mkdirSync(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_agents", "moves"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "aliases.json"), "{}");
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("flags MOVESET_REFERENCE when a profile references a missing move", () => {
    writeFileSync(join(vaultPath, "wikis", "_agents", "profiles", "profile-x.md"),
      `---
id: profile-x
type: profile
title: X
created: 2026-04-29
wiki: _agents
status: active
summary: x
pokemon_type: fire
evolution_stage: basic
moveset: [move-doesnt-exist]
---

# X
`);
    const r = lint(vaultPath, { level: "warning" });
    expect(r.diagnostics.some(d => d.code === "MOVESET_REFERENCE")).toBe(true);
  });

  it("flags PROFILE_TYPE_INVALID for non-canon pokemon_type", () => {
    writeFileSync(join(vaultPath, "wikis", "_agents", "profiles", "profile-y.md"),
      `---
id: profile-y
type: profile
title: Y
created: 2026-04-29
wiki: _agents
status: active
summary: y
pokemon_type: lava
evolution_stage: basic
moveset: []
---

# Y
`);
    const r = lint(vaultPath, { level: "warning" });
    expect(r.diagnostics.some(d => d.code === "PROFILE_TYPE_INVALID")).toBe(true);
  });

  it("flags MOVE_NAME_ID_DRIFT when name doesn't match id stem", () => {
    const dir = join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"),
      `---
id: move-tdd-cycle
type: move
title: TDD
created: 2026-04-29
name: something-else
description: x
---

body
`);
    const r = lint(vaultPath, { level: "warning" });
    expect(r.diagnostics.some(d => d.code === "MOVE_NAME_ID_DRIFT")).toBe(true);
  });

  it("flags MOVESET_OVERSIZED for >8 moves", () => {
    writeFileSync(join(vaultPath, "wikis", "_agents", "profiles", "profile-z.md"),
      `---
id: profile-z
type: profile
title: Z
created: 2026-04-29
wiki: _agents
status: active
summary: z
pokemon_type: fire
evolution_stage: basic
moveset:
${Array.from({ length: 9 }, (_, i) => `  - move-${i}`).join("\n")}
---

# Z
`);
    const r = lint(vaultPath, { level: "warning" });
    expect(r.diagnostics.some(d => d.code === "MOVESET_OVERSIZED")).toBe(true);
  });

  it("MOVESET_TYPE_MISMATCH — warns when more than half a profile's moveset is off-type", () => {
    const v = mkdtempSync(join(tmpdir(), "vault-lint-mtm-"));
    mkdirSync(join(v, "wikis", "_agents", "profiles"), { recursive: true });
    mkdirSync(join(v, "wikis", "_agents", "moves", "move-a"), { recursive: true });
    mkdirSync(join(v, "wikis", "_agents", "moves", "move-b"), { recursive: true });
    mkdirSync(join(v, "wikis", "_agents", "moves", "move-c"), { recursive: true });
    mkdirSync(join(v, "_index"), { recursive: true });
    writeFileSync(join(v, "wikis", "_agents", "profiles", "profile-charmander.md"),
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
moveset: [move-a, move-b, move-c]
---
`);
    writeFileSync(join(v, "wikis", "_agents", "moves", "move-a", "SKILL.md"),
      `---
id: move-a
name: a
type: move
wiki: _agents
status: active
description: a
pokemon_type: water
---
`);
    writeFileSync(join(v, "wikis", "_agents", "moves", "move-b", "SKILL.md"),
      `---
id: move-b
name: b
type: move
wiki: _agents
status: active
description: b
pokemon_type: water
---
`);
    writeFileSync(join(v, "wikis", "_agents", "moves", "move-c", "SKILL.md"),
      `---
id: move-c
name: c
type: move
wiki: _agents
status: active
description: c
pokemon_type: fire
---
`);
    reindex(v);
    const r = lint(v, { wiki: "_agents" });
    const mtm = r.diagnostics.find(d => d.code === "MOVESET_TYPE_MISMATCH");
    expect(mtm).toBeDefined();
    expect(mtm?.severity).toBe("warning");
    expect(mtm?.page_id).toBe("profile-charmander");
    rmSync(v, { recursive: true, force: true });
  });

  it("ALIAS_DRIFT — warns when a recent journal author was an aliased-old id", () => {
    const v = mkdtempSync(join(tmpdir(), "vault-lint-ad-"));
    mkdirSync(join(v, "wikis", "alpha", "journal"), { recursive: true });
    mkdirSync(join(v, "_index"), { recursive: true });
    writeFileSync(join(v, "_index", "aliases.json"), JSON.stringify({
      "profile-charmander": { current: "profile-charmeleon", history: ["profile-charmander"] }
    }, null, 2));
    const recent = new Date().toISOString();
    writeFileSync(join(v, "wikis", "alpha", "journal", "journal-2026-04-29-1500-z.md"),
      `---
id: journal-2026-04-29-1500-z
title: Journal z
type: journal
wiki: alpha
created: ${recent}
author: agent:charmander
---
`);
    reindex(v);
    const r = lint(v, { wiki: "alpha" });
    const drift = r.diagnostics.find(d => d.code === "ALIAS_DRIFT");
    expect(drift).toBeDefined();
    expect(drift?.severity).toBe("warning");
    rmSync(v, { recursive: true, force: true });
  });

  it("CROSS_WIKI_LINK_BROKEN — does NOT flag when the target id exists on disk but not in idx (v1.7 §5.4)", async () => {
    const v = mkdtempSync(join(tmpdir(), "vault-lint-fallback-"));
    try {
      mkdirSync(join(v, "wikis", "alpha", "concepts"), { recursive: true });
      mkdirSync(join(v, "wikis", "alpha", "decisions"), { recursive: true });
      mkdirSync(join(v, "_index"), { recursive: true });

      writeFileSync(join(v, "wikis", "alpha", "map.md"), `---
id: map-alpha
title: alpha
type: map
wiki: alpha
status: active
created: 2026-05-01
updated: 2026-05-01
summary: m
---
m
`);
      // Source page references a target via wikilink.
      writeFileSync(join(v, "wikis", "alpha", "concepts", "concept-source.md"), `---
id: concept-source
title: Source
type: concept
wiki: alpha
status: active
created: 2026-05-01
updated: 2026-05-01
summary: s
---
Body links to [[wikis/alpha/decisions/decision-2026-05-01-target]] for context.
`);
      // First reindex — only concept-source is indexed.
      reindex(v);

      // NOW write the target on disk WITHOUT reindexing again. The wikilink's
      // target id is therefore unknown to idx.pages but exists on disk.
      writeFileSync(join(v, "wikis", "alpha", "decisions", "decision-2026-05-01-target.md"), `---
id: decision-2026-05-01-target
title: Target
type: decision
wiki: alpha
status: accepted
created: 2026-05-01
updated: 2026-05-01
summary: t
confidence: high
---
target body
`);

      // Use the tool handler so registered checks (including
      // cross-wiki-link-broken) actually run.
      const r = await lintTool.handler({ wiki: "alpha", level: "error" }, { vaultPath: v });
      const broken = r.diagnostics.find((d: any) =>
        d.code === "CROSS_WIKI_LINK_BROKEN" &&
        d.page_id === "concept-source"
      );
      // With findOnDisk fallback in cross-wiki-link-broken, the on-disk target
      // is recovered and the link is NOT flagged as broken.
      expect(broken).toBeUndefined();
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("MOVE_APPLIES_TO_INCONSISTENT — info when a move's applies_to omits a runtime the profile uses", () => {
    const v = mkdtempSync(join(tmpdir(), "vault-lint-mati-"));
    mkdirSync(join(v, "wikis", "_agents", "profiles"), { recursive: true });
    mkdirSync(join(v, "wikis", "_agents", "moves", "move-x"), { recursive: true });
    mkdirSync(join(v, "_index"), { recursive: true });
    writeFileSync(join(v, "wikis", "_agents", "profiles", "profile-charmander.md"),
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
moveset: [move-x]
applies_to: [claude-code, openclaw]
---
`);
    writeFileSync(join(v, "wikis", "_agents", "moves", "move-x", "SKILL.md"),
      `---
id: move-x
name: x
type: move
wiki: _agents
status: active
description: x
applies_to: [claude-code]
---
`);
    reindex(v);
    const r = lint(v, { wiki: "_agents" });
    const mati = r.diagnostics.find(d => d.code === "MOVE_APPLIES_TO_INCONSISTENT");
    expect(mati).toBeDefined();
    expect(mati?.severity).toBe("info");
    expect(mati?.page_id).toBe("profile-charmander");
    rmSync(v, { recursive: true, force: true });
  });
});
