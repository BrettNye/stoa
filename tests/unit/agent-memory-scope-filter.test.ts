// vault-mcp/tests/unit/agent-memory-scope-filter.test.ts
//
// Tests for the three-way claim inclusion predicate (§6):
//
//   include claim C IF:
//     ( C.scope_wiki empty OR C.scope_wiki intersects S.scope_wiki )
//     AND
//     ( C.authored_by == "agent:<A>"
//       OR C.profile contains <A>
//       OR (C.profile empty AND scope_match(C,S) > 0) )
//     AND C.status == "active"
//     AND effective_confidence(C, today) >= 0.4

import { describe, it, expect } from "vitest";
import { mkTempVault, writeClaimFile } from "../helpers.js";
import { agentMemory } from "../../src/core/agent-memory.js";
import { buildClaimsIndex, writeClaimsIndex } from "../../src/core/claims-index.js";
import { promises as fs } from "node:fs";
import path from "node:path";

const TODAY = new Date("2026-05-02");

async function seedAndIndex(
  claims: Parameters<typeof writeClaimFile>[1][],
): Promise<string> {
  const vault = await mkTempVault();
  for (const c of claims) await writeClaimFile(vault, c);
  const idx = await buildClaimsIndex(vault);
  await writeClaimsIndex(vault, idx);
  return vault;
}

describe("agent-memory scope filter — authored_by predicate (branch 1)", () => {
  it("includes a claim authored by 'agent:<A>' even with no profile match", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-authored",
        key: "test.authored",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
    ]);

    const result = agentMemory(vault, { agent_id: "charmander", today: TODAY });
    expect(result.claims.map((c) => c.id)).toContain("claim-authored");
  });

  it("excludes a claim authored by a different agent when no other predicate matches", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-other-author",
        key: "test.other",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:pidgey",
      },
    ]);

    // No tags/scope_wiki → scope_match = 0; profile doesn't contain charmander
    const result = agentMemory(vault, { agent_id: "charmander", today: TODAY });
    expect(result.claims.map((c) => c.id)).not.toContain("claim-other-author");
  });
});

describe("agent-memory scope filter — profile predicate (branch 2)", () => {
  it("includes a claim where profile contains the agent", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-profile-targeted",
        key: "test.profile",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: ["charmander"],
        scope_wiki: [],
        authored_by: "agent:other",
      },
    ]);

    const result = agentMemory(vault, { agent_id: "charmander", today: TODAY });
    expect(result.claims.map((c) => c.id)).toContain("claim-profile-targeted");
  });

  it("excludes a claim targeted to a different profile when authored_by doesn't match", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-wrong-profile",
        key: "test.wrong-profile",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: ["pidgey"],
        scope_wiki: [],
        authored_by: "agent:other",
      },
    ]);

    const result = agentMemory(vault, { agent_id: "charmander", today: TODAY });
    expect(result.claims.map((c) => c.id)).not.toContain("claim-wrong-profile");
  });
});

describe("agent-memory scope filter — global-with-scope-match predicate (branch 3)", () => {
  it("includes a claim with empty profile when scope_match > 0", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-global-scoped",
        key: "test.global-scoped",
        status: "active",
        confidence: 0.7,
        tags: ["typescript"],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:other",
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      tags: ["typescript"],
      today: TODAY,
    });
    expect(result.claims.map((c) => c.id)).toContain("claim-global-scoped");
  });

  it("excludes a global-profile claim when scope_match = 0 (no scope inputs)", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-global-no-scope",
        key: "test.global-no-scope",
        status: "active",
        confidence: 0.7,
        tags: ["typescript"],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:other",
      },
    ]);

    // No tags/scope_wiki → scope_match = 0 for branch 3 predicate
    const result = agentMemory(vault, { agent_id: "charmander", today: TODAY });
    expect(result.claims.map((c) => c.id)).not.toContain("claim-global-no-scope");
  });
});

