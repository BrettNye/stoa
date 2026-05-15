// vault-mcp/tests/unit/tool-claim.test.ts
//
// task-claim-tool — vault.claim MCP tool. Walks every Acceptance bullet from
// `wikis/_meta/plans/2026-05-02-vault-mcp-claims-plan-1-foundation-dag.md`
// §task-claim-tool: create / supersede / reject / override / revalidate /
// retract paths, mutual-exclusion guards, profile-scoping default, and the
// always-true `reindex_recommended` field.
//
// `vault.claim` is NOT registered in `allTools` in this branch (that's the
// downstream task-tools-index-registration job). To stay self-contained, the
// tests exercise the tool's exported `handler` directly with a minimal
// `{ vaultPath, rawConfig: {} }` ctx — same shape the production stdio
// dispatcher would synthesize, plus the optional `rawConfig` slot the plan
// reserves for the claims-config plumb-through.

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { claimTool } from "../../src/tools/claim.js";
import { mkTempVault, writeClaimFile } from "../helpers.js";
import { ClaimsStore } from "../../src/core/claims.js";
import { scopeHash } from "../../src/core/scope-hash.js";

const ctx = (vaultPath: string) => ({ vaultPath, rawConfig: {} });

describe("vault.claim tool surface", () => {
  it("exports the canonical tool name and a Zod input schema", () => {
    expect(claimTool.name).toBe("vault.claim");
    expect(typeof claimTool.handler).toBe("function");
    expect(claimTool.inputSchema).toBeDefined();
    // input schema should at minimum reject calls missing `as`.
    const parsed = (claimTool.inputSchema as any).safeParse({});
    expect(parsed.success).toBe(false);
  });
});

describe("vault.claim — create path", () => {
  it("writes a new active claim file for a novel identity tuple", async () => {
    const vault = await mkTempVault();
    const result = await claimTool.handler(
      {
        key: "subject.domain",
        title: "First fact",
        body: "Body of the first fact.",
        confidence: 0.7,
        as: "agent:charmander",
      },
      ctx(vault),
    );
    expect(result.action).toBe("created");
    expect(typeof result.claim_id).toBe("string");
    expect(result.claim_id).toMatch(/^claim-/);
    expect(result.reindex_recommended).toBe(true);

    const file = path.join(vault, "wikis", "_agents", "claim", `${result.claim_id}.md`);
    const raw = await fs.readFile(file, "utf8");
    const parsed = matter(raw);
    expect(parsed.data.id).toBe(result.claim_id);
    expect(parsed.data.key).toBe("subject.domain");
    expect(parsed.data.status).toBe("active");
    expect(parsed.data.confidence).toBe(0.7);
    expect(parsed.data.authored_by).toBe("agent:charmander");
    expect(parsed.content).toContain("Body of the first fact.");
  });

  it("defaults profile scoping to [<as>] when no profile arg is given (§6.6)", async () => {
    const vault = await mkTempVault();
    const result = await claimTool.handler(
      { key: "scope.default", title: "x", body: "x", as: "agent:charmander" },
      ctx(vault),
    );
    const file = path.join(vault, "wikis", "_agents", "claim", `${result.claim_id}.md`);
    const parsed = matter(await fs.readFile(file, "utf8"));
    // Handler strips `agent:` / `profile-` prefixes so the stored profile
    // matches what `vault.agent-memory` normalizes its query input to.
    expect(parsed.data.profile).toEqual(["charmander"]);
  });

  it("treats explicit `profile: []` as a global claim (§6.6)", async () => {
    const vault = await mkTempVault();
    const result = await claimTool.handler(
      {
        key: "scope.global",
        title: "global",
        body: "global",
        as: "agent:charmander",
        profile: [],
      },
      ctx(vault),
    );
    const file = path.join(vault, "wikis", "_agents", "claim", `${result.claim_id}.md`);
    const parsed = matter(await fs.readFile(file, "utf8"));
    expect(parsed.data.profile).toEqual([]);
  });

  it("defaults confidence to 0.7 when omitted", async () => {
    const vault = await mkTempVault();
    const result = await claimTool.handler(
      { key: "default.conf", title: "t", body: "b", as: "agent:a" },
      ctx(vault),
    );
    const file = path.join(vault, "wikis", "_agents", "claim", `${result.claim_id}.md`);
    const parsed = matter(await fs.readFile(file, "utf8"));
    expect(parsed.data.confidence).toBe(0.7);
  });

  it("uses today's ISO date for created and last_validated", async () => {
    const vault = await mkTempVault();
    const today = new Date().toISOString().slice(0, 10);
    const result = await claimTool.handler(
      { key: "date.iso", title: "t", body: "b", as: "agent:a" },
      ctx(vault),
    );
    const file = path.join(vault, "wikis", "_agents", "claim", `${result.claim_id}.md`);
    const parsed = matter(await fs.readFile(file, "utf8"));
    expect(parsed.data.created).toBe(today);
    expect(parsed.data.last_validated).toBe(today);
  });
});

