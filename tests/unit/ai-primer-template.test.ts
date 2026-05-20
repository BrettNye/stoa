import { describe, it, expect } from "vitest";
import { renderPrimer, writePrimerToUserScope, PRIMER_MARKER_START, PRIMER_MARKER_END, PrimerInputs } from "../../src/core/ai-primer-template.js";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseInputs: PrimerInputs = {
  role: "engineering",
  interaction_mode: "passive",
  team_mode: false,
  vault_path: "/home/user/vault",
  wiki_names: ["my-project"],
};

it("includes role-specific tag suggestions", () => {
  const out = renderPrimer({ role: "sales", interaction_mode: "passive", team_mode: false, vault_path: "/v", wiki_names: ["accounts"] });
  expect(out).toContain(PRIMER_MARKER_START);
  expect(out).toContain("account, objection, playbook");
});

describe("renderPrimer — marker boundaries", () => {
  it("starts with PRIMER_MARKER_START on its own line", () => {
    const out = renderPrimer(baseInputs);
    const lines = out.split("\n");
    expect(lines[0]).toBe(PRIMER_MARKER_START);
  });

  it("ends with PRIMER_MARKER_END on its own line", () => {
    const out = renderPrimer(baseInputs);
    const lines = out.split("\n");
    // last line might be empty due to trailing newline, so check last non-empty
    const lastMeaningful = lines.filter(l => l.trim() !== "").at(-1);
    expect(lastMeaningful).toBe(PRIMER_MARKER_END);
  });

  it("output is bracketed by both markers", () => {
    const out = renderPrimer(baseInputs);
    expect(out).toContain(PRIMER_MARKER_START);
    expect(out).toContain(PRIMER_MARKER_END);
    const startIdx = out.indexOf(PRIMER_MARKER_START);
    const endIdx = out.indexOf(PRIMER_MARKER_END);
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThan(startIdx);
  });
});

describe("renderPrimer — role blocks", () => {
  it("engineering: includes architecture/bug/refactor tags", () => {
    const out = renderPrimer({ ...baseInputs, role: "engineering" });
    expect(out).toContain("architecture, bug, refactor");
  });

  it("sales: includes account/objection/playbook tags", () => {
    const out = renderPrimer({ ...baseInputs, role: "sales" });
    expect(out).toContain("account, objection, playbook");
  });

  it("marketing: includes campaign/copy/audience tags", () => {
    const out = renderPrimer({ ...baseInputs, role: "marketing" });
    expect(out).toContain("campaign, copy, audience");
  });

  it("leadership: includes roadmap/hiring/culture tags", () => {
    const out = renderPrimer({ ...baseInputs, role: "leadership" });
    expect(out).toContain("roadmap, hiring, culture");
  });

  it("other: includes generic fallback text", () => {
    const out = renderPrimer({ ...baseInputs, role: "other" });
    expect(out).toContain("set per-wiki");
  });
});

describe("renderPrimer — interaction_mode", () => {
  it("passive: includes 'pick a type and file' wording", () => {
    const out = renderPrimer({ ...baseInputs, interaction_mode: "passive" });
    expect(out.toLowerCase()).toContain("pick");
    expect(out.toLowerCase()).toContain("file");
  });

  it("active: includes 'propose the type' wording", () => {
    const out = renderPrimer({ ...baseInputs, interaction_mode: "active" });
    expect(out.toLowerCase()).toContain("propose");
    expect(out.toLowerCase()).toContain("type");
  });
});

describe("renderPrimer — team_mode", () => {
  it("team_mode true: includes team-etiquette section", () => {
    const out = renderPrimer({ ...baseInputs, team_mode: true });
    expect(out.toLowerCase()).toContain("team etiquette");
  });

  it("team_mode false: omits team-etiquette section", () => {
    const out = renderPrimer({ ...baseInputs, team_mode: false });
    expect(out.toLowerCase()).not.toContain("team etiquette");
  });
});

describe("renderPrimer — vault and wiki info", () => {
  it("includes vault_path", () => {
    const out = renderPrimer({ ...baseInputs, vault_path: "/custom/path" });
    expect(out).toContain("/custom/path");
  });

  it("includes wiki names", () => {
    const out = renderPrimer({ ...baseInputs, wiki_names: ["alpha", "beta"] });
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
  });

  it("handles empty wiki_names gracefully", () => {
    const out = renderPrimer({ ...baseInputs, wiki_names: [] });
    expect(out).toContain("none yet");
  });
});

describe("writePrimerToUserScope", () => {
  function tmpFile(content?: string): string {
    const dir = mkdtempSync(join(tmpdir(), "primer-test-"));
    const p = join(dir, "CLAUDE.md");
    if (content !== undefined) writeFileSync(p, content, "utf8");
    return p;
  }

  const primerContent = renderPrimer(baseInputs);

  it("appends primer when file does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "primer-test-"));
    const p = join(dir, "CLAUDE.md");
    writePrimerToUserScope(p, primerContent);
    const result = readFileSync(p, "utf8");
    expect(result).toContain(PRIMER_MARKER_START);
    expect(result).toContain(PRIMER_MARKER_END);
  });

  it("appends primer to existing file without existing primer block", () => {
    const p = tmpFile("# My existing CLAUDE.md\n\nSome content.\n");
    writePrimerToUserScope(p, primerContent);
    const result = readFileSync(p, "utf8");
    expect(result).toContain("# My existing CLAUDE.md");
    expect(result).toContain("Some content.");
    expect(result).toContain(PRIMER_MARKER_START);
    expect(result).toContain(PRIMER_MARKER_END);
  });

  it("replaces existing primer block without touching surrounding content", () => {
    const before = "# Header\n\nBefore content.\n";
    const after = "\n\nAfter content.\n";
    const initial = before + primerContent + after;
    const p = tmpFile(initial);

    const updatedPrimer = renderPrimer({ ...baseInputs, vault_path: "/updated/path" });
    writePrimerToUserScope(p, updatedPrimer);
    const result = readFileSync(p, "utf8");

    expect(result).toContain("# Header");
    expect(result).toContain("Before content.");
    expect(result).toContain("After content.");
    expect(result).toContain("/updated/path");
    expect(result).not.toContain("/home/user/vault");
  });

  it("does not duplicate the primer block on re-write", () => {
    const p = tmpFile("# Header\n");
    writePrimerToUserScope(p, primerContent);
    writePrimerToUserScope(p, primerContent);
    const result = readFileSync(p, "utf8");
    // PRIMER_MARKER_START should appear exactly once
    const occurrences = result.split(PRIMER_MARKER_START).length - 1;
    expect(occurrences).toBe(1);
  });

  it("is idempotent — re-writing with same content produces same output", () => {
    const p = tmpFile("# Header\n\nPre-existing.\n");
    writePrimerToUserScope(p, primerContent);
    const firstResult = readFileSync(p, "utf8");
    writePrimerToUserScope(p, primerContent);
    const secondResult = readFileSync(p, "utf8");
    expect(secondResult).toBe(firstResult);
  });
});
