// Tests for the SYNTHESIS_DEBT lint rule.
//
// Walks idx.pages, finds per-wiki tag clusters of ≥ N hard-knowledge pages
// (concept/spec/decision) with no synthesis page covering the tag in the same
// wiki. Pure helper `findSynthesisDebt(pages, minSize)` is exercised here
// with minimal IndexedPage stubs; disk integration is exercised separately
// via the integration test.
//
// Plan reference: wikis/_meta/plans/2026-05-08-substrate-adoption-quickwin.md
// §W1.2.

import { describe, it, expect } from "vitest";
import {
  findSynthesisDebt,
  SYNTHESIS_DEBT_CODE,
  DEFAULT_MIN_CLUSTER_SIZE,
} from "../../src/core/lint-checks/synthesis-debt.js";
import { lintCheckRegistry } from "../../src/core/lint-check.js";
import type { IndexedPage } from "../../src/core/index.js";
import "../../src/core/lint-checks/synthesis-debt.js";

function makeIndexedPage(overrides: Partial<IndexedPage>): IndexedPage {
  return {
    id: "concept-x",
    type: "concept",
    wiki: "test-wiki",
    title: "x",
    summary: "",
    tags: [],
    status: "active",
    updated: "2026-05-08",
    created: "2026-05-08",
    path: "wikis/test-wiki/concepts/concept-x.md",
    ...overrides,
  } as IndexedPage;
}

describe("findSynthesisDebt (pure helper)", () => {
  it("flags a 3-concept cluster on a tag with no synthesis", () => {
    const pages = [
      makeIndexedPage({ id: "concept-a", tags: ["topic"] }),
      makeIndexedPage({ id: "concept-b", tags: ["topic"] }),
      makeIndexedPage({ id: "concept-c", tags: ["topic"] }),
    ];
    const debts = findSynthesisDebt(pages);
    expect(debts).toHaveLength(1);
    expect(debts[0].wiki).toBe("test-wiki");
    expect(debts[0].tag).toBe("topic");
    expect(debts[0].contributingIds).toEqual(["concept-a", "concept-b", "concept-c"]);
  });

  it("does NOT flag when a synthesis covers the tag", () => {
    const pages = [
      makeIndexedPage({ id: "concept-a", tags: ["topic"] }),
      makeIndexedPage({ id: "concept-b", tags: ["topic"] }),
      makeIndexedPage({ id: "concept-c", tags: ["topic"] }),
      makeIndexedPage({ id: "synth-topic", type: "synthesis", tags: ["topic"] }),
    ];
    const debts = findSynthesisDebt(pages);
    expect(debts).toHaveLength(0);
  });

  it("does NOT flag when cluster is below the minimum size", () => {
    const pages = [
      makeIndexedPage({ id: "concept-a", tags: ["topic"] }),
      makeIndexedPage({ id: "concept-b", tags: ["topic"] }),
    ];
    const debts = findSynthesisDebt(pages, 3);
    expect(debts).toHaveLength(0);
  });

  it("treats clusters per-wiki, not vault-globally", () => {
    const pages = [
      makeIndexedPage({ id: "concept-a", wiki: "wiki-a", tags: ["topic"] }),
      makeIndexedPage({ id: "concept-b", wiki: "wiki-a", tags: ["topic"] }),
      makeIndexedPage({ id: "concept-c", wiki: "wiki-a", tags: ["topic"] }),
      // wiki-b has only 1 page on the tag — below threshold; no debt for wiki-b.
      makeIndexedPage({ id: "concept-d", wiki: "wiki-b", tags: ["topic"] }),
    ];
    const debts = findSynthesisDebt(pages);
    expect(debts).toHaveLength(1);
    expect(debts[0].wiki).toBe("wiki-a");
  });

  it("counts a synthesis only for its own wiki", () => {
    // wiki-a has the cluster + a wiki-b synthesis on the tag. wiki-a should
    // still be flagged because synthesis coverage is per-wiki.
    const pages = [
      makeIndexedPage({ id: "concept-a", wiki: "wiki-a", tags: ["topic"] }),
      makeIndexedPage({ id: "concept-b", wiki: "wiki-a", tags: ["topic"] }),
      makeIndexedPage({ id: "concept-c", wiki: "wiki-a", tags: ["topic"] }),
      makeIndexedPage({ id: "synth-topic", wiki: "wiki-b", type: "synthesis", tags: ["topic"] }),
    ];
    const debts = findSynthesisDebt(pages);
    expect(debts).toHaveLength(1);
    expect(debts[0].wiki).toBe("wiki-a");
  });

  it("treats concept, spec, and decision as hard-knowledge contributors", () => {
    const pages = [
      makeIndexedPage({ id: "concept-a", type: "concept", tags: ["topic"] }),
      makeIndexedPage({ id: "spec-b", type: "spec", tags: ["topic"] }),
      makeIndexedPage({ id: "decision-c", type: "decision", tags: ["topic"] }),
    ];
    const debts = findSynthesisDebt(pages);
    expect(debts).toHaveLength(1);
    expect(debts[0].contributingIds).toHaveLength(3);
  });

  it("ignores guide/source/idea/question types in the cluster count", () => {
    const pages = [
      makeIndexedPage({ id: "concept-a", type: "concept", tags: ["topic"] }),
      makeIndexedPage({ id: "guide-b", type: "guide", tags: ["topic"] }),
      makeIndexedPage({ id: "source-c", type: "source", tags: ["topic"] }),
      makeIndexedPage({ id: "idea-d", type: "idea", tags: ["topic"] }),
      makeIndexedPage({ id: "question-e", type: "question", tags: ["topic"] }),
    ];
    const debts = findSynthesisDebt(pages);
    // Only 1 hard-knowledge page → below default min (3) → no debt.
    expect(debts).toHaveLength(0);
  });

  it("emits one diagnostic per (wiki, tag) cluster — not per page", () => {
    const pages = [
      makeIndexedPage({ id: "concept-a", tags: ["topic-1", "topic-2"] }),
      makeIndexedPage({ id: "concept-b", tags: ["topic-1", "topic-2"] }),
      makeIndexedPage({ id: "concept-c", tags: ["topic-1", "topic-2"] }),
    ];
    const debts = findSynthesisDebt(pages);
    // Two debts: one per tag.
    expect(debts).toHaveLength(2);
    const tags = debts.map(d => d.tag).sort();
    expect(tags).toEqual(["topic-1", "topic-2"]);
  });

  it("ignores empty-string tags defensively", () => {
    const pages = [
      makeIndexedPage({ id: "concept-a", tags: [""] }),
      makeIndexedPage({ id: "concept-b", tags: [""] }),
      makeIndexedPage({ id: "concept-c", tags: [""] }),
    ];
    const debts = findSynthesisDebt(pages);
    expect(debts).toHaveLength(0);
  });

  it("respects custom min cluster size", () => {
    const pages = [
      makeIndexedPage({ id: "concept-a", tags: ["topic"] }),
      makeIndexedPage({ id: "concept-b", tags: ["topic"] }),
    ];
    expect(findSynthesisDebt(pages, 2)).toHaveLength(1);
    expect(findSynthesisDebt(pages, 3)).toHaveLength(0);
  });

  it("returns clusters in stable order (wiki, then tag)", () => {
    const pages = [
      makeIndexedPage({ id: "concept-a1", wiki: "wiki-b", tags: ["zzz"] }),
      makeIndexedPage({ id: "concept-a2", wiki: "wiki-b", tags: ["zzz"] }),
      makeIndexedPage({ id: "concept-a3", wiki: "wiki-b", tags: ["zzz"] }),
      makeIndexedPage({ id: "concept-b1", wiki: "wiki-a", tags: ["mmm"] }),
      makeIndexedPage({ id: "concept-b2", wiki: "wiki-a", tags: ["mmm"] }),
      makeIndexedPage({ id: "concept-b3", wiki: "wiki-a", tags: ["mmm"] }),
      makeIndexedPage({ id: "concept-c1", wiki: "wiki-a", tags: ["aaa"] }),
      makeIndexedPage({ id: "concept-c2", wiki: "wiki-a", tags: ["aaa"] }),
      makeIndexedPage({ id: "concept-c3", wiki: "wiki-a", tags: ["aaa"] }),
    ];
    const debts = findSynthesisDebt(pages);
    expect(debts.map(d => `${d.wiki}/${d.tag}`)).toEqual([
      "wiki-a/aaa",
      "wiki-a/mmm",
      "wiki-b/zzz",
    ]);
  });
});