describe("vault.claim — supersede path", () => {
  it("supersedes existing claim when new confidence > existing's effective", async () => {
    const vault = await mkTempVault();
    // Seed an existing claim at 0.5, validated today (effective ≈ 0.5).
    const first = await claimTool.handler(
      {
        key: "x.y",
        title: "first",
        body: "first",
        confidence: 0.5,
        as: "agent:a",
      },
      ctx(vault),
    );
    expect(first.action).toBe("created");

    const second = await claimTool.handler(
      {
        key: "x.y",
        title: "second",
        body: "second",
        confidence: 0.9,
        as: "agent:a",
      },
      ctx(vault),
    );

    expect(second.action).toBe("superseded");
    expect(second.superseded_id).toBe(first.claim_id);
    expect(second.reindex_recommended).toBe(true);

    // Old claim should now have status: superseded, superseded_by: <new>.
    const oldFile = path.join(vault, "wikis", "_agents", "claim", `${first.claim_id}.md`);
    const oldParsed = matter(await fs.readFile(oldFile, "utf8"));
    expect(oldParsed.data.status).toBe("superseded");
    expect(oldParsed.data.superseded_by).toBe(second.claim_id);

    // New claim should reference the old one in supersedes[].
    const newFile = path.join(vault, "wikis", "_agents", "claim", `${second.claim_id}.md`);
    const newParsed = matter(await fs.readFile(newFile, "utf8"));
    expect(newParsed.data.supersedes).toContain(first.claim_id);
    expect(newParsed.data.status).toBe("active");

    // Both files preserved on disk.
    expect((await fs.stat(oldFile)).isFile()).toBe(true);
    expect((await fs.stat(newFile)).isFile()).toBe(true);
  });
});

describe("vault.claim — reject path", () => {
  it("rejects new claim with confidence below existing's effective", async () => {
    const vault = await mkTempVault();
    await claimTool.handler(
      { key: "r.x", title: "first", body: "first", confidence: 0.9, as: "agent:a" },
      ctx(vault),
    );
    const second = await claimTool.handler(
      { key: "r.x", title: "second", body: "second", confidence: 0.5, as: "agent:a" },
      ctx(vault),
    );
    expect(second.action).toBe("rejected");
    expect(second.rejection?.existing_effective_confidence).toBeCloseTo(0.9, 2);
    expect(second.rejection?.your_confidence).toBe(0.5);
    expect(typeof second.rejection?.suggestion).toBe("string");
    expect(typeof second.rejection?.existing_id).toBe("string");
    expect(typeof second.rejection?.reason).toBe("string");
    expect(second.reindex_recommended).toBe(true);
  });

  it("does not write a new file on rejection", async () => {
    const vault = await mkTempVault();
    await claimTool.handler(
      { key: "noop.x", title: "first", body: "first", confidence: 0.9, as: "agent:a" },
      ctx(vault),
    );
    const dirBefore = await fs.readdir(path.join(vault, "wikis", "_agents", "claim"));
    const second = await claimTool.handler(
      { key: "noop.x", title: "second", body: "second", confidence: 0.3, as: "agent:a" },
      ctx(vault),
    );
    expect(second.action).toBe("rejected");
    const dirAfter = await fs.readdir(path.join(vault, "wikis", "_agents", "claim"));
    expect(dirAfter.sort()).toEqual(dirBefore.sort());
  });
});

describe("vault.claim — override modifier", () => {
  it("forces supersession at lower confidence when override: true", async () => {
    const vault = await mkTempVault();
    const first = await claimTool.handler(
      { key: "ov.x", title: "first", body: "first", confidence: 0.9, as: "agent:a" },
      ctx(vault),
    );
    const second = await claimTool.handler(
      {
        key: "ov.x",
        title: "second",
        body: "second",
        confidence: 0.3,
        as: "agent:a",
        override: true,
      },
      ctx(vault),
    );
    expect(second.action).toBe("superseded");
    expect(second.superseded_id).toBe(first.claim_id);
  });
});

