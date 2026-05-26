import { describe, it, expect } from "vitest";
import { PagesIndex, LinksIndex } from "./graph.js";

it("applies array/string defaults to a minimal page", () => {
  const r = PagesIndex.parse({ pages: [{ id: "a", type: "concept", wiki: "w", path: "wikis/w/concept/a.md" }] });
  expect(r.pages[0].tags).toEqual([]);
  expect(r.pages[0].summary).toBe("");
});

describe("PagesIndex", () => {
  it("fills status default to 'draft' when missing", () => {
    const r = PagesIndex.parse({ pages: [{ id: "a", type: "concept", wiki: "w", path: "wikis/w/concept/a.md" }] });
    expect(r.pages[0].status).toBe("draft");
  });

  it("fills title default to empty string when missing", () => {
    const r = PagesIndex.parse({ pages: [{ id: "a", type: "concept", wiki: "w", path: "wikis/w/concept/a.md" }] });
    expect(r.pages[0].title).toBe("");
  });

  it("fills updated default to empty string when missing", () => {
    const r = PagesIndex.parse({ pages: [{ id: "a", type: "concept", wiki: "w", path: "wikis/w/concept/a.md" }] });
    expect(r.pages[0].updated).toBe("");
  });

  it("rejects a page missing required 'id' field", () => {
    expect(() =>
      PagesIndex.parse({ pages: [{ type: "concept", wiki: "w", path: "wikis/w/concept/a.md" }] })
    ).toThrow();
  });

  it("rejects a page missing required 'path' field", () => {
    expect(() =>
      PagesIndex.parse({ pages: [{ id: "a", type: "concept", wiki: "w" }] })
    ).toThrow();
  });

  it("accepts a page with all fields provided", () => {
    const r = PagesIndex.parse({
      pages: [{
        id: "concept-foo",
        type: "concept",
        wiki: "stoa",
        title: "Foo",
        summary: "A foo.",
        tags: ["bar", "baz"],
        status: "active",
        updated: "2026-01-01",
        path: "wikis/stoa/concept/concept-foo.md",
      }],
    });
    expect(r.pages[0].id).toBe("concept-foo");
    expect(r.pages[0].tags).toEqual(["bar", "baz"]);
    expect(r.pages[0].summary).toBe("A foo.");
  });
});

describe("LinksIndex", () => {
  it("accepts the { id: { outbound, inbound } } shape", () => {
    const r = LinksIndex.parse({
      "concept-foo": { outbound: ["concept-bar"], inbound: [] },
    });
    expect(r["concept-foo"].outbound).toEqual(["concept-bar"]);
    expect(r["concept-foo"].inbound).toEqual([]);
  });

  it("defaults missing outbound to []", () => {
    const r = LinksIndex.parse({ "concept-foo": { inbound: ["concept-bar"] } });
    expect(r["concept-foo"].outbound).toEqual([]);
  });

  it("defaults missing inbound to []", () => {
    const r = LinksIndex.parse({ "concept-foo": { outbound: ["concept-bar"] } });
    expect(r["concept-foo"].inbound).toEqual([]);
  });

  it("defaults both arrays when entry is empty object", () => {
    const r = LinksIndex.parse({ "concept-foo": {} });
    expect(r["concept-foo"].outbound).toEqual([]);
    expect(r["concept-foo"].inbound).toEqual([]);
  });
});
