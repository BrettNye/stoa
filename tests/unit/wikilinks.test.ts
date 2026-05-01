import { describe, it, expect } from "vitest";
import { extractWikilinks } from "../../src/core/wikilinks.js";

describe("extractWikilinks", () => {
  it("parses a standard vault-root absolute wikilink in body", () => {
    const body = "See [[wikis/foo/concept/concept-bar]] for details.";
    const refs = extractWikilinks(body);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      raw: "[[wikis/foo/concept/concept-bar]]",
      wiki: "foo",
      type: "concept",
      id: "concept-bar",
      source: "body"
    });
  });

  it("parses an aliased wikilink and captures the alias", () => {
    const body = "See [[wikis/foo/concept/concept-bar|My Bar]] today.";
    const refs = extractWikilinks(body);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      raw: "[[wikis/foo/concept/concept-bar|My Bar]]",
      wiki: "foo",
      type: "concept",
      id: "concept-bar",
      alias: "My Bar",
      source: "body"
    });
  });

  it("parses wikilinks from frontmatter related: array with source=frontmatter", () => {
    const body = "no body links here";
    const related = ["[[wikis/foo/concept/concept-bar]]", "[[wikis/baz/spec/spec-quux|alias-q]]"];
    const refs = extractWikilinks(body, related);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({
      raw: "[[wikis/foo/concept/concept-bar]]",
      wiki: "foo",
      type: "concept",
      id: "concept-bar",
      source: "frontmatter"
    });
    expect(refs[1]).toEqual({
      raw: "[[wikis/baz/spec/spec-quux|alias-q]]",
      wiki: "baz",
      type: "spec",
      id: "spec-quux",
      alias: "alias-q",
      source: "frontmatter"
    });
  });

  it("skips wikilinks inside fenced code blocks", () => {
    const body = [
      "Outside link: [[wikis/foo/concept/concept-bar]].",
      "",
      "```typescript",
      "const x = \"[[wikis/foo/concept/concept-inside]]\";",
      "```",
      "",
      "Tail: [[wikis/foo/guide/guide-tail]]."
    ].join("\n");
    const refs = extractWikilinks(body);
    expect(refs).toHaveLength(2);
    expect(refs.map(r => r.id)).toEqual(["concept-bar", "guide-tail"]);
  });

  it("skips wikilinks inside fenced blocks with no info-string", () => {
    const body = [
      "Pre: [[wikis/foo/concept/concept-pre]].",
      "```",
      "look [[wikis/foo/concept/concept-fenced]]",
      "```"
    ].join("\n");
    const refs = extractWikilinks(body);
    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe("concept-pre");
  });

  it("skips malformed wikilinks (only 3 segments — missing id)", () => {
    const body = "Bad: [[wikis/foo/concept]] — only three segments.";
    const refs = extractWikilinks(body);
    expect(refs).toHaveLength(0);
  });

  it("skips wikilinks missing the wikis/ prefix (relative form)", () => {
    const body = "Relative: [[concept/concept-bar]] should be skipped.";
    const refs = extractWikilinks(body);
    expect(refs).toHaveLength(0);
  });

  it("returns multiple wikilinks on the same line", () => {
    const body = "Two: [[wikis/foo/concept/concept-a]] and [[wikis/bar/spec/spec-b|B]].";
    const refs = extractWikilinks(body);
    expect(refs).toHaveLength(2);
    expect(refs[0].id).toBe("concept-a");
    expect(refs[1].id).toBe("spec-b");
    expect(refs[1].alias).toBe("B");
  });

  it("returns empty array for empty input", () => {
    expect(extractWikilinks("")).toEqual([]);
    expect(extractWikilinks("", [])).toEqual([]);
  });

  it("skips malformed entries in frontmatter related: array", () => {
    const related = [
      "[[wikis/foo/concept/concept-bar]]",
      "not-a-wikilink",
      "[[concept/concept-bar]]",  // missing wikis/ prefix
      "[[wikis/foo/concept]]"     // only 3 segments
    ];
    const refs = extractWikilinks("", related);
    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe("concept-bar");
    expect(refs[0].source).toBe("frontmatter");
  });
});