describe("vault.claim — revalidate path", () => {
  it("bumps last_validated in place; no new file", async () => {
    const vault = await mkTempVault();
    // Seed a stale claim directly via writeClaimFile so last_validated < today.
    // Profile is stored in bare-name form so it matches the handler's
    // normalization when it computes the lookup hash from `as: "agent:a"`.
    await writeClaimFile(vault, {
      id: "claim-revalidate-me",
      key: "rv.x",
      status: "active",
      confidence: 0.6,
      last_validated: "2026-01-01",
      profile: ["a"],
      authored_by: "agent:a",
    });

    // Patch in the strict-tier fields gray-matter requires for `update`.
    const file = path.join(vault, "wikis", "_agents", "claim", "claim-revalidate-me.md");
    const raw = await fs.readFile(file, "utf8");
    const parsed = matter(raw);
    parsed.data.summary = "seeded";
    parsed.data.updated = "2026-01-01";
    await fs.writeFile(file, matter.stringify(parsed.content, parsed.data), "utf8");

    const dirBefore = await fs.readdir(path.join(vault, "wikis", "_agents", "claim"));
    const today = new Date().toISOString().slice(0, 10);

    const result = await claimTool.handler(
      {
        key: "rv.x",
        as: "agent:a",
        revalidate: true,
        confidence: 0.8,
      },
      ctx(vault),
    );

    expect(result.action).toBe("revalidated");
    expect(result.claim_id).toBe("claim-revalidate-me");
    expect(result.reindex_recommended).toBe(true);

    const dirAfter = await fs.readdir(path.join(vault, "wikis", "_agents", "claim"));
    expect(dirAfter.sort()).toEqual(dirBefore.sort());

    const after = matter(await fs.readFile(file, "utf8"));
    expect(after.data.last_validated).toBe(today);
    expect(after.data.confidence).toBe(0.8);
    expect(after.data.id).toBe("claim-revalidate-me");
    expect(after.data.status).toBe("active");
  });

  it("throws when no claim exists at the identity tuple", async () => {
    const vault = await mkTempVault();
    await expect(
      claimTool.handler(
        { key: "missing.x", as: "agent:a", revalidate: true },
        ctx(vault),
      ),
    ).rejects.toThrow(/no claim to re-validate|no claim/i);
  });
});

