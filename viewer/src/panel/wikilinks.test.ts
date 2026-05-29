import { it, expect } from "vitest";
import { resolveBodyWikilinks } from "./wikilinks.js";

it("resolves a known id and flags an unknown one", () => {
  const body = "see [[wikis/w/concept/known|Known]] and [[wikis/w/concept/ghost]]";
  const out = resolveBodyWikilinks(body, undefined, new Set(["known"]));
  expect(out.find((l) => l.alias === "Known")!.targetId).toBe("known");
  expect(out.find((l) => l.raw.includes("ghost"))!.targetId).toBeNull();
});

it("preserves the raw string for each link", () => {
  const body = "[[wikis/w/concept/foo|Foo]]";
  const out = resolveBodyWikilinks(body, undefined, new Set(["foo"]));
  expect(out[0].raw).toBe("[[wikis/w/concept/foo|Foo]]");
});

it("resolves frontmatter related entries alongside body links", () => {
  const body = "body link [[wikis/w/concept/body-node]]";
  const related = ["[[wikis/w/concept/front-node]]"];
  const knownIds = new Set(["body-node", "front-node"]);
  const out = resolveBodyWikilinks(body, related, knownIds);
  expect(out.find((l) => l.raw.includes("body-node"))!.targetId).toBe("body-node");
  expect(out.find((l) => l.raw.includes("front-node"))!.targetId).toBe("front-node");
});

it("returns null targetId for a frontmatter related entry not in knownIds", () => {
  const related = ["[[wikis/w/concept/unknown-front]]"];
  const out = resolveBodyWikilinks("", related, new Set(["some-other"]));
  expect(out[0].targetId).toBeNull();
});
