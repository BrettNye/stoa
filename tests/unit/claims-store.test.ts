// vault-mcp/tests/unit/claims-store.test.ts
//
// task-claims-store — ClaimsStore CRUD coverage. Walks every Acceptance bullet
// from `wikis/_meta/plans/2026-05-02-vault-mcp-claims-plan-1-foundation-dag.md`
// §task-claims-store: read miss/hit, findByIdentity dedup against
// superseded/retracted, findAllByProfile multi-profile inclusion, write refuses
// overwrite, update mtime OCC, ISO-date round-trip per §v1.5 friction T3-5.

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { ClaimsStore, MtimeConflictError } from "../../src/core/claims.js";
import type { ClaimFrontmatter } from "../../src/types/claim.js";
import { scopeHash } from "../../src/core/scope-hash.js";
import { mkTempVault, writeClaimFile } from "../helpers.js";

/**
 * Write a fully-valid active claim file (helpers.writeClaimFile omits
 * `summary`/`updated` by design; the strict-validate `update` path requires
 * them, so update-tier tests use this local writer instead).
 */
async function writeFullClaim(vaultPath: string, fm: ClaimFrontmatter, body = ""): Promise<void> {
  const wiki = fm.wiki ?? "_agents";
  const dir = path.join(vaultPath, "wikis", wiki, "claim");
  await fs.mkdir(dir, { recursive: true });
  const yaml = Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  await fs.writeFile(path.join(dir, `${fm.id}.md`), `---\n${yaml}\n---\n\n${body}`, "utf8");
}

function activeFm(overrides: Partial<ClaimFrontmatter> & { id: string; key: string }): ClaimFrontmatter {
  return {
    id: overrides.id,
    type: "claim",
    title: overrides.title ?? overrides.id,
    created: overrides.created ?? "2026-05-02",
    key: overrides.key,
    confidence: overrides.confidence ?? 0.8,
    last_validated: overrides.last_validated ?? "2026-05-02",
    profile: overrides.profile ?? [],
    move: overrides.move ?? [],
    scope_wiki: overrides.scope_wiki ?? [],
    tags: overrides.tags ?? [],
    evidence: overrides.evidence ?? [],
    status: "active",
    supersedes: overrides.supersedes ?? [],
    superseded_by: overrides.superseded_by ?? null,
    retracted_at: overrides.retracted_at ?? null,
    retracted_by: overrides.retracted_by ?? null,
    retraction_reason: overrides.retraction_reason ?? null,
    wiki: overrides.wiki ?? "_agents",
    summary: overrides.summary ?? "summary",
    updated: overrides.updated ?? "2026-05-02",
    authored_by: overrides.authored_by ?? "agent:test",
  };
}

describe("ClaimsStore.read", () => {
  it("returns null for non-existent claim id", async () => {
    const vault = await mkTempVault();
    const store = new ClaimsStore();
    const result = await store.read(vault, "claim-missing");
    expect(result).toBeNull();
  });

  it("returns parsed claim with all spec §5.2 fields", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-x",
      key: "subj.dom",
      status: "active",
      confidence: 0.7,
      profile: ["profile-charmander"],
      move: ["move-tdd-cycle"],
      scope_wiki: ["alpha"],
      tags: ["repo:vault-mcp"],
      evidence: ["[[wikis/alpha/journal/x]]"],
    });
    const store = new ClaimsStore();
    const result = await store.read(vault, "claim-x");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("claim-x");
    expect(result!.key).toBe("subj.dom");
    expect(result!.status).toBe("active");
    expect(result!.confidence).toBe(0.7);
    expect(result!.profile).toEqual(["profile-charmander"]);
    expect(result!.move).toEqual(["move-tdd-cycle"]);
    expect(result!.scope_wiki).toEqual(["alpha"]);
    expect(result!.tags).toEqual(["repo:vault-mcp"]);
    expect(result!.evidence).toEqual(["[[wikis/alpha/journal/x]]"]);
    expect(typeof result!.mtime).toBe("string");
    expect(result!.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result!.filePath).toContain("claim-x.md");
    expect(typeof result!.body).toBe("string");
  });

  it("returns null for malformed claims (defensive)", async () => {
    const vault = await mkTempVault();
    const file = path.join(vault, "wikis", "_agents", "claim", "claim-bad.md");
    await fs.writeFile(file, "not a valid claim file\n", "utf8");
    const store = new ClaimsStore();
    const result = await store.read(vault, "claim-bad");
    expect(result).toBeNull();
  });
});

