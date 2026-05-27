import { it, expect, describe } from "vitest";
import { selectLabeledIds, type LabelCandidate, type LabelParams } from "./select.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReal(id: string, degree: number, distance: number): LabelCandidate {
  return { id, degree, distance, isRegion: false };
}

function makeRegion(id: string, degree: number, distance: number): LabelCandidate {
  return { id, degree, distance, isRegion: true };
}

// ---------------------------------------------------------------------------
// Acceptance criterion 1: Region nodes are always included, regardless of budget or distance
// ---------------------------------------------------------------------------

it("labels region nodes regardless of budget (budget=0)", () => {
  const ids = selectLabeledIds(
    [makeRegion("wiki:a", 1, 999)],
    { hubCount: 0, budget: 0 },
  );
  expect(ids).toContain("wiki:a");
});

it("labels region nodes regardless of maxDistance", () => {
  const ids = selectLabeledIds(
    [makeRegion("wiki:a", 1, 999)],
    { hubCount: 0, budget: 0, maxDistance: 10 },
  );
  expect(ids).toContain("wiki:a");
});

it("labels multiple region nodes when budget is 0", () => {
  const ids = selectLabeledIds(
    [makeRegion("wiki:a", 1, 999), makeRegion("wiki:b", 2, 500)],
    { hubCount: 0, budget: 0 },
  );
  expect(ids).toContain("wiki:a");
  expect(ids).toContain("wiki:b");
});

// ---------------------------------------------------------------------------
// Acceptance criterion 2: Top hubCount real nodes by degree count toward budget
// ---------------------------------------------------------------------------

it("includes top hubCount nodes by degree", () => {
  const candidates = [
    makeReal("a", 10, 100),
    makeReal("b", 5, 100),
    makeReal("c", 1, 100),
  ];
  // budget=2, hubCount=2 → only a and b (the top 2 hubs) fit; budget is full
  const ids = selectLabeledIds(candidates, { hubCount: 2, budget: 2 });
  expect(ids).toContain("a");
  expect(ids).toContain("b");
  expect(ids).not.toContain("c"); // not a hub, budget full — proximity fill excluded
});

it("hubs count toward budget", () => {
  const candidates = [
    makeReal("a", 10, 100),
    makeReal("b", 5, 100),
    makeReal("c", 1, 50),
  ];
  // budget=2, hubCount=2 → only hubs, no room for proximity
  const ids = selectLabeledIds(candidates, { hubCount: 2, budget: 2 });
  expect(ids).toContain("a");
  expect(ids).toContain("b");
  expect(ids).not.toContain("c");
});

it("hub tie-break: higher degree wins, then id lexicographic", () => {
  const candidates = [
    makeReal("z", 5, 100),
    makeReal("a", 5, 100),
    makeReal("b", 3, 100),
  ];
  // hubCount=1, budget=1 → only the top hub; tie between z and a → "a" wins (localeCompare ascending)
  const ids = selectLabeledIds(candidates, { hubCount: 1, budget: 1 });
  expect(ids).toContain("a");
  expect(ids).not.toContain("z");
  expect(ids).not.toContain("b");
});

// ---------------------------------------------------------------------------
// Acceptance criterion 3: Total real-node count never exceeds budget
// ---------------------------------------------------------------------------

it("total real-node ids never exceeds budget", () => {
  const candidates = Array.from({ length: 10 }, (_, i) =>
    makeReal(`node-${i}`, i, i * 10)
  );
  const budget = 3;
  const ids = selectLabeledIds(candidates, { hubCount: 1, budget });
  const realIds = ids.filter((id) => !id.startsWith("wiki:"));
  expect(realIds.length).toBeLessThanOrEqual(budget);
});

