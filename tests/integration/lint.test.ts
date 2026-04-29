import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lint } from "../../src/core/lint.js";
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
});