describe("agent-memory scope filter — wiki AND-guard", () => {
  it("includes a wiki-scoped claim when scope_wiki matches", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-wiki-included",
        key: "test.wiki-incl",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: ["project-alpha"],
        authored_by: "agent:charmander",
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      scope_wiki: ["project-alpha"],
      today: TODAY,
    });
    expect(result.claims.map((c) => c.id)).toContain("claim-wiki-included");
  });

  it("excludes a wiki-scoped claim when scope_wiki does not intersect", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-wiki-excluded",
        key: "test.wiki-excl",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: ["project-beta"],
        authored_by: "agent:charmander",
      },
    ]);

    // Even though authored_by matches, the wiki guard blocks it
    const result = agentMemory(vault, {
      agent_id: "charmander",
      scope_wiki: ["project-alpha"],
      today: TODAY,
    });
    expect(result.claims.map((c) => c.id)).not.toContain("claim-wiki-excluded");
  });

  it("includes a universal (scope_wiki empty) claim regardless of scope_wiki filter", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-universal",
        key: "test.universal",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      scope_wiki: ["project-alpha"],
      today: TODAY,
    });
    expect(result.claims.map((c) => c.id)).toContain("claim-universal");
  });
});

describe("agent-memory scope filter — below-floor cutoff", () => {
  it("excludes claims with effective_confidence < 0.4", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-low-conf",
        key: "test.low",
        status: "active",
        confidence: 0.35,
        last_validated: "2026-05-02",
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
    ]);

    const result = agentMemory(vault, { agent_id: "charmander", today: TODAY });
    expect(result.claims.map((c) => c.id)).not.toContain("claim-low-conf");
  });

  it("includes claims with effective_confidence exactly 0.4", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-exact-floor",
        key: "test.floor",
        status: "active",
        confidence: 0.4,
        last_validated: "2026-05-02",
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
    ]);

    const result = agentMemory(vault, { agent_id: "charmander", today: TODAY });
    expect(result.claims.map((c) => c.id)).toContain("claim-exact-floor");
  });
});

describe("agent-memory scope filter — task-derived scope (§6.1 + §6.2)", () => {
  async function writeTaskFile(
    vault: string,
    taskId: string,
    wiki: string,
    tags: string[],
  ): Promise<void> {
    const dir = path.join(vault, "wikis", wiki, "tasks");
    await fs.mkdir(dir, { recursive: true });
    const fm = [
      `id: ${JSON.stringify(taskId)}`,
      `type: "task"`,
      `title: ${JSON.stringify(taskId)}`,
      `created: "2026-05-02"`,
      `wiki: ${JSON.stringify(wiki)}`,
      `status: "draft"`,
      `summary: "test task"`,
      `updated: "2026-05-02"`,
      `tags: ${JSON.stringify(tags)}`,
    ].join("\n");
    await fs.writeFile(path.join(dir, `${taskId}.md`), `---\n${fm}\n---\n\nbody\n`, "utf8");
  }

  it("derives scope_wiki from task's wiki field when scope_wiki arg is absent", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-wiki-task-derived",
        key: "test.wiki-task-derived",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: ["project-gamma"],
        authored_by: "agent:charmander",
      },
    ]);
    await writeTaskFile(vault, "task-foo", "project-gamma", []);

    // No explicit scope_wiki; task-derived wiki should allow this wiki-scoped claim through
    const result = agentMemory(vault, {
      agent_id: "charmander",
      task: "task-foo",
      today: TODAY,
    });
    expect(result.claims.map((c) => c.id)).toContain("claim-wiki-task-derived");
  });

  it("merges task-derived tags with explicit tags for scope matching", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-task-tag-merged",
        key: "test.task-tag-merged",
        status: "active",
        confidence: 0.7,
        tags: ["typescript"],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:other",
      },
    ]);
    await writeTaskFile(vault, "task-bar", "_agents", ["typescript"]);

    // No explicit tags, but task has "typescript" tag — should trigger scope match
    const result = agentMemory(vault, {
      agent_id: "charmander",
      task: "task-bar",
      today: TODAY,
    });
    expect(result.claims.map((c) => c.id)).toContain("claim-task-tag-merged");
  });

  it("explicit scope_wiki arg wins over task-derived wiki (§6.1 precedence)", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-explicit-wiki-wins",
        key: "test.explicit-wiki-wins",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: ["project-explicit"],
        authored_by: "agent:charmander",
      },
      {
        id: "claim-task-wiki-blocked",
        key: "test.task-wiki-blocked",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: ["project-gamma"],
        authored_by: "agent:charmander",
      },
    ]);
    // Task's wiki is "project-gamma", but explicit scope_wiki overrides it
    await writeTaskFile(vault, "task-baz", "project-gamma", []);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      task: "task-baz",
      scope_wiki: ["project-explicit"],
      today: TODAY,
    });

    // explicit scope_wiki wins → only project-explicit-scoped claim should be reachable
    expect(result.claims.map((c) => c.id)).toContain("claim-explicit-wiki-wins");
    expect(result.claims.map((c) => c.id)).not.toContain("claim-task-wiki-blocked");
  });

  it("explicit tags are merged with task-derived tags (concat + dedupe)", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-merged-both-tags",
        key: "test.merged-both",
        status: "active",
        confidence: 0.7,
        tags: ["rust"],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:other",
      },
    ]);
    // Task has tag "python"; explicit call has tag "rust"
    await writeTaskFile(vault, "task-qux", "_agents", ["python"]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      task: "task-qux",
      tags: ["rust"],
      today: TODAY,
    });
    // "rust" tag claim should be matched via the explicit tag
    expect(result.claims.map((c) => c.id)).toContain("claim-merged-both-tags");
    // scope_used.tags should contain both
    expect(result.scope_used.tags).toContain("rust");
    expect(result.scope_used.tags).toContain("python");
  });

  it("tags are deduped when same tag appears in both explicit and task-derived", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-dedup-tag",
        key: "test.dedup",
        status: "active",
        confidence: 0.7,
        tags: ["shared"],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:other",
      },
    ]);
    await writeTaskFile(vault, "task-dedup", "_agents", ["shared"]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      task: "task-dedup",
      tags: ["shared"],
      today: TODAY,
    });
    // "shared" should appear only once in scope_used.tags
    expect(result.scope_used.tags.filter((t) => t === "shared")).toHaveLength(1);
  });

  it("on task-page read failure, falls back to non-task scope without throwing (§8.3 soft warning)", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-fallback-ok",
        key: "test.fallback",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
    ]);
    // task-missing does NOT exist on disk

    // Should not throw; should return result as if task were absent
    const result = agentMemory(vault, {
      agent_id: "charmander",
      task: "task-missing",
      today: TODAY,
    });
    // authored_by claim still surfaced; no crash
    expect(result.claims.map((c) => c.id)).toContain("claim-fallback-ok");
  });
});

