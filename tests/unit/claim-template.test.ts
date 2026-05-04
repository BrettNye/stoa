// vault-mcp/tests/unit/claim-template.test.ts
//
// Acceptance tests for `wikis/_templates/claim.md`. The template is what
// `vault.new claim <wiki> "<title>"` will instantiate, so it must:
//   - parse cleanly through `parseClaim` as a draft (loosest tier),
//   - carry the placeholder tokens `{{slug}}`, `{{title}}`, `{{date}}`,
//     `{{wiki}}`, `{{author}}` so the renderer can substitute them,
//   - declare every claim-specific frontmatter field (key, scope dimensions,
//     confidence, supersession + retraction nulls) so authors don't forget,
//   - include a body comment instructing the author about the ~280 char
//     summary cap (downstream `vault.sync-skills` rendering),
//   - keep documenting comments inline so authors learn the schema by reading.
//
// Path of the template under test (per task-claim-template's `files:` field):
//   wikis/_templates/claim.md
//
// We resolve relative to the vault root, which is two levels above
// `vault-mcp/` (the cwd that `npm run test` uses).

import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { parseClaim, ClaimDraft } from "../../src/types/claim.js";

const TEMPLATE_PATH = path.resolve(__dirname, "../../../wikis/_templates/claim.md");

describe("wikis/_templates/claim.md — claim page template", () => {
  let raw: string;
  let parsed: ReturnType<typeof matter>;

  beforeAll(async () => {
    raw = await fs.readFile(TEMPLATE_PATH, "utf8");
    parsed = matter(raw);
  });

  it("file exists at wikis/_templates/claim.md", async () => {
    await expect(fs.access(TEMPLATE_PATH)).resolves.toBeUndefined();
  });

  it("frontmatter parses as YAML via gray-matter", () => {
    expect(parsed.data).toBeTypeOf("object");
    expect(Object.keys(parsed.data).length).toBeGreaterThan(0);
  });

  describe("placeholder tokens", () => {
    it("includes {{slug}} so id can be substituted", () => {
      expect(raw).toContain("{{slug}}");
    });

    it("includes {{title}} so title can be substituted", () => {
      expect(raw).toContain("{{title}}");
    });

    it("includes {{date}} so created/last_validated can be substituted", () => {
      expect(raw).toContain("{{date}}");
    });
  });

  describe("required draft frontmatter fields", () => {
    it("declares id derived from claim-{{slug}} pattern", () => {
      expect(parsed.data.id).toBe("claim-{{slug}}");
    });

    it("declares type: claim", () => {
      expect(parsed.data.type).toBe("claim");
    });

    it("declares title with {{title}} placeholder", () => {
      expect(parsed.data.title).toContain("{{title}}");
    });

    it("declares created with {{date}} placeholder", () => {
      expect(String(parsed.data.created)).toContain("{{date}}");
    });

    it("declares status: draft", () => {
      expect(parsed.data.status).toBe("draft");
    });

    it("declares a structured key field (placeholder, kebab-case form)", () => {
      expect(parsed.data.key).toBeDefined();
      expect(typeof parsed.data.key).toBe("string");
      // Placeholder must be a kebab-case dotted form so authors see the shape.
      expect(parsed.data.key).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+){1,3}$/);
    });

    it("declares confidence as a number in [0, 1]", () => {
      expect(typeof parsed.data.confidence).toBe("number");
      expect(parsed.data.confidence).toBeGreaterThanOrEqual(0);
      expect(parsed.data.confidence).toBeLessThanOrEqual(1);
    });

    it("declares last_validated with {{date}} placeholder", () => {
      expect(String(parsed.data.last_validated)).toContain("{{date}}");
    });
  });

  describe("scope dimensions present as empty arrays (global by default)", () => {
    it("declares profile as []", () => {
      expect(parsed.data.profile).toEqual([]);
    });

    it("declares move as []", () => {
      expect(parsed.data.move).toEqual([]);
    });

    it("declares scope_wiki as []", () => {
      expect(parsed.data.scope_wiki).toEqual([]);
    });

    it("declares tags as []", () => {
      expect(parsed.data.tags).toEqual([]);
    });
  });

  describe("supersession + retraction defaults", () => {
    it("declares supersedes as []", () => {
      expect(parsed.data.supersedes).toEqual([]);
    });

    it("declares superseded_by as null", () => {
      expect(parsed.data.superseded_by).toBeNull();
    });

    it("declares retracted_at as null", () => {
      expect(parsed.data.retracted_at).toBeNull();
    });

    it("declares retracted_by as null", () => {
      expect(parsed.data.retracted_by).toBeNull();
    });

    it("declares retraction_reason as null", () => {
      expect(parsed.data.retraction_reason).toBeNull();
    });
  });

  describe("authorship + standard vault frontmatter", () => {
    it("declares authored_by with {{author}} placeholder", () => {
      expect(String(parsed.data.authored_by)).toContain("{{author}}");
    });

    it("declares evidence as []", () => {
      expect(parsed.data.evidence).toEqual([]);
    });

    it("declares wiki with {{wiki}} placeholder", () => {
      expect(String(parsed.data.wiki)).toContain("{{wiki}}");
    });
  });

  describe("body content", () => {
    it("body is non-empty", () => {
      expect(parsed.content.trim().length).toBeGreaterThan(0);
    });

    it("body mentions the ~280 character summary guidance", () => {
      // The instruction can be phrased in a few ways; we just want the number.
      expect(parsed.content).toMatch(/280/);
    });
  });

  describe("parseClaim acceptance — template renders into a parseable draft", () => {
    // We feed the raw frontmatter (with placeholders still in place) through
    // parseClaim. The placeholders must satisfy the schema regexes so that
    // status: draft validates without substitution.
    it("template frontmatter passes ClaimDraft.parse() with placeholders substituted to plausible values", () => {
      const fm = { ...parsed.data } as Record<string, unknown>;
      // Substitute placeholders with plausible values matching the schema.
      fm.id = String(fm.id).replace("{{slug}}", "test");
      fm.title = String(fm.title).replace("{{title}}", "Test claim");
      fm.created = String(fm.created).replace("{{date}}", "2026-05-02");
      fm.last_validated = String(fm.last_validated).replace("{{date}}", "2026-05-02");
      fm.wiki = String(fm.wiki).replace("{{wiki}}", "_agents");
      fm.authored_by = String(fm.authored_by).replace("{{author}}", "agent:test");
      // updated may also carry {{date}} if present.
      if (fm.updated !== undefined) {
        fm.updated = String(fm.updated).replace("{{date}}", "2026-05-02");
      }
      expect(() => ClaimDraft.parse(fm)).not.toThrow();
      const claim = parseClaim(fm);
      expect(claim.status).toBe("draft");
      expect(claim.id).toBe("claim-test");
      expect(claim.type).toBe("claim");
    });

    it("after substitution, id equals filename stem pattern (claim-<slug>)", () => {
      const id = String(parsed.data.id).replace("{{slug}}", "example");
      expect(id).toBe("claim-example");
      expect(id).toMatch(/^claim-/);
    });
  });
});
