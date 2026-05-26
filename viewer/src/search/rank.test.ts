import { it, expect } from "vitest";
import { rankNodes } from "./rank.js";

const mk = (id: string, title: string, summary = "", tags: string[] = []) => ({
  id,
  title,
  summary,
  wiki: "w",
  type: "concept",
  tags,
  status: "active",
  updated: "",
  path: "",
  degree: 0,
});

it("ranks title match above summary-only match and ignores empty query", () => {
  const nodes = [mk("a", "alpha", "mentions recipe"), mk("b", "recipe book")];
  expect(rankNodes("", nodes)).toEqual([]);
  expect(rankNodes("recipe", nodes)[0].id).toBe("b");
});

it("returns empty array for whitespace-only query", () => {
  const nodes = [mk("a", "alpha")];
  expect(rankNodes("   ", nodes)).toEqual([]);
  expect(rankNodes("\t", nodes)).toEqual([]);
});

it("exact id or title match scores highest (100)", () => {
  const nodes = [
    mk("exact-id", "something else", "exact-id in summary"),
    mk("other", "exact title"),
    mk("another", "partial title match"),
  ];
  const byId = rankNodes("exact-id", nodes);
  expect(byId[0].id).toBe("exact-id");
  expect(byId[0].score).toBe(100);

  const byTitle = rankNodes("exact title", nodes);
  expect(byTitle[0].id).toBe("other");
  expect(byTitle[0].score).toBe(100);
});

it("title prefix ranks above title substring", () => {
  const nodes = [
    mk("a", "my search results"),  // substring match (50)
    mk("b", "searchable term"),    // prefix match (70)
  ];
  const hits = rankNodes("search", nodes);
  expect(hits[0].id).toBe("b");
  expect(hits[0].score).toBe(70);
  expect(hits[1].id).toBe("a");
  expect(hits[1].score).toBe(50);
});

it("tag match ranks below title substring but above id substring and summary", () => {
  const nodes = [
    mk("a", "no match here", "no match here", ["alpha-tag"]),   // tag match (35)
    mk("b", "no match here", "alpha in summary"),                // summary match (15)
    mk("alpha-id", "no match here"),                             // id substring (25)
  ];
  const hits = rankNodes("alpha", nodes);
  expect(hits[0].id).toBe("a");
  expect(hits[0].score).toBe(35);
  expect(hits[1].id).toBe("alpha-id");
  expect(hits[1].score).toBe(25);
  expect(hits[2].id).toBe("b");
  expect(hits[2].score).toBe(15);
});

it("matching is case-insensitive", () => {
  const nodes = [mk("MyNode", "HELLO WORLD", "Some Summary", ["TAG-ONE"])];
  expect(rankNodes("hello world", nodes)[0].score).toBe(100);
  expect(rankNodes("MYNODE", nodes)[0].score).toBe(100);
  expect(rankNodes("TAG-ONE", nodes)[0].score).toBe(35);
  expect(rankNodes("some summary", nodes)[0].score).toBe(15);
});

it("results are sorted by descending score and capped at limit", () => {
  const nodes = Array.from({ length: 30 }, (_, i) =>
    mk(`node-${i}`, `item ${i}`, `item ${i} detail`)
  );
  const hits = rankNodes("item", nodes, 10);
  expect(hits.length).toBe(10);
  for (let i = 1; i < hits.length; i++) {
    expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
  }
});

it("nodes with no match are excluded", () => {
  const nodes = [mk("a", "unrelated"), mk("b", "also unrelated")];
  const hits = rankNodes("xyz123", nodes);
  expect(hits).toEqual([]);
});
