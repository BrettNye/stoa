import { describe, it, expect } from "vitest";
import {
  normalizeScopes,
  rewritePageLinks
} from "../../src/core/rewrite-links.js";

describe("normalizeScopes", () => {
  it("['all'] expands to both true", () => {
    expect(normalizeScopes(["all"])).toEqual({ body: true, frontmatter: true });
  });

  it("['body','frontmatter'] is equivalent to ['all']", () => {
    expect(normalizeScopes(["body", "frontmatter"])).toEqual({
      body: true,
      frontmatter: true
    });
  });

  it("['body'] enables only body", () => {
    expect(normalizeScopes(["body"])).toEqual({ body: true, frontmatter: false });
  });

  it("['frontmatter'] enables only frontmatter", () => {
    expect(normalizeScopes(["frontmatter"])).toEqual({
      body: false,
      frontmatter: true
    });
  });

  it("empty array yields both false (caller may treat as no-op)", () => {
    expect(normalizeScopes([])).toEqual({ body: false, frontmatter: false });
  });

  it("['body','all'] still resolves to both true (all is dominant)", () => {
    expect(normalizeScopes(["body", "all"])).toEqual({
      body: true,
      frontmatter: true
    });
  });

  it("duplicate scope tokens collapse harmlessly", () => {
    expect(normalizeScopes(["body", "body"])).toEqual({
      body: true,
      frontmatter: false
    });
  });
});

