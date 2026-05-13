// vault-mcp/tests/unit/helpers.test.ts
//
// Smoke coverage for the shared test helpers — every export gets at least
// one assertion. This is a `tests/helpers.ts` self-test, not a feature
// surface; keeps the helpers honest as future Plan 1 task tests pile on.

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  mkTempVault,
  writeClaimFile,
  mkTempVaultWithSidecar,
  mkTempVaultWithDeployments,
  makePage,
  callTool,
} from "../helpers.js";

describe("tests/helpers.ts", () => {
  it("mkTempVault creates wikis/_agents/claim and _index directories", async () => {
    const vault = await mkTempVault();
    const claimDir = await fs.stat(path.join(vault, "wikis", "_agents", "claim"));
    const indexDir = await fs.stat(path.join(vault, "_index"));
    expect(claimDir.isDirectory()).toBe(true);
    expect(indexDir.isDirectory()).toBe(true);
  });

  it("writeClaimFile produces frontmatter that round-trips through gray-matter", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-roundtrip",
      key: "subject.domain",
      status: "active",
      confidence: 0.8,
      profile: ["gastly"],
      tags: ["repo:vault-mcp"],
    });
    const raw = await fs.readFile(
      path.join(vault, "wikis", "_agents", "claim", "claim-roundtrip.md"),
      "utf8",
    );
    // Raw YAML uses JSON.stringify per value to dodge escape hazards — assert
    // both the literal serialization (for the JSON.stringify contract) and
    // the gray-matter parse (for the consumer-facing shape).
    expect(raw).toContain('key: "subject.domain"');
    const parsed = matter(raw);
    expect(parsed.data.id).toBe("claim-roundtrip");
    expect(parsed.data.status).toBe("active");
    expect(parsed.data.confidence).toBe(0.8);
    expect(parsed.data.profile).toEqual(["gastly"]);
    expect(parsed.data.tags).toEqual(["repo:vault-mcp"]);
    // ISO date stays a string, not a Date — that's the §v1.5 friction T3-5
    // lesson baked into the JSON.stringify approach.
    expect(typeof parsed.data.created).toBe("string");
    expect(parsed.data.created).toBe("2026-05-02");
  });

  it("mkTempVaultWithSidecar writes a sidecar that maps active claims into scope dimensions", async () => {
    const vault = await mkTempVaultWithSidecar([
      { id: "claim-a", key: "x.y", status: "active", confidence: 0.8, profile: ["gastly"] },
      { id: "claim-b", key: "x.z", status: "active", confidence: 0.7, scope_wiki: ["alpha"], tags: ["repo:vault-mcp"] },
      { id: "claim-c", key: "x.w", status: "superseded", confidence: 0.5, profile: ["gastly"] },
      { id: "claim-d", key: "x.q", status: "active", confidence: 0.9 }, // no scope → global
    ]);
    const sidecar = JSON.parse(
      await fs.readFile(path.join(vault, "_index", "claims.json"), "utf8"),
    );
    expect(sidecar.schema_version).toBe(2);
    expect(sidecar.by_profile["gastly"]).toContain("claim-a");
    // superseded entries are excluded from the sidecar.
    expect(sidecar.by_profile["gastly"] ?? []).not.toContain("claim-c");
    expect(sidecar.by_scope_wiki["alpha"]).toContain("claim-b");
    expect(sidecar.by_tag["repo:vault-mcp"]).toContain("claim-b");
    expect(sidecar.global).toContain("claim-d");
    // Claims with any scope dimension don't enter `global`.
    expect(sidecar.global).not.toContain("claim-a");
  });

  it("mkTempVaultWithDeployments writes _index/deployments.json with the supplied entries", async () => {
    const vault = await mkTempVaultWithDeployments([
      { repo: "github.com/foo/bar" },
      { repo: "github.com/baz/qux" },
    ]);
    const raw = await fs.readFile(path.join(vault, "_index", "deployments.json"), "utf8");
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ repo: "github.com/foo/bar" });
    expect(parsed[1]).toEqual({ repo: "github.com/baz/qux" });
  });

  it("makePage returns a PageStub carrying the supplied frontmatter", () => {
    const fm = { id: "claim-x", type: "claim", confidence: 0.6 };
    const page = makePage(fm);
    expect(page.frontmatter).toBe(fm);
    expect(page.content).toBe("");
    expect(page.filePath).toBe("<test:claim-x>");
  });

  it("makePage falls back to <test:anon> when no id is present", () => {
    const page = makePage({ type: "claim" });
    expect(page.filePath).toBe("<test:anon>");
  });

  it("callTool throws when the tool isn't registered", async () => {
    const vault = await mkTempVault();
    await expect(callTool("vault.does-not-exist", {}, vault)).rejects.toThrow(/not registered/);
  });
});