it("region ids do not count against budget", () => {
  const candidates = [
    makeRegion("wiki:x", 1, 999),
    makeRegion("wiki:y", 1, 999),
    makeReal("a", 10, 10),
    makeReal("b", 5, 20),
    makeReal("c", 1, 30),
  ];
  // budget=2, hubCount=1 → hub a + proximity b; regions do not count
  const ids = selectLabeledIds(candidates, { hubCount: 1, budget: 2 });
  expect(ids).toContain("wiki:x");
  expect(ids).toContain("wiki:y");
  const realIds = ids.filter((id) => !id.startsWith("wiki:"));
  expect(realIds.length).toBeLessThanOrEqual(2);
});

// ---------------------------------------------------------------------------
// Acceptance criterion 4: Proximity fill by ascending distance
// ---------------------------------------------------------------------------

it("proximity fill selects by ascending distance after hubs", () => {
  const candidates = [
    makeReal("hub", 10, 999),
    makeReal("near", 1, 10),
    makeReal("far", 1, 500),
    makeReal("mid", 1, 100),
  ];
  // hubCount=1, budget=3 → hub + near + mid (2 proximity slots)
  const ids = selectLabeledIds(candidates, { hubCount: 1, budget: 3 });
  expect(ids).toContain("hub");
  expect(ids).toContain("near");
  expect(ids).toContain("mid");
  expect(ids).not.toContain("far");
});

it("proximity tie-break: higher degree first, then id", () => {
  const candidates = [
    makeReal("hub", 10, 999),
    makeReal("b", 3, 50),
    makeReal("a", 5, 50),
    makeReal("z", 5, 50),
  ];
  // hubCount=1, budget=3 → hub + 2 proximity slots (a and b or z...)
  // tie on distance=50: degree 5 beats 3, then between a and z: "a" wins
  const ids = selectLabeledIds(candidates, { hubCount: 1, budget: 3 });
  expect(ids).toContain("hub");
  expect(ids).toContain("a");
  // With only 2 proximity slots (budget=3, 1 used by hub), we get a+b or a+z
  // a and z both have degree=5 at distance=50, z comes after a → a wins
  expect(ids).toContain("z"); // both fit in the 2 slots
  expect(ids).not.toContain("b"); // degree 3 loses to degree 5
});

// ---------------------------------------------------------------------------
// Acceptance criterion 5: hoveredId always wins, even beyond budget
// ---------------------------------------------------------------------------

it("hoveredId is included even when budget is full", () => {
  const candidates = [
    makeReal("a", 10, 10),
    makeReal("b", 9, 20),
    makeReal("hovered", 1, 999),
  ];
  // budget=2, hubCount=2 → a and b fill the budget, but hovered still wins
  const ids = selectLabeledIds(candidates, {
    hubCount: 2,
    budget: 2,
    hoveredId: "hovered",
  });
  expect(ids).toContain("hovered");
});

it("hoveredId is ignored when not among candidates", () => {
  const candidates = [makeReal("a", 5, 10)];
  const ids = selectLabeledIds(candidates, {
    hubCount: 1,
    budget: 5,
    hoveredId: "nonexistent",
  });
  expect(ids).not.toContain("nonexistent");
});

it("hoveredId=null does not throw or add null entries", () => {
  const candidates = [makeReal("a", 5, 10)];
  const ids = selectLabeledIds(candidates, {
    hubCount: 1,
    budget: 5,
    hoveredId: null,
  });
  expect(ids).not.toContain(null);
  expect(ids).toContain("a");
});

// ---------------------------------------------------------------------------
// Acceptance criterion 6: maxDistance excludes far nodes from proximity fill
// ---------------------------------------------------------------------------

it("maxDistance excludes far nodes from proximity fill", () => {
  const candidates = [
    makeReal("hub", 10, 999),
    makeReal("near", 1, 10),
    makeReal("far", 1, 500),
  ];
  const ids = selectLabeledIds(candidates, {
    hubCount: 1,
    budget: 3,
    maxDistance: 100,
  });
  expect(ids).toContain("hub");  // hub ignores maxDistance
  expect(ids).toContain("near");
  expect(ids).not.toContain("far");
});

