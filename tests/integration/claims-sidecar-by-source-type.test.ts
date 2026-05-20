// vault-mcp/tests/integration/claims-sidecar-by-source-type.test.ts
//
// T4 of specialist-agent-substrate DAG — integration test for the
// `by_source_type` bucket added to `_index/claims.json`.
//
// Spec §5.3: extend ClaimsIndex with by_source_type, bump schema_version to 3,
// populate the bucket in buildClaimsIndex, and add --source-type= filter to
// list-claims.
//
// Hermetic: every test runs against mkTempVault under os.tmpdir(); nothing
// reads or writes the live vault root.

import { describe, it, expect, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { mkTempVault, writeClaimFile, callTool } from "../helpers.js";
import { buildClaimsIndex, writeClaimsIndex } from "../../src/core/claims-index.js";

describe("claims sidecar by_source_type bucket (T4)", () => {
  const created: string[] = [];
  afterEach(() => {
    while (created.length > 0) {
      const v = created.pop()!;
      try {
        rmSync(v, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  });

  /**
   * Seed a vault with exactly 6 claims: 2 lived, 2 curricular, 2 retro.
   * All active, scoped to profile "profile-x" so they don't fall into the
   * global bucket. source_type is injected by inserting it before the closing
   * frontmatter fence (`---`).
   */
  async function seedFixture(vault: string): Promise<void> {
    const sourceTypes = ["lived", "curricular", "retro"] as const;
    let n = 0;
    for (const st of sourceTypes) {
      for (let i = 0; i < 2; i++) {
        await writeClaimFile(vault, {
          id: `claim-${st}-${i}`,
          key: `test.${st}.${n++}`,
          status: "active",
          confidence: 0.8,
          profile: ["profile-x"],
          last_validated: "2026-05-01",
        });
        // Inject source_type into the frontmatter. writeClaimFile writes:
        //   ---\nkey: val\n...\n---\n\nbody
        // We insert before the closing fence by splitting on `\n---\n`.
        const filePath = path.join(vault, "wikis", "_agents", "claim", `claim-${st}-${i}.md`);
        const raw = await fs.readFile(filePath, "utf8");
        // Replace the last occurrence of \n---\n (closing fence + trailing newline)
        const patched = raw.replace(/\n---\n/, `\nsource_type: "${st}"\n---\n`);
        await fs.writeFile(filePath, patched, "utf8");
      }
    }
  }

  it("buildClaimsIndex populates all three by_source_type buckets with exactly 2 entries each", async () => {
    const vault = await mkTempVault();
    created.push(vault);
    await seedFixture(vault);

    const idx = await buildClaimsIndex(vault);

    // schema_version must be 3
    expect(idx.schema_version).toBe(3);

    // All three keys must always be present (even if empty)
    expect(idx.by_source_type).toBeDefined();
    expect(idx.by_source_type).toHaveProperty("lived");
    expect(idx.by_source_type).toHaveProperty("curricular");
    expect(idx.by_source_type).toHaveProperty("retro");

    // Each bucket has exactly 2 entries
    expect(idx.by_source_type.lived).toHaveLength(2);
    expect(idx.by_source_type.curricular).toHaveLength(2);
    expect(idx.by_source_type.retro).toHaveLength(2);

    // Correct claim IDs per bucket
    expect(idx.by_source_type.lived.sort()).toEqual(["claim-lived-0", "claim-lived-1"]);
    expect(idx.by_source_type.curricular.sort()).toEqual(["claim-curricular-0", "claim-curricular-1"]);
    expect(idx.by_source_type.retro.sort()).toEqual(["claim-retro-0", "claim-retro-1"]);
  });

  it("emitted sidecar JSON has schema_version 3 and by_source_type with all three keys", async () => {
    const vault = await mkTempVault();
    created.push(vault);
    await seedFixture(vault);

    const idx = await buildClaimsIndex(vault);
    await writeClaimsIndex(vault, idx);

    const raw = await fs.readFile(path.join(vault, "_index", "claims.json"), "utf8");
    const parsed = JSON.parse(raw);

    expect(parsed.schema_version).toBe(3);
    expect(parsed.by_source_type).toBeDefined();
    expect(parsed.by_source_type.lived).toHaveLength(2);
    expect(parsed.by_source_type.curricular).toHaveLength(2);
    expect(parsed.by_source_type.retro).toHaveLength(2);
  });

  it("by_source_type buckets are always present even when no claims exist of that type", async () => {
    const vault = await mkTempVault();
    created.push(vault);
    // Seed only lived claims
    await writeClaimFile(vault, {
      id: "claim-lived-only",
      key: "test.lived.only",
      status: "active",
      confidence: 0.8,
      profile: ["profile-x"],
      last_validated: "2026-05-01",
    });
    // Inject source_type into the frontmatter (before closing fence).
    const filePath = path.join(vault, "wikis", "_agents", "claim", "claim-lived-only.md");
    const raw = await fs.readFile(filePath, "utf8");
    const patched = raw.replace(/\n---\n/, '\nsource_type: "lived"\n---\n');
    await fs.writeFile(filePath, patched, "utf8");

    const idx = await buildClaimsIndex(vault);

    expect(idx.by_source_type.lived).toHaveLength(1);
    expect(idx.by_source_type.curricular).toHaveLength(0);
    expect(idx.by_source_type.retro).toHaveLength(0);
  });

  it("list-claims --source-type=curricular returns only the 2 curricular claims", async () => {
    const vault = await mkTempVault();
    created.push(vault);
    await seedFixture(vault);

    const idx = await buildClaimsIndex(vault);
    await writeClaimsIndex(vault, idx);

    const result = await callTool(
      "vault_list-claims",
      { source_type: "curricular", status: ["active"], limit: 100 },
      vault,
    );

    expect(result.claims).toHaveLength(2);
    const ids = result.claims.map((c: { id: string }) => c.id).sort();
    expect(ids).toEqual(["claim-curricular-0", "claim-curricular-1"]);
  });

  it("list-claims without --source-type returns all 6 claims (unchanged behavior)", async () => {
    const vault = await mkTempVault();
    created.push(vault);
    await seedFixture(vault);

    const idx = await buildClaimsIndex(vault);
    await writeClaimsIndex(vault, idx);

    const result = await callTool(
      "vault_list-claims",
      { status: ["active"], limit: 100, min_effective_confidence: 0 },
      vault,
    );

    expect(result.claims).toHaveLength(6);
  });

  it("list-claims --source-type=lived returns only the 2 lived claims", async () => {
    const vault = await mkTempVault();
    created.push(vault);
    await seedFixture(vault);

    const idx = await buildClaimsIndex(vault);
    await writeClaimsIndex(vault, idx);

    const result = await callTool(
      "vault_list-claims",
      { source_type: "lived", status: ["active"], limit: 100 },
      vault,
    );

    expect(result.claims).toHaveLength(2);
    const ids = result.claims.map((c: { id: string }) => c.id).sort();
    expect(ids).toEqual(["claim-lived-0", "claim-lived-1"]);
  });

  it("list-claims --source-type=retro returns only the 2 retro claims", async () => {
    const vault = await mkTempVault();
    created.push(vault);
    await seedFixture(vault);

    const idx = await buildClaimsIndex(vault);
    await writeClaimsIndex(vault, idx);

    const result = await callTool(
      "vault_list-claims",
      { source_type: "retro", status: ["active"], limit: 100 },
      vault,
    );

    expect(result.claims).toHaveLength(2);
    const ids = result.claims.map((c: { id: string }) => c.id).sort();
    expect(ids).toEqual(["claim-retro-0", "claim-retro-1"]);
  });
});
