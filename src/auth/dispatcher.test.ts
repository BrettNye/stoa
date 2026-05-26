import { describe, it, expect } from "vitest";
import { authorize } from "./dispatcher.js";
import { HttpForbiddenError, ScopeDeniedError } from "./types.js";

const stdio = { agent_id: "me", scopes: ["*:*"], source: "stdio" as const };
const httpNarrow = { agent_id: "w", scopes: ["vault_new:wikis/foo/**"], source: "http" as const };
const httpAdmin = { agent_id: "ops", scopes: ["admin:*"], source: "http" as const };
const httpEmpty = { agent_id: "x", scopes: [], source: "http" as const };

describe("authorize", () => {
  it("passes stdio principals on any tool", () => {
    const tool = { name: "vault_new", scope: { axis: () => "wikis/foo/concepts/x.md" } };
    expect(() => authorize(tool, {}, stdio)).not.toThrow();
  });
  it("blocks http on httpForbidden tools", () => {
    const tool = { name: "vault_sync-skills", scope: { axis: () => "*", httpForbidden: true } };
    expect(() => authorize(tool, {}, httpNarrow)).toThrow(HttpForbiddenError);
  });
  it("stdio with admin:* passes httpForbidden too (only HTTP is gated)", () => {
    const tool = { name: "vault_sync-skills", scope: { axis: () => "*", httpForbidden: true } };
    expect(() => authorize(tool, {}, stdio)).not.toThrow();
  });
  it("denies http when axis scope doesn't match", () => {
    const tool = { name: "vault_new", scope: { axis: () => "wikis/bar/concepts/x.md" } };
    expect(() => authorize(tool, {}, httpNarrow)).toThrow(ScopeDeniedError);
  });
  it("admin scope subsumes axis check for admin-required tools", () => {
    const tool = { name: "vault_reindex", scope: { axis: () => "wikis/foo", adminOnly: () => true } };
    expect(() => authorize(tool, {}, httpAdmin)).not.toThrow();
  });
  it("denies adminOnly when no admin scope present", () => {
    const tool = { name: "vault_reindex", scope: { axis: () => "wikis/foo", adminOnly: () => true } };
    expect(() => authorize(tool, {}, httpNarrow)).toThrow(ScopeDeniedError);
  });
  it("denies tools missing scope metadata", () => {
    const tool = { name: "vault_mystery" };
    expect(() => authorize(tool, {}, httpAdmin)).toThrow(ScopeDeniedError);
  });
  it("empty-scopes principal fails axis check", () => {
    const tool = { name: "vault_new", scope: { axis: () => "wikis/foo/concepts/x.md" } };
    expect(() => authorize(tool, {}, httpEmpty)).toThrow(ScopeDeniedError);
  });
  it("http admin cannot bypass httpForbidden (gate 1 fires before gate 2)", () => {
    const tool = { name: "vault_sync-skills", scope: { axis: () => "*", httpForbidden: true } };
    expect(() => authorize(tool, {}, httpAdmin)).toThrow(HttpForbiddenError);
  });
});