describe("ClaimsStore.findByIdentity", () => {
  it("returns null when no claim matches", async () => {
    const vault = await mkTempVault();
    const store = new ClaimsStore();
    const result = await store.findByIdentity(vault, "x.y", scopeHash(["p"], [], [], []));
    expect(result).toBeNull();
  });

  it("returns the active claim when one matches", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-active",
      key: "x.y",
      status: "active",
      confidence: 0.9,
      profile: ["profile-p"],
    });
    const store = new ClaimsStore();
    const expected = scopeHash(["profile-p"], [], [], []);
    const result = await store.findByIdentity(vault, "x.y", expected);
    expect(result?.id).toBe("claim-active");
  });

  it("ignores superseded claims with the same key+scope_hash", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-old",
      key: "x.y",
      status: "superseded",
      confidence: 0.8,
      profile: ["profile-p"],
      superseded_by: "claim-new",
    });
    await writeClaimFile(vault, {
      id: "claim-new",
      key: "x.y",
      status: "active",
      confidence: 0.9,
      profile: ["profile-p"],
    });
    const store = new ClaimsStore();
    const found = await store.findByIdentity(
      vault,
      "x.y",
      scopeHash(["profile-p"], [], [], []),
    );
    expect(found?.id).toBe("claim-new");
  });

  it("ignores retracted claims with the same key+scope_hash", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-retracted",
      key: "x.y",
      status: "retracted",
      confidence: 0.8,
      profile: ["profile-p"],
    });
    const store = new ClaimsStore();
    const found = await store.findByIdentity(
      vault,
      "x.y",
      scopeHash(["profile-p"], [], [], []),
    );
    expect(found).toBeNull();
  });

  it("distinguishes claims with same key but different scope_hash", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-p1",
      key: "x.y",
      status: "active",
      confidence: 0.8,
      profile: ["profile-1"],
    });
    await writeClaimFile(vault, {
      id: "claim-p2",
      key: "x.y",
      status: "active",
      confidence: 0.8,
      profile: ["profile-2"],
    });
    const store = new ClaimsStore();
    const found1 = await store.findByIdentity(vault, "x.y", scopeHash(["profile-1"], [], [], []));
    const found2 = await store.findByIdentity(vault, "x.y", scopeHash(["profile-2"], [], [], []));
    expect(found1?.id).toBe("claim-p1");
    expect(found2?.id).toBe("claim-p2");
  });
});

describe("ClaimsStore.findAllByProfile", () => {
  it("returns active claims whose profile array includes the id", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-a",
      key: "a.x",
      status: "active",
      confidence: 0.8,
      profile: ["profile-charmander"],
    });
    await writeClaimFile(vault, {
      id: "claim-b",
      key: "b.x",
      status: "active",
      confidence: 0.8,
      profile: ["profile-charmander", "profile-squirtle"],
    });
    await writeClaimFile(vault, {
      id: "claim-c",
      key: "c.x",
      status: "active",
      confidence: 0.8,
      profile: ["profile-squirtle"],
    });
    const store = new ClaimsStore();
    const found = await store.findAllByProfile(vault, "profile-charmander");
    const ids = found.map((c) => c.id).sort();
    expect(ids).toEqual(["claim-a", "claim-b"]);
  });

  it("excludes superseded and retracted claims", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-active",
      key: "a.x",
      status: "active",
      confidence: 0.8,
      profile: ["profile-charmander"],
    });
    await writeClaimFile(vault, {
      id: "claim-old",
      key: "b.x",
      status: "superseded",
      confidence: 0.8,
      profile: ["profile-charmander"],
      superseded_by: "claim-active",
    });
    await writeClaimFile(vault, {
      id: "claim-rip",
      key: "c.x",
      status: "retracted",
      confidence: 0.8,
      profile: ["profile-charmander"],
    });
    const store = new ClaimsStore();
    const found = await store.findAllByProfile(vault, "profile-charmander");
    expect(found.map((c) => c.id)).toEqual(["claim-active"]);
  });
});

