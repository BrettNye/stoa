import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