it("maxDistance does not exclude hubs", () => {
  const candidates = [
    makeReal("hub", 10, 9999),
  ];
  const ids = selectLabeledIds(candidates, {
    hubCount: 1,
    budget: 5,
    maxDistance: 10,
  });
  expect(ids).toContain("hub");
});

it("maxDistance does not exclude the hovered node", () => {
  const candidates = [
    makeReal("hovered", 1, 9999),
  ];
  const ids = selectLabeledIds(candidates, {
    hubCount: 0,
    budget: 0,
    maxDistance: 10,
    hoveredId: "hovered",
  });
  expect(ids).toContain("hovered");
});

// ---------------------------------------------------------------------------
// Acceptance criterion 7: Empty candidates → []; Deterministic output
// ---------------------------------------------------------------------------

it("returns empty array for empty candidates", () => {
  expect(selectLabeledIds([], { hubCount: 5, budget: 10 })).toEqual([]);
});

it("output is deterministic for identical input", () => {
  const candidates = [
    makeReal("a", 5, 100),
    makeReal("b", 3, 50),
    makeRegion("wiki:x", 1, 999),
    makeReal("c", 7, 200),
  ];
  const params: LabelParams = { hubCount: 2, budget: 3, maxDistance: 500 };
  const first = selectLabeledIds(candidates, params);
  const second = selectLabeledIds(candidates, params);
  expect(first).toEqual(second);
});

it("output is deterministic regardless of candidate input order", () => {
  const c1 = makeReal("a", 5, 100);
  const c2 = makeReal("b", 3, 50);
  const candidates1 = [c1, c2];
  const candidates2 = [c2, c1];
  const params: LabelParams = { hubCount: 1, budget: 2 };
  const out1 = selectLabeledIds(candidates1, params);
  const out2 = selectLabeledIds(candidates2, params);
  // Same set of ids should be selected
  expect(new Set(out1)).toEqual(new Set(out2));
});

// ---------------------------------------------------------------------------
// Ordering: regions first, then hubs, then proximity
// ---------------------------------------------------------------------------

it("output order is: regions first, then hubs, then proximity", () => {
  const candidates = [
    makeReal("hub", 10, 999),
    makeRegion("wiki:x", 1, 100),
    makeReal("near", 1, 5),
  ];
  const ids = selectLabeledIds(candidates, { hubCount: 1, budget: 3 });
  const regionIdx = ids.indexOf("wiki:x");
  const hubIdx = ids.indexOf("hub");
  const nearIdx = ids.indexOf("near");
  expect(regionIdx).toBeLessThan(hubIdx);
  expect(hubIdx).toBeLessThan(nearIdx);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

it("hubCount=0 skips hubs entirely, budget used only for proximity", () => {
  const candidates = [
    makeReal("near", 1, 5),
    makeReal("far", 1, 500),
  ];
  const ids = selectLabeledIds(candidates, { hubCount: 0, budget: 1 });
  expect(ids).toContain("near");
  expect(ids).not.toContain("far");
});

it("hubCount larger than candidate count does not error", () => {
  const candidates = [makeReal("a", 5, 10)];
  const ids = selectLabeledIds(candidates, { hubCount: 100, budget: 100 });
  expect(ids).toContain("a");
});

describe("no duplicate ids in output", () => {
  it("hoveredId already in hubs does not produce duplicate", () => {
    const candidates = [makeReal("a", 10, 10)];
    const ids = selectLabeledIds(candidates, {
      hubCount: 1,
      budget: 5,
      hoveredId: "a",
    });
    const count = ids.filter((id) => id === "a").length;
    expect(count).toBe(1);
  });

  it("hoveredId already in proximity does not produce duplicate", () => {
    const candidates = [
      makeReal("hub", 10, 999),
      makeReal("hovered", 1, 5),
    ];
    const ids = selectLabeledIds(candidates, {
      hubCount: 1,
      budget: 5,
      hoveredId: "hovered",
    });
    const count = ids.filter((id) => id === "hovered").length;
    expect(count).toBe(1);
  });
});
