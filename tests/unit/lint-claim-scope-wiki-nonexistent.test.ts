import { describe, it, expect } from "vitest";
import { makeClaimScopeWikiRule } from "../../src/core/lint-checks/claim-scope-wiki-nonexistent.js";

const fm = (overrides: object) => ({ type: "claim", ...overrides });

it("fires when scope_wiki references a non-existent wiki", () => {
  const rule = makeClaimScopeWikiRule(new Set(["alpha"]));
  const page = { frontmatter: fm({ scope_wiki: ["alpha", "ghost-wiki"] }), content: "" };
  const findings = rule.check(page);
  expect(findings).toHaveLength(1);
  expect(findings[0].message).toMatch(/ghost-wiki/);
});

it("returns no findings when all scope_wiki entries exist", () => {
  const rule = makeClaimScopeWikiRule(new Set(["alpha", "beta"]));
  const page = { frontmatter: fm({ scope_wiki: ["alpha", "beta"] }), content: "" };
  expect(rule.check(page)).toEqual([]);
});

it("returns no findings when scope_wiki is empty (universal claim)", () => {
  const rule = makeClaimScopeWikiRule(new Set(["alpha"]));
  const page = { frontmatter: fm({ scope_wiki: [] }), content: "" };
  expect(rule.check(page)).toEqual([]);
});

it("applies only to claim type pages", () => {
  const rule = makeClaimScopeWikiRule(new Set(["alpha"]));
  const page = { frontmatter: { type: "task", scope_wiki: ["nope"] }, content: "" };
  expect(rule.appliesTo(page)).toBe(false);
});
