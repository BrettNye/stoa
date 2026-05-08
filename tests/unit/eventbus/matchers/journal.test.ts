import { it, expect } from "vitest";
import { journalMatcher } from "../../../../src/core/eventbus/matchers/journal.js";

it("derives wiki+id from a journal path", () => {
  const k = journalMatcher.deriveKey(
    "/v/wikis/_meta/journal/journal-2026-05-08-1200-foo.md", "/v");
  expect(k).toEqual({ wiki: "_meta", id: "journal-2026-05-08-1200-foo" });
});

it("decide returns emit:true with channel enrichment when frontmatter has channel", () => {
  const r = journalMatcher.decide(
    { frontmatter: { channel: "duel-x" }, body: "" }, undefined, "add",
  );
  expect(r.emit).toBe(true);
  expect(r.enrichment?.channel).toBe("duel-x");
});

it("decide returns emit:true with no enrichment when frontmatter lacks channel", () => {
  const r = journalMatcher.decide({ frontmatter: {}, body: "" }, undefined, "add");
  expect(r.emit).toBe(true);
  expect(r.enrichment?.channel).toBeUndefined();
});