describe("ClaimsStore.write", () => {
  it("writes a new claim file at wikis/<wiki>/claim/<id>.md", async () => {
    const vault = await mkTempVault();
    const store = new ClaimsStore();
    const fm = activeFm({ id: "claim-new", key: "fresh.x", profile: ["profile-p"] });
    await store.write(vault, fm, "Body content here.");
    const expected = path.join(vault, "wikis", "_agents", "claim", "claim-new.md");
    const stat = await fs.stat(expected);
    expect(stat.isFile()).toBe(true);
    const raw = await fs.readFile(expected, "utf8");
    expect(raw).toContain("Body content here.");
    const parsed = matter(raw);
    expect(parsed.data.id).toBe("claim-new");
    expect(parsed.data.key).toBe("fresh.x");
    expect(parsed.data.status).toBe("active");
  });

  it("rejects overwrite of existing file (must use update)", async () => {
    const vault = await mkTempVault();
    const store = new ClaimsStore();
    const fm = activeFm({ id: "claim-twice", key: "twice.x" });
    await store.write(vault, fm, "first");
    await expect(store.write(vault, fm, "second")).rejects.toThrow(/overwrite|use update/i);
  });

  it("validates schema on write — rejects malformed frontmatter", async () => {
    const vault = await mkTempVault();
    const store = new ClaimsStore();
    const bad = {
      id: "claim-bad",
      type: "claim",
      title: "x",
      created: "2026-05-02",
      key: "INVALID UPPERCASE",
      status: "active",
      confidence: 0.8,
      last_validated: "2026-05-02",
      profile: [],
      move: [],
      scope_wiki: [],
      tags: [],
      evidence: [],
      supersedes: [],
      superseded_by: null,
      retracted_at: null,
      retracted_by: null,
      retraction_reason: null,
      wiki: "_agents",
      summary: "x",
      updated: "2026-05-02",
      authored_by: "agent:x",
    } as unknown as ClaimFrontmatter;
    await expect(store.write(vault, bad, "")).rejects.toThrow();
  });

  it("ISO date values round-trip through gray-matter as strings (T3-5)", async () => {
    const vault = await mkTempVault();
    const store = new ClaimsStore();
    const fm = activeFm({ id: "claim-iso", key: "iso.x" });
    await store.write(vault, fm, "");
    const file = path.join(vault, "wikis", "_agents", "claim", "claim-iso.md");
    const raw = await fs.readFile(file, "utf8");
    const parsed = matter(raw);
    expect(typeof parsed.data.created).toBe("string");
    expect(parsed.data.created).toBe("2026-05-02");
    expect(typeof parsed.data.updated).toBe("string");
    expect(typeof parsed.data.last_validated).toBe("string");
  });

  it("writes atomically — no partial file visible to concurrent readers", async () => {
    // The atomic-rename contract: if a tmp+rename succeeds, the destination
    // contains the full payload; if it fails, the destination is unchanged.
    // We can at least assert that the final file is well-formed YAML and
    // that no `.tmp` artifact is left behind on the happy path.
    const vault = await mkTempVault();
    const store = new ClaimsStore();
    const fm = activeFm({ id: "claim-atomic", key: "atomic.x" });
    await store.write(vault, fm, "atomic body");
    const dir = path.join(vault, "wikis", "_agents", "claim");
    const entries = await fs.readdir(dir);
    expect(entries).toContain("claim-atomic.md");
    // No tmp turds left over
    const tmps = entries.filter((e) => e.includes(".tmp") || e.endsWith("~"));
    expect(tmps).toEqual([]);
  });
});

describe("ClaimsStore.update", () => {
  it("applies a patch and rewrites the file", async () => {
    const vault = await mkTempVault();
    await writeFullClaim(vault, activeFm({ id: "claim-up", key: "u.x", profile: ["profile-p"], confidence: 0.5 }));
    const store = new ClaimsStore();
    const before = await store.read(vault, "claim-up");
    expect(before).not.toBeNull();
    await store.update(vault, "claim-up", { confidence: 0.95 }, before!.mtime);
    const after = await store.read(vault, "claim-up");
    expect(after?.confidence).toBe(0.95);
    expect(after?.id).toBe("claim-up");
    expect(after?.key).toBe("u.x");
  });

  it("throws MtimeConflictError when expected mtime is stale", async () => {
    const vault = await mkTempVault();
    await writeFullClaim(vault, activeFm({ id: "claim-occ", key: "occ.x", profile: ["profile-p"], confidence: 0.5 }));
    const store = new ClaimsStore();
    const stale = "1999-01-01T00:00:00.000Z";
    await expect(
      store.update(vault, "claim-occ", { confidence: 0.99 }, stale),
    ).rejects.toBeInstanceOf(MtimeConflictError);
  });

  it("throws when claim does not exist", async () => {
    const vault = await mkTempVault();
    const store = new ClaimsStore();
    await expect(
      store.update(vault, "claim-nope", { confidence: 0.5 }, new Date().toISOString()),
    ).rejects.toThrow(/no such claim|not found/i);
  });

  it("validates the merged frontmatter — rejects patches that violate schema", async () => {
    const vault = await mkTempVault();
    await writeFullClaim(vault, activeFm({ id: "claim-vp", key: "vp.x", profile: ["profile-p"], confidence: 0.5 }));
    const store = new ClaimsStore();
    const before = await store.read(vault, "claim-vp");
    // confidence > 1 is invalid per Base schema
    await expect(
      store.update(vault, "claim-vp", { confidence: 99 } as unknown as Partial<ClaimFrontmatter>, before!.mtime),
    ).rejects.toThrow();
  });

  it("supports supersession transition (active → superseded)", async () => {
    const vault = await mkTempVault();
    await writeFullClaim(vault, activeFm({ id: "claim-old", key: "s.x", profile: ["profile-p"], confidence: 0.7 }));
    await writeFullClaim(vault, activeFm({ id: "claim-new", key: "s.x", profile: ["profile-p"], confidence: 0.9 }));
    const store = new ClaimsStore();
    const before = await store.read(vault, "claim-old");
    await store.update(
      vault,
      "claim-old",
      { status: "superseded", superseded_by: "claim-new" },
      before!.mtime,
    );
    const after = await store.read(vault, "claim-old");
    expect(after?.status).toBe("superseded");
    expect(after?.superseded_by).toBe("claim-new");
    // findByIdentity should now skip the old one
    const found = await store.findByIdentity(
      vault,
      "s.x",
      scopeHash(["profile-p"], [], [], []),
    );
    expect(found?.id).toBe("claim-new");
  });
});
