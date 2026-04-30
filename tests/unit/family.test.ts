import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveFamily,
  aggregateFamilies,
  membersOf,
  FamilyMismatchError,
} from "../../src/core/family.js";

describe("family.resolveFamily", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-family-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("explicit familyArg wins over everything else", () => {
    writeFileSync(join(vaultPath, ".active-family"), "active-fam\n");
    const result = resolveFamily(
      { vaultPath, defaultFamily: "default-fam" },
      "explicit-fam"
    );
    expect(result).toBe("explicit-fam");
  });

  it("falls back to ctx.defaultFamily when no explicit arg", () => {
    writeFileSync(join(vaultPath, ".active-family"), "active-fam\n");
    const result = resolveFamily({ vaultPath, defaultFamily: "default-fam" });
    expect(result).toBe("default-fam");
  });

  it("falls back to .active-family file when neither explicit nor default present", () => {
    writeFileSync(join(vaultPath, ".active-family"), "active-fam\n");
    const result = resolveFamily({ vaultPath });
    expect(result).toBe("active-fam");
  });

  it("trims whitespace from .active-family contents", () => {
    writeFileSync(join(vaultPath, ".active-family"), "  active-fam  \n\n");
    const result = resolveFamily({ vaultPath });
    expect(result).toBe("active-fam");
  });

  it("returns null when .active-family is empty after trim", () => {
    writeFileSync(join(vaultPath, ".active-family"), "   \n");
    const result = resolveFamily({ vaultPath });
    expect(result).toBeNull();
  });

  it("returns null when nothing is set", () => {
    const result = resolveFamily({ vaultPath });
    expect(result).toBeNull();
  });

  it("explicit family + matching wiki returns the family", () => {
    const knownWikis = {
      "rastate-core": { family: "rastate" },
      "rastate-dev": { family: "rastate" },
    };
    const result = resolveFamily(
      { vaultPath },
      "rastate",
      "rastate-core",
      knownWikis
    );
    expect(result).toBe("rastate");
  });

  it("explicit family + mismatched wiki throws FamilyMismatchError", () => {
    const knownWikis = {
      "rastate-core": { family: "rastate" },
      "_meta": { family: null },
    };
    expect(() =>
      resolveFamily({ vaultPath }, "rastate", "_meta", knownWikis)
    ).toThrow(FamilyMismatchError);
  });

  it("explicit wiki only (no family arg) returns null and does NOT auto-broaden", () => {
    const knownWikis = {
      "rastate-core": { family: "rastate" },
    };
    const result = resolveFamily(
      { vaultPath },
      undefined,
      "rastate-core",
      knownWikis
    );
    expect(result).toBeNull();
  });

  it("explicit family + wiki without knownWikis skips sanity check", () => {
    const result = resolveFamily(
      { vaultPath },
      "rastate",
      "rastate-core"
      // knownWikis omitted
    );
    expect(result).toBe("rastate");
  });

  it("explicit family + wiki not in knownWikis throws FamilyMismatchError", () => {
    const knownWikis = {
      "rastate-core": { family: "rastate" },
    };
    expect(() =>
      resolveFamily({ vaultPath }, "rastate", "unknown-wiki", knownWikis)
    ).toThrow(FamilyMismatchError);
  });
});

describe("family.aggregateFamilies", () => {
  it("returns empty object for empty input", () => {
    expect(aggregateFamilies({})).toEqual({});
  });

  it("excludes wikis with no family field", () => {
    const wikis = {
      "_meta": { name: "_meta", mode: "project-doc", page_count: 10 },
    };
    expect(aggregateFamilies(wikis)).toEqual({});
  });

  it("excludes wikis with family=null", () => {
    const wikis = {
      "_meta": { name: "_meta", mode: "project-doc", family: null, page_count: 10 },
    };
    expect(aggregateFamilies(wikis)).toEqual({});
  });

  it("aggregates two wikis sharing a family — sorted members, summed pages, deduped+sorted modes", () => {
    const wikis = {
      "rastate-dev": {
        name: "rastate-dev",
        mode: "coordination",
        family: "rastate",
        page_count: 31,
      },
      "rastate-core": {
        name: "rastate-core",
        mode: "project-doc",
        family: "rastate",
        page_count: 42,
      },
    };
    expect(aggregateFamilies(wikis)).toEqual({
      rastate: {
        members: ["rastate-core", "rastate-dev"],
        total_pages: 73,
        modes_used: ["coordination", "project-doc"],
      },
    });
  });

  it("dedupes modes_used when two members share a mode", () => {
    const wikis = {
      "fam-a-1": { name: "fam-a-1", mode: "idea-map", family: "fam-a", page_count: 5 },
      "fam-a-2": { name: "fam-a-2", mode: "idea-map", family: "fam-a", page_count: 7 },
    };
    const out = aggregateFamilies(wikis);
    expect(out["fam-a"].modes_used).toEqual(["idea-map"]);
    expect(out["fam-a"].total_pages).toBe(12);
  });

  it("treats missing page_count as zero", () => {
    const wikis = {
      "fam-a-1": { name: "fam-a-1", mode: "project-doc", family: "fam-a" },
      "fam-a-2": {
        name: "fam-a-2",
        mode: "coordination",
        family: "fam-a",
        page_count: 5,
      },
    };
    const out = aggregateFamilies(wikis);
    expect(out["fam-a"].total_pages).toBe(5);
  });

  it("groups multiple distinct families separately and excludes unfamilied wikis", () => {
    const wikis = {
      "rastate-core": {
        name: "rastate-core",
        mode: "project-doc",
        family: "rastate",
        page_count: 42,
      },
      "rastate-dev": {
        name: "rastate-dev",
        mode: "coordination",
        family: "rastate",
        page_count: 31,
      },
      "agents-core": {
        name: "agents-core",
        mode: "project-doc",
        family: "_agents",
        page_count: 8,
      },
      "_meta": { name: "_meta", mode: "project-doc", page_count: 18 },
    };
    const out = aggregateFamilies(wikis);
    expect(Object.keys(out).sort()).toEqual(["_agents", "rastate"]);
    expect(out["rastate"].members).toEqual(["rastate-core", "rastate-dev"]);
    expect(out["_agents"].members).toEqual(["agents-core"]);
  });
});

describe("family.membersOf", () => {
  it("returns sorted members for the given family", () => {
    const wikis = {
      "rastate-dev": { family: "rastate" },
      "rastate-core": { family: "rastate" },
      "rastate-ideas": { family: "rastate" },
      "_meta": { family: null },
    };
    expect(membersOf("rastate", wikis)).toEqual([
      "rastate-core",
      "rastate-dev",
      "rastate-ideas",
    ]);
  });

  it("is case-sensitive", () => {
    const wikis = {
      "fam-a": { family: "Rastate" },
      "fam-b": { family: "rastate" },
    };
    expect(membersOf("rastate", wikis)).toEqual(["fam-b"]);
    expect(membersOf("Rastate", wikis)).toEqual(["fam-a"]);
  });

  it("returns [] when no members match", () => {
    const wikis = {
      "_meta": { family: null },
      "fam-a": { family: "other" },
    };
    expect(membersOf("rastate", wikis)).toEqual([]);
  });

  it("returns [] for empty wiki map", () => {
    expect(membersOf("rastate", {})).toEqual([]);
  });
});