describe("vault.claim — retract path", () => {
  it("retracts a claim authored by the calling agent", async () => {
    const vault = await mkTempVault();
    const first = await claimTool.handler(
      { key: "ret.x", title: "t", body: "b", as: "agent:a" },
      ctx(vault),
    );
    expect(first.action).toBe("created");

    const result = await claimTool.handler(
      {
        as: "agent:a",
        retract: first.claim_id,
        reason: "wrong fact",
      },
      ctx(vault),
    );
    expect(result.action).toBe("retracted");
    expect(result.claim_id).toBe(first.claim_id);
    expect(result.reindex_recommended).toBe(true);

    const file = path.join(vault, "wikis", "_agents", "claim", `${first.claim_id}.md`);
    const after = matter(await fs.readFile(file, "utf8"));
    expect(after.data.status).toBe("retracted");
    expect(after.data.retracted_by).toBe("agent:a");
    expect(after.data.retraction_reason).toBe("wrong fact");
    expect(typeof after.data.retracted_at).toBe("string");
    expect(after.data.retracted_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("throws when retract caller is not the original author (§6.7)", async () => {
    const vault = await mkTempVault();
    const first = await claimTool.handler(
      { key: "auth.x", title: "t", body: "b", as: "agent:original" },
      ctx(vault),
    );
    await expect(
      claimTool.handler(
        {
          as: "agent:imposter",
          retract: first.claim_id,
          reason: "trying to nuke another agent's claim",
        },
        ctx(vault),
      ),
    ).rejects.toThrow(/author|authored_by|retract/i);
  });

  it("throws when retract is set without a reason", async () => {
    const vault = await mkTempVault();
    const first = await claimTool.handler(
      { key: "noreas.x", title: "t", body: "b", as: "agent:a" },
      ctx(vault),
    );
    await expect(
      claimTool.handler(
        { as: "agent:a", retract: first.claim_id },
        ctx(vault),
      ),
    ).rejects.toThrow(/reason/i);
  });
});

describe("vault.claim — mutual exclusion of modifiers", () => {
  it("throws when override and revalidate are both set", async () => {
    const vault = await mkTempVault();
    await expect(
      claimTool.handler(
        {
          key: "mx.x",
          title: "t",
          body: "b",
          as: "agent:a",
          override: true,
          revalidate: true,
        },
        ctx(vault),
      ),
    ).rejects.toThrow(/mutually exclusive|exclusive/i);
  });

  it("throws when retract and override are both set", async () => {
    const vault = await mkTempVault();
    const first = await claimTool.handler(
      { key: "mx2.x", title: "t", body: "b", as: "agent:a" },
      ctx(vault),
    );
    await expect(
      claimTool.handler(
        {
          as: "agent:a",
          retract: first.claim_id,
          reason: "x",
          override: true,
        },
        ctx(vault),
      ),
    ).rejects.toThrow(/mutually exclusive|exclusive/i);
  });

  it("throws when retract and revalidate are both set", async () => {
    const vault = await mkTempVault();
    const first = await claimTool.handler(
      { key: "mx3.x", title: "t", body: "b", as: "agent:a" },
      ctx(vault),
    );
    await expect(
      claimTool.handler(
        {
          as: "agent:a",
          retract: first.claim_id,
          reason: "x",
          revalidate: true,
        },
        ctx(vault),
      ),
    ).rejects.toThrow(/mutually exclusive|exclusive/i);
  });
});

describe("vault.claim — input validation", () => {
  it("throws when key is missing on create / supersede / revalidate", async () => {
    const vault = await mkTempVault();
    await expect(
      claimTool.handler(
        { title: "x", body: "y", as: "agent:a" } as any,
        ctx(vault),
      ),
    ).rejects.toThrow(/key/i);
  });

  it("throws on confidence outside [0,1]", async () => {
    const vault = await mkTempVault();
    await expect(
      claimTool.handler(
        { key: "c.x", title: "t", body: "b", confidence: 1.5, as: "agent:a" } as any,
        ctx(vault),
      ),
    ).rejects.toThrow();
    await expect(
      claimTool.handler(
        { key: "c.x", title: "t", body: "b", confidence: -0.1, as: "agent:a" } as any,
        ctx(vault),
      ),
    ).rejects.toThrow();
  });

  it("throws when `as` is missing", async () => {
    const vault = await mkTempVault();
    await expect(
      claimTool.handler(
        { key: "missing-as.x", title: "t", body: "b" } as any,
        ctx(vault),
      ),
    ).rejects.toThrow();
  });
});

describe("vault.claim — dedup via findByIdentity", () => {
  it("create-after-supersede recognizes the new active claim, not the old one", async () => {
    const vault = await mkTempVault();
    const first = await claimTool.handler(
      { key: "dd.x", title: "first", body: "b", confidence: 0.5, as: "agent:a" },
      ctx(vault),
    );
    const second = await claimTool.handler(
      { key: "dd.x", title: "second", body: "b", confidence: 0.9, as: "agent:a" },
      ctx(vault),
    );
    expect(second.action).toBe("superseded");

    // findByIdentity must now return the NEW claim, not the superseded one.
    // scopeHash uses the bare-name profile that the handler stores after
    // stripping `agent:` from `as: "agent:a"`.
    const store = new ClaimsStore();
    const found = await store.findByIdentity(
      vault,
      "dd.x",
      scopeHash(["a"], [], [], []),
    );
    expect(found?.id).toBe(second.claim_id);
    expect(found?.id).not.toBe(first.claim_id);
  });

  it("different scope dimensions yield independent claims (no false dedup)", async () => {
    const vault = await mkTempVault();
    const a = await claimTool.handler(
      { key: "scope.iso", title: "a", body: "b", as: "agent:a" },
      ctx(vault),
    );
    const b = await claimTool.handler(
      {
        key: "scope.iso",
        title: "b",
        body: "b",
        as: "agent:a",
        move: ["move-tdd-cycle"],
      },
      ctx(vault),
    );
    expect(a.action).toBe("created");
    expect(b.action).toBe("created");
    expect(a.claim_id).not.toBe(b.claim_id);
  });
});