describe("SYNTHESIS_DEBT registered LintCheck", () => {
  it("registers under code SYNTHESIS_DEBT", () => {
    const reg = lintCheckRegistry.find(c => c.code === SYNTHESIS_DEBT_CODE);
    expect(reg).toBeDefined();
  });

  it("filters by wiki when input.wiki is provided", () => {
    const reg = lintCheckRegistry.find(c => c.code === SYNTHESIS_DEBT_CODE)!;
    const idx = {
      wikis: [],
      pages: [
        makeIndexedPage({ id: "concept-a1", wiki: "wiki-a", tags: ["topic"] }),
        makeIndexedPage({ id: "concept-a2", wiki: "wiki-a", tags: ["topic"] }),
        makeIndexedPage({ id: "concept-a3", wiki: "wiki-a", tags: ["topic"] }),
        makeIndexedPage({ id: "concept-b1", wiki: "wiki-b", tags: ["topic"] }),
        makeIndexedPage({ id: "concept-b2", wiki: "wiki-b", tags: ["topic"] }),
        makeIndexedPage({ id: "concept-b3", wiki: "wiki-b", tags: ["topic"] }),
      ],
      links: {},
    };
    const all = reg.run({ vaultPath: "/tmp/x" }, idx, { wiki: undefined, level: "warning" });
    expect(all).toHaveLength(2); // both wikis flagged
    const filtered = reg.run({ vaultPath: "/tmp/x" }, idx, { wiki: "wiki-a", level: "warning" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].wiki).toBe("wiki-a");
  });

  it("emits diagnostic with severity warning, page_id stable, and a vault_synthesize suggestion", () => {
    const reg = lintCheckRegistry.find(c => c.code === SYNTHESIS_DEBT_CODE)!;
    const idx = {
      wikis: [],
      pages: [
        makeIndexedPage({ id: "concept-zzz", tags: ["topic"] }),
        makeIndexedPage({ id: "concept-aaa", tags: ["topic"] }),
        makeIndexedPage({ id: "concept-mmm", tags: ["topic"] }),
      ],
      links: {},
    };
    const out = reg.run({ vaultPath: "/tmp/x" }, idx, { wiki: undefined, level: "warning" });
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("warning");
    expect(out[0].code).toBe(SYNTHESIS_DEBT_CODE);
    expect(out[0].page_id).toBe("concept-aaa"); // alphabetically first
    expect(out[0].suggestion).toContain("vault_synthesize");
    expect(out[0].suggestion).toContain("topic");
  });
});

describe("DEFAULT_MIN_CLUSTER_SIZE constant", () => {
  it("is 3 by default", () => {
    expect(DEFAULT_MIN_CLUSTER_SIZE).toBe(3);
  });
});