describe("rewritePageLinks", () => {
  const SCOPE_BOTH = { body: true, frontmatter: true };
  const SCOPE_BODY = { body: true, frontmatter: false };
  const SCOPE_FM = { body: false, frontmatter: true };

  it("body-only scope rewrites a body wikilink and leaves new_related undefined", () => {
    const body = "See [[wikis/rastate/concept/foo]] for details.";
    const out = rewritePageLinks(
      "page-one",
      body,
      undefined,
      "wikis/rastate/",
      "wikis/rastate-core/",
      SCOPE_BODY
    );
    expect(out).not.toBeNull();
    expect(out!.page_id).toBe("page-one");
    expect(out!.links_rewritten).toBe(1);
    expect(out!.new_body).toContain("[[wikis/rastate-core/concept/foo]]");
    expect(out!.new_body).not.toContain("[[wikis/rastate/concept/foo]]");
    expect(out!.new_related).toBeUndefined();
  });

  it("frontmatter-only scope rewrites the related: array; body left untouched", () => {
    const body = "See [[wikis/rastate/concept/foo]] for details.";
    const related = [
      "[[wikis/rastate/spec/bar]]",
      "[[wikis/other/concept/baz]]"
    ];
    const out = rewritePageLinks(
      "page-two",
      body,
      related,
      "wikis/rastate/",
      "wikis/rastate-core/",
      SCOPE_FM
    );
    expect(out).not.toBeNull();
    expect(out!.links_rewritten).toBe(1);
    // body unchanged because body scope is off
    expect(out!.new_body).toBe(body);
    expect(out!.new_related).toEqual([
      "[[wikis/rastate-core/spec/bar]]",
      "[[wikis/other/concept/baz]]"
    ]);
  });

  it("both scopes: rewrites in body and frontmatter; count covers both", () => {
    const body = [
      "First: [[wikis/rastate/concept/foo]].",
      "Second: [[wikis/rastate/guide/bar]]."
    ].join("\n");
    const related = ["[[wikis/rastate/spec/baz]]"];
    const out = rewritePageLinks(
      "page-three",
      body,
      related,
      "wikis/rastate/",
      "wikis/rastate-core/",
      SCOPE_BOTH
    );
    expect(out).not.toBeNull();
    expect(out!.links_rewritten).toBe(3);
    expect(out!.new_body).toContain("[[wikis/rastate-core/concept/foo]]");
    expect(out!.new_body).toContain("[[wikis/rastate-core/guide/bar]]");
    expect(out!.new_related).toEqual(["[[wikis/rastate-core/spec/baz]]"]);
  });

  it("returns null when no wikilinks match the prefix", () => {
    const body = "Some [[wikis/other/concept/foo]] link, no rastate here.";
    const related = ["[[wikis/elsewhere/spec/bar]]"];
    const out = rewritePageLinks(
      "page-four",
      body,
      related,
      "wikis/rastate/",
      "wikis/rastate-core/",
      SCOPE_BOTH
    );
    expect(out).toBeNull();
  });

  it("is idempotent: running on already-rewritten content returns null", () => {
    const body = "See [[wikis/rastate-core/concept/foo]] now.";
    const related = ["[[wikis/rastate-core/spec/bar]]"];
    const out = rewritePageLinks(
      "page-five",
      body,
      related,
      "wikis/rastate/",
      "wikis/rastate-core/",
      SCOPE_BOTH
    );
    expect(out).toBeNull();
  });

  it("does NOT rewrite wikilinks inside fenced code blocks", () => {
    const body = [
      "Outside: [[wikis/rastate/concept/outside]].",
      "",
      "```typescript",
      "const x = \"[[wikis/rastate/concept/inside]]\";",
      "```",
      "",
      "Tail: [[wikis/rastate/guide/tail]]."
    ].join("\n");
    const out = rewritePageLinks(
      "page-six",
      body,
      undefined,
      "wikis/rastate/",
      "wikis/rastate-core/",
      SCOPE_BODY
    );
    expect(out).not.toBeNull();
    expect(out!.links_rewritten).toBe(2);
    // fence content preserved verbatim
    expect(out!.new_body).toContain("[[wikis/rastate/concept/inside]]");
    // outside links rewritten
    expect(out!.new_body).toContain("[[wikis/rastate-core/concept/outside]]");
    expect(out!.new_body).toContain("[[wikis/rastate-core/guide/tail]]");
  });

  it("preserves alias when rewriting an aliased wikilink", () => {
    const body = "Read [[wikis/rastate/concept/foo|My Foo]] sometime.";
    const out = rewritePageLinks(
      "page-seven",
      body,
      undefined,
      "wikis/rastate/",
      "wikis/rastate-core/",
      SCOPE_BODY
    );
    expect(out).not.toBeNull();
    expect(out!.links_rewritten).toBe(1);
    expect(out!.new_body).toContain("[[wikis/rastate-core/concept/foo|My Foo]]");
  });

  it("preserves trailing path segments verbatim (deep paths)", () => {
    // Match rule per spec: replace JUST the prefix; trailing segments preserved.
    // Note: extractWikilinks expects exactly 3 segments (wiki/type/id), but the
    // rewrite rule operates as raw prefix replacement on the raw wikilink path.
    const body = "Link: [[wikis/rastate/concept/foo|Alias With Spaces]] tail.";
    const out = rewritePageLinks(
      "page-eight",
      body,
      undefined,
      "wikis/rastate/concept/",
      "wikis/rastate-core/concept/",
      SCOPE_BODY
    );
    expect(out).not.toBeNull();
    expect(out!.new_body).toContain("[[wikis/rastate-core/concept/foo|Alias With Spaces]]");
  });

  it("only rewrites links matching from_prefix; non-matching prefix left alone", () => {
    const body = [
      "Match: [[wikis/rastate/concept/keep]].",
      "Skip: [[wikis/rastate-dev/concept/skip]].",
      "Skip: [[wikis/other/concept/other]]."
    ].join("\n");
    const out = rewritePageLinks(
      "page-nine",
      body,
      undefined,
      "wikis/rastate/",
      "wikis/rastate-core/",
      SCOPE_BODY
    );
    expect(out).not.toBeNull();
    expect(out!.links_rewritten).toBe(1);
    expect(out!.new_body).toContain("[[wikis/rastate-core/concept/keep]]");
    expect(out!.new_body).toContain("[[wikis/rastate-dev/concept/skip]]");
    expect(out!.new_body).toContain("[[wikis/other/concept/other]]");
  });

  it("when both scopes match but only frontmatter has hits, returns rewrite with new_body unchanged", () => {
    const body = "No matching wikilinks here.";
    const related = ["[[wikis/rastate/spec/x]]"];
    const out = rewritePageLinks(
      "page-ten",
      body,
      related,
      "wikis/rastate/",
      "wikis/rastate-core/",
      SCOPE_BOTH
    );
    expect(out).not.toBeNull();
    expect(out!.links_rewritten).toBe(1);
    expect(out!.new_body).toBe(body);
    expect(out!.new_related).toEqual(["[[wikis/rastate-core/spec/x]]"]);
  });

  it("when both scopes match but related is undefined, returns new_related undefined", () => {
    const body = "Match: [[wikis/rastate/concept/foo]].";
    const out = rewritePageLinks(
      "page-eleven",
      body,
      undefined,
      "wikis/rastate/",
      "wikis/rastate-core/",
      SCOPE_BOTH
    );
    expect(out).not.toBeNull();
    expect(out!.links_rewritten).toBe(1);
    expect(out!.new_related).toBeUndefined();
  });

  it("ignores body scope: body link present but scope.body=false → no body rewrite", () => {
    const body = "Match: [[wikis/rastate/concept/foo]].";
    const related = ["[[wikis/rastate/spec/bar]]"];
    const out = rewritePageLinks(
      "page-twelve",
      body,
      related,
      "wikis/rastate/",
      "wikis/rastate-core/",
      SCOPE_FM
    );
    expect(out).not.toBeNull();
    expect(out!.new_body).toBe(body);
    expect(out!.links_rewritten).toBe(1);
    expect(out!.new_related).toEqual(["[[wikis/rastate-core/spec/bar]]"]);
  });

  it("non-string entries in related are passed through unchanged and not counted", () => {
    const body = "no body matches";
    const related = ["[[wikis/rastate/spec/keep]]", "" /* edge */];
    const out = rewritePageLinks(
      "page-thirteen",
      body,
      related,
      "wikis/rastate/",
      "wikis/rastate-core/",
      SCOPE_FM
    );
    expect(out).not.toBeNull();
    expect(out!.links_rewritten).toBe(1);
    expect(out!.new_related).toEqual(["[[wikis/rastate-core/spec/keep]]", ""]);
  });

  it("multiple body links matching the prefix all get rewritten and counted", () => {
    const body = [
      "[[wikis/rastate/concept/a]]",
      "[[wikis/rastate/concept/b]]",
      "[[wikis/rastate/concept/c]]"
    ].join(" ");
    const out = rewritePageLinks(
      "page-fourteen",
      body,
      undefined,
      "wikis/rastate/",
      "wikis/rastate-core/",
      SCOPE_BODY
    );
    expect(out).not.toBeNull();
    expect(out!.links_rewritten).toBe(3);
    expect(out!.new_body).toContain("[[wikis/rastate-core/concept/a]]");
    expect(out!.new_body).toContain("[[wikis/rastate-core/concept/b]]");
    expect(out!.new_body).toContain("[[wikis/rastate-core/concept/c]]");
  });
});