describe("agent-memory scope filter — status exclusion", () => {
  it("excludes superseded claims", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-active-base",
        key: "test.base",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
      {
        id: "claim-superseded",
        key: "test.superseded",
        status: "superseded",
        confidence: 0.8,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        superseded_by: "claim-active-base",
      },
    ]);

    const result = agentMemory(vault, { agent_id: "charmander", today: TODAY });
    expect(result.claims.map((c) => c.id)).not.toContain("claim-superseded");
  });

  it("excludes retracted claims", async () => {
    const vault = await mkTempVault();
    // Write a retracted claim manually (helpers don't support full retraction fields)
    const dir = path.join(vault, "wikis", "_agents", "claim");
    await fs.mkdir(dir, { recursive: true });
    const fm = {
      id: "claim-retracted",
      type: "claim",
      title: "claim-retracted",
      created: "2026-05-02",
      key: "test.retracted",
      status: "retracted",
      confidence: 0.8,
      last_validated: "2026-05-02",
      profile: [],
      move: [],
      scope_wiki: [],
      tags: [],
      evidence: [],
      authored_by: "agent:charmander",
      superseded_by: null,
      wiki: "_agents",
      summary: "retracted claim",
      updated: "2026-05-02",
      retracted_at: "2026-05-02",
      retracted_by: "human:brett",
      retraction_reason: "test",
    };
    const yaml = Object.entries(fm)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("\n");
    await fs.writeFile(path.join(dir, "claim-retracted.md"), `---\n${yaml}\n---\n\nbody\n`);
    const { buildClaimsIndex: bci, writeClaimsIndex: wci } = await import("../../src/core/claims-index.js");
    const idx = await bci(vault);
    await wci(vault, idx);

    const result = agentMemory(vault, { agent_id: "charmander", today: TODAY });
    expect(result.claims.map((c) => c.id)).not.toContain("claim-retracted");
  });

  it("excludes draft claims", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-draft",
        key: "test.draft",
        status: "draft",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
    ]);

    const result = agentMemory(vault, { agent_id: "charmander", today: TODAY });
    expect(result.claims.map((c) => c.id)).not.toContain("claim-draft");
  });
});
