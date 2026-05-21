import { describe, it, expect } from "vitest";
import { matches, hasAdminScope } from "./scope-match.js";

describe("scope-match", () => {
  it("matches exact axis under tool prefix", () => {
    expect(matches(["vault_new:wikis/foo/**"], "vault_new", "wikis/foo/concepts/x.md")).toBe(true);
  });
  it("rejects axis under wrong tool prefix", () => {
    expect(matches(["vault_new:**"], "vault_task-claim", "tasks/abc")).toBe(false);
  });
  it("admin:* subsumes any tool", () => {
    expect(matches(["admin:*"], "vault_reindex", "wikis/foo")).toBe(true);
    expect(hasAdminScope(["admin:*"], "vault_reindex")).toBe(true);
  });
  it("wildcard *:* passes everything", () => {
    expect(matches(["*:*"], "vault_new", "anywhere")).toBe(true);
  });
});
