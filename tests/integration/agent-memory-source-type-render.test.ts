// vault-mcp/tests/integration/agent-memory-source-type-render.test.ts
//
// T6 of the specialist-agent-substrate DAG — verifies that `vault.agent-memory`
// renders a `[<source_type> | <effective_confidence>]` tag per claim per spec
// §5.5. The tag is informational (helps an agent calibrate trust); it does NOT
// alter the ranking algorithm (effective_confidence × (1 + scope_match)).
//
// Hermetic: temp vault per test via `mkTempVault`. Source-type frontmatter is
// written by a local fixture helper because `tests/helpers.ts:writeClaimFile`
// does not (yet) accept `source_type`.

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { mkTempVault } from "../helpers.js";
import { agentMemory } from "../../src/core/agent-memory.js";
import {
  buildClaimsIndex,
  writeClaimsIndex,
} from "../../src/core/claims-index.js";
import { formatSourceTypeTag } from "../../src/core/claim-render.js";

const TODAY = new Date("2026-05-19");

interface SourceTypeFixture {
  id: string;
  key: string;
  source_type?: "lived" | "curricular" | "retro"; // omit to test back-compat default
  confidence?: number;
  last_validated?: string;
  authored_by?: string;
  profile?: string[];
  body?: string;
}

/**
 * Write a claim file with optional `source_type` frontmatter. Diverges from
 * `tests/helpers.ts:writeClaimFile` only in that it conditionally emits the
 * `source_type` field (or omits it entirely to verify the back-compat default
 * of "lived" on the rendering side).
 */
