import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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
