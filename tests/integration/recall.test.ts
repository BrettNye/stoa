import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recall } from "../../src/core/recall.js";
import { reindex } from "../../src/core/reindex.js";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-recall-"));
  mkdirSync(join(vault, "wikis", "alpha", "concepts"), { recursive: true });
  mkdirSync(join(vault, "wikis", "alpha", "synthesis"), { recursive: true });
  mkdirSync(join(vault, "wikis", "alpha", "decisions"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });

  writeFileSync(join(vault, "wikis", "alpha", "concepts", "concept-auth.md"), `---
id: concept-auth
title: Authentication middleware
type: concept
wiki: alpha
status: active
created: 2026-04-28
updated: 2026-04-28
summary: Auth middleware concept
tags: [auth, middleware]
---
The middleware validates JWT tokens.
`);

  writeFileSync(join(vault, "wikis", "alpha", "synthesis", "synthesis-auth.md"), `---
id: synthesis-auth
title: Auth patterns synthesis
type: synthesis
wiki: alpha
status: active
created: 2026-04-28
updated: 2026-04-28
summary: Survey of auth approaches
tags: [auth]
last_compiled: 2026-04-28
---
JWT vs sessions vs OAuth comparison.
`);

  writeFileSync(join(vault, "wikis", "alpha", "decisions", "decision-2026-04-28-jwt.md"), `---
id: decision-2026-04-28-jwt
title: Use JWT
type: decision
wiki: alpha
status: accepted
created: 2026-04-28
updated: 2026-04-28
summary: Adopt JWT for auth
tags: [auth, jwt]
confidence: high
---
We chose JWT.
`);

  reindex(vault);
});

describe("recall", () => {
  it("returns synthesis as top hit when topic matches", () => {
    const result = recall(vault, { topic: "auth" });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].id).toBe("synthesis-auth");
  });

  it("inlines synthesis content", () => {
    const result = recall(vault, { topic: "auth" });
    expect(result.synthesis_inline.some(s => s.id === "synthesis-auth" && s.body.length > 0)).toBe(true);
  });

  it("matches via stemming (authentication → auth)", () => {
    const result = recall(vault, { topic: "authentication" });
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it("matches body content (JWT in body)", () => {
    const result = recall(vault, { topic: "JWT" });
    expect(result.hits.some(h => h.id === "concept-auth" || h.id === "decision-2026-04-28-jwt")).toBe(true);
  });

  it("filters by wiki", () => {
    const result = recall(vault, { topic: "auth", wiki: "missing" });
    expect(result.hits).toHaveLength(0);
  });

  it("respects limit", () => {
    const result = recall(vault, { topic: "auth", limit: 1 });
    expect(result.hits).toHaveLength(1);
  });
});
