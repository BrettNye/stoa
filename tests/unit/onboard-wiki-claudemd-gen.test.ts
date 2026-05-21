import { describe, it, expect } from "vitest";
import { buildWikiClaudemdPrompt, fallbackWikiClaudemd } from "../../src/core/onboard-wiki-claudemd-gen.js";

it("includes the user's workflow text in the prompt", () => {
  const p = buildWikiClaudemdPrompt({ wiki_name: "meals", workflow_freetext: "weeknight dinners" });
  expect(p).toContain("weeknight dinners");
  expect(p).toContain("meals");
});

it("fallback includes the workflow text as scope", () => {
  const out = fallbackWikiClaudemd({ wiki_name: "meals", workflow_freetext: "weeknight dinners" });
  expect(out).toContain("**Scope:** weeknight dinners");
});

describe("buildWikiClaudemdPrompt", () => {
  it("includes the wiki name in the title heading requirement", () => {
    const p = buildWikiClaudemdPrompt({ wiki_name: "dev-notes", workflow_freetext: "track coding learnings" });
    expect(p).toContain("# dev-notes");
  });

  it("includes the required sections list", () => {
    const p = buildWikiClaudemdPrompt({ wiki_name: "dev-notes", workflow_freetext: "track coding learnings" });
    expect(p).toContain("Tag vocabulary");
    expect(p).toContain("How types map here");
    expect(p).toContain("Things to file");
    expect(p).toContain("Things NOT to file here");
  });

  it("includes an example for a different wiki", () => {
    const p = buildWikiClaudemdPrompt({ wiki_name: "dev-notes", workflow_freetext: "track coding learnings" });
    expect(p).toContain("meal-planning");
  });

  it("includes mode options in the prompt", () => {
    const p = buildWikiClaudemdPrompt({ wiki_name: "dev-notes", workflow_freetext: "track coding learnings" });
    expect(p).toMatch(/idea-map|project-doc|learning|mixed/);
  });

  it("instructs to output file content only, no code fence", () => {
    const p = buildWikiClaudemdPrompt({ wiki_name: "dev-notes", workflow_freetext: "track coding learnings" });
    expect(p).toContain("No code fence");
  });
});

describe("fallbackWikiClaudemd", () => {
  it("includes the wiki name as title heading", () => {
    const out = fallbackWikiClaudemd({ wiki_name: "dev-notes", workflow_freetext: "track coding learnings" });
    expect(out).toContain("# dev-notes");
  });

  it("includes a regenerate-wiki hint", () => {
    const out = fallbackWikiClaudemd({ wiki_name: "dev-notes", workflow_freetext: "track coding learnings" });
    expect(out).toContain("--regenerate-wiki");
    expect(out).toContain("dev-notes");
  });

  it("is pure and makes no side effects (runs repeatedly with same output)", () => {
    const args = { wiki_name: "meals", workflow_freetext: "weeknight dinners" };
    const out1 = fallbackWikiClaudemd(args);
    const out2 = fallbackWikiClaudemd(args);
    expect(out1).toBe(out2);
  });

  it("includes Tag vocabulary section", () => {
    const out = fallbackWikiClaudemd({ wiki_name: "meals", workflow_freetext: "weeknight dinners" });
    expect(out).toContain("## Tag vocabulary");
  });

  it("includes How types map here section", () => {
    const out = fallbackWikiClaudemd({ wiki_name: "meals", workflow_freetext: "weeknight dinners" });
    expect(out).toContain("## How types map here");
  });
});