async function writeClaimWithSourceType(
  vaultPath: string,
  c: SourceTypeFixture,
): Promise<void> {
  const dir = path.join(vaultPath, "wikis", "_agents", "claim");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${c.id}.md`);

  const fm: Record<string, unknown> = {
    id: c.id,
    type: "claim",
    title: c.id,
    created: "2026-05-02",
    key: c.key,
    status: "active",
    confidence: c.confidence ?? 0.9,
    last_validated: c.last_validated ?? "2026-05-18", // one day ago vs TODAY
    profile: c.profile ?? [],
    move: [],
    scope_wiki: [],
    tags: [],
    evidence: [],
    authored_by: c.authored_by ?? "agent:charmander",
    superseded_by: null,
    wiki: "_agents",
  };
  if (c.source_type !== undefined) fm.source_type = c.source_type;

  const yaml = Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  await fs.writeFile(
    file,
    `---\n${yaml}\n---\n\n${c.body ?? "test body"}`,
    "utf8",
  );
}

describe("formatSourceTypeTag — pure helper", () => {
  it("renders the spec §5.5 shape: [<source_type> | <eff_conf:.2>]", () => {
    const out = formatSourceTypeTag({
      source_type: "curricular",
      effective_confidence: 0.62,
    });
    expect(out).toBe("[curricular | 0.62]");
  });

  it("rounds effective_confidence to exactly 2 decimal places", () => {
    const out = formatSourceTypeTag({
      source_type: "lived",
      effective_confidence: 0.87654,
    });
    expect(out).toBe("[lived | 0.88]");
  });

  it("defaults to 'lived' when source_type is undefined (back-compat)", () => {
    const out = formatSourceTypeTag({
      source_type: undefined,
      effective_confidence: 0.71,
    });
    expect(out).toBe("[lived | 0.71]");
  });

  it("renders 'retro' source_type", () => {
    const out = formatSourceTypeTag({
      source_type: "retro",
      effective_confidence: 0.71,
    });
    expect(out).toBe("[retro | 0.71]");
  });
});

describe("vault.agent-memory — source_type tag rendering (spec §5.5)", () => {
  it("includes a source_type_tag per claim in the canonical format", async () => {
    const vault = await mkTempVault();

    await writeClaimWithSourceType(vault, {
      id: "claim-lived-a",
      key: "test.lived",
      source_type: "lived",
      confidence: 0.9,
      last_validated: "2026-05-19", // same as TODAY → no decay
    });
    await writeClaimWithSourceType(vault, {
      id: "claim-curricular-a",
      key: "test.curricular",
      source_type: "curricular",
      confidence: 0.9,
      last_validated: "2026-05-19",
    });
    await writeClaimWithSourceType(vault, {
      id: "claim-retro-a",
      key: "test.retro",
      source_type: "retro",
      confidence: 0.9,
      last_validated: "2026-05-19",
    });

    await buildClaimsIndex(vault).then((idx) =>
      writeClaimsIndex(vault, idx),
    );

    const r = agentMemory(vault, {
      agent_id: "charmander",
      today: TODAY,
    });

    const ids = r.claims.map((c) => c.id);
    expect(ids).toContain("claim-lived-a");
    expect(ids).toContain("claim-curricular-a");
    expect(ids).toContain("claim-retro-a");

    // Every claim has source_type + source_type_tag fields populated.
    for (const c of r.claims) {
      expect(c).toHaveProperty("source_type");
      expect(c).toHaveProperty("source_type_tag");
      expect(c.source_type_tag).toMatch(
        /^\[(lived|curricular|retro) \| \d\.\d{2}\]$/,
      );
    }

    const tagsById = new Map(
      r.claims.map((c) => [c.id, c.source_type_tag] as const),
    );

    expect(tagsById.get("claim-lived-a")).toBe("[lived | 0.90]");
    expect(tagsById.get("claim-curricular-a")).toBe("[curricular | 0.90]");
    expect(tagsById.get("claim-retro-a")).toBe("[retro | 0.90]");

    // Spec §5.5 integration contract: the canonical rendered string the agent
    // reads MUST begin with `[<source_type> | <eff_conf>]` inline — not as a
    // separately-addressable field. A consumer concatenating
    // `source_type_tag + body` themselves is NOT compliant; the rendered
    // string must already be one piece so the agent's literal output looks
    // like the spec example "[curricular | 0.62] In CrewTracks...".
    for (const c of r.claims) {
      expect(c).toHaveProperty("rendered");
      expect(typeof c.rendered).toBe("string");
      // Starts with the exact tag prefix followed by a single space.
      expect(c.rendered.startsWith(`${c.source_type_tag} `)).toBe(true);
      // And contains the claim's summary/body content after the prefix.
      expect(c.rendered.length).toBeGreaterThan(c.source_type_tag.length + 1);
    }

    const renderedById = new Map(
      r.claims.map((c) => [c.id, c.rendered] as const),
    );
    expect(renderedById.get("claim-lived-a")).toMatch(/^\[lived \| 0\.90\] /);
    expect(renderedById.get("claim-curricular-a")).toMatch(
      /^\[curricular \| 0\.90\] /,
    );
    expect(renderedById.get("claim-retro-a")).toMatch(/^\[retro \| 0\.90\] /);
  });

  it("rendered string contains the claim body/summary after the tag prefix (spec §5.5)", async () => {
    // Hardest variant of the integration check: the rendered string must
    // surface ACTUAL claim content (not an empty after-tag suffix). This is
    // what closes the spec-reviewer-flagged gap from commit 9a29440 — the
    // agent literally reading the output sees `[<tag>] <body>` as one piece.
    const vault = await mkTempVault();

    await writeClaimWithSourceType(vault, {
      id: "claim-with-body",
      key: "test.body",
      source_type: "curricular",
      confidence: 0.9,
      last_validated: "2026-05-19",
      body: "In CrewTracks, integration tests use the harness at apps/api/test/db-harness.ts.",
    });

    await buildClaimsIndex(vault).then((idx) =>
      writeClaimsIndex(vault, idx),
    );

    const r = agentMemory(vault, {
      agent_id: "charmander",
      today: TODAY,
    });

    const c = r.claims.find((x) => x.id === "claim-with-body");
    expect(c).toBeDefined();
    expect(c!.rendered).toContain("[curricular | 0.90]");
    expect(c!.rendered).toContain("In CrewTracks");
    // Exact prefix shape: `[curricular | 0.90] In CrewTracks...`
    expect(c!.rendered).toMatch(/^\[curricular \| 0\.90\] In CrewTracks/);
  });

  it("defaults to 'lived' when claim has no source_type field (back-compat)", async () => {
    const vault = await mkTempVault();

    await writeClaimWithSourceType(vault, {
      id: "claim-legacy",
      key: "test.legacy",
      // intentionally omitted source_type — old-format claim
      confidence: 0.8,
      last_validated: "2026-05-19",
    });

    await buildClaimsIndex(vault).then((idx) =>
      writeClaimsIndex(vault, idx),
    );

    const r = agentMemory(vault, {
      agent_id: "charmander",
      today: TODAY,
    });

    const c = r.claims.find((x) => x.id === "claim-legacy");
    expect(c).toBeDefined();
    // ClaimDraft.source_type defaults to "lived" — verify the rendered tag
    // mirrors that default so older indexed claims still get a sensible tag.
    expect(c!.source_type).toBe("lived");
    expect(c!.source_type_tag).toBe("[lived | 0.80]");
  });

  it("ranking is unchanged: source_type does NOT alter score ordering", async () => {
    // Seed three claims with identical confidence + last_validated but
    // different source_types. The ranking algorithm
    // (effective_confidence × (1 + scope_match)) does not consult
    // source_type, so the order is determined purely by the id tie-break.
    const vault = await mkTempVault();

    await writeClaimWithSourceType(vault, {
      id: "claim-aaa-retro",
      key: "test.aaa",
      source_type: "retro",
      confidence: 0.8,
      last_validated: "2026-05-19",
    });
    await writeClaimWithSourceType(vault, {
      id: "claim-bbb-curricular",
      key: "test.bbb",
      source_type: "curricular",
      confidence: 0.8,
      last_validated: "2026-05-19",
    });
    await writeClaimWithSourceType(vault, {
      id: "claim-ccc-lived",
      key: "test.ccc",
      source_type: "lived",
      confidence: 0.8,
      last_validated: "2026-05-19",
    });

    await buildClaimsIndex(vault).then((idx) =>
      writeClaimsIndex(vault, idx),
    );

    const r = agentMemory(vault, {
      agent_id: "charmander",
      today: TODAY,
    });

    // All three identical-score → tie-break by id ascending.
    expect(r.claims.map((c) => c.id)).toEqual([
      "claim-aaa-retro",
      "claim-bbb-curricular",
      "claim-ccc-lived",
    ]);
    // Scores must be identical (source_type didn't enter the formula).
    const scores = new Set(r.claims.map((c) => c.score));
    expect(scores.size).toBe(1);
  });
});
