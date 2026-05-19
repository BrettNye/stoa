import { describe, it, expect } from "vitest";
import { typeFolder, slugify, generateId, parseId, isMoveDirectoryLayout, filenameForType } from "../../src/core/ids.js";

describe("typeFolder", () => {
  it("maps types to folder names", () => {
    expect(typeFolder("concept")).toBe("concepts");
    expect(typeFolder("guide")).toBe("guides");
    expect(typeFolder("decision")).toBe("decisions");
    expect(typeFolder("synthesis")).toBe("synthesis");
    expect(typeFolder("idea")).toBe("ideas");
    expect(typeFolder("question")).toBe("questions");
    expect(typeFolder("spec")).toBe("specs");
    expect(typeFolder("source")).toBe("sources");
    expect(typeFolder("journal")).toBe("journal");
    expect(typeFolder("task")).toBe("tasks");
    expect(typeFolder("map")).toBe(""); // map.md sits at wiki root
  });
});

describe("slugify", () => {
  it("kebab-cases and limits length", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
    expect(slugify("Foo, bar, baz, qux, quux, corge")).toBe("foo-bar-baz-qux-quux-corge");
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(40);
  });

  it("strips diacritics and special chars", () => {
    expect(slugify("café résumé")).toBe("cafe-resume");
  });

  // Regression: bug #4 (2026-05-15) — slug truncation cut mid-word, producing
  // trailing fragments like "-on-w" and "-ensure-". When the maxLen falls
  // inside a word, walk back to the previous dash so the slug ends at a
  // word boundary. Trim trailing dashes after.
  describe("regression: word-boundary truncation (bug-2026-05-15-slug-mid-word)", () => {
    it("walks back to previous dash when slice cuts mid-word", () => {
      // Note: slugify strips `.` and `_` so the input normalizes to:
      //   "fix-vaultprocess-inbox-default-suggestedid-regression-on-windows"
      // slice(0, 16) → "fix-vaultprocess" (cuts mid-word inside "vaultprocess").
      // Walk back to last dash within budget (index 3) → "fix".
      const input = "Fix vault.process-inbox default suggested_id regression on Windows";
      const s = slugify(input, 16);
      expect(s).toBe("fix");
      // Critical invariants regardless of exact return value:
      expect(s).not.toMatch(/-$/);
      expect(s.length).toBeLessThanOrEqual(16);
    });

    it("walks back when budget lands exactly at a dash", () => {
      // "foo-bar-baz" len 11. maxLen 8 → slice "foo-bar-" → walk back past
      // the trailing dash → "foo-bar".
      expect(slugify("foo bar baz", 8)).toBe("foo-bar");
    });

    it("walks back further when input has just one dash before the cut", () => {
      // "alpha-bravo" len 11. maxLen 9 → slice "alpha-bra" → walk back to
      // dash at index 5 → "alpha".
      expect(slugify("alpha bravo", 9)).toBe("alpha");
    });

    it("does not produce trailing fragments mid-word at 60-char limit (task-create equivalence)", () => {
      const title = "Fix vault.process-inbox default suggested_id regression on Windows";
      const s = slugify(title, 60);
      // Should not end with "-on-w" or any partial word.
      expect(s).not.toMatch(/-w$/);
      expect(s).not.toMatch(/-on-w$/);
      // Should end at a word boundary (last char is alphanumeric, but previous
      // dash separator marks a full word).
      const lastDashIdx = s.lastIndexOf("-");
      const tail = lastDashIdx === -1 ? s : s.slice(lastDashIdx + 1);
      // Tail must be a "real" word, not a single-letter cut.
      expect(tail.length).toBeGreaterThan(1);
    });

    it("walks back from 60-char cut on the audit-wikis title", () => {
      const title = "Audit existing wikis for missing type subdirectories; ensure new-wiki scaffolds all 8";
      const s = slugify(title, 60);
      // Should not end with "ensure-" (trailing dash trim should fix the
      // dash, but the issue was that "subdirectories;-ensure-" got cut at
      // exactly index 60 producing "...subdirectories-ensure-" → trailing
      // dash trimmed → "...subdirectories-ensure"). Verify no trailing dash
      // AND no mid-word cut. The cut at 60 lands inside "new" (sequence
      // ...directories-ensure-new-wiki); walk back to "ensure".
      expect(s).not.toMatch(/-$/);
      // Length must be ≤ 60.
      expect(s.length).toBeLessThanOrEqual(60);
      // Must end at a word boundary (the last segment must not be a
      // single-letter fragment).
      const segments = s.split("-");
      const tail = segments[segments.length - 1];
      expect(tail.length).toBeGreaterThan(1);
    });

    it("preserves slugs that already fit under maxLen", () => {
      expect(slugify("Hello World", 40)).toBe("hello-world");
    });

    it("returns empty string when input is all special chars (defensive)", () => {
      expect(slugify("!!!", 40)).toBe("");
    });

    it("handles a 200-char title and ends at a dash boundary", () => {
      const title = ("alphabet bravo charlie delta echo foxtrot golf hotel " +
        "india juliet kilo lima mike november oscar papa quebec romeo sierra " +
        "tango uniform victor whiskey xray yankee zulu");
      const s = slugify(title, 80);
      expect(s.length).toBeLessThanOrEqual(80);
      expect(s).not.toMatch(/-$/);
      // Last segment is a full word.
      const segments = s.split("-");
      expect(segments[segments.length - 1].length).toBeGreaterThan(1);
    });
  });
});

describe("generateId", () => {
  it("for typed pages: <type>-<slug>", () => {
    expect(generateId("concept", "Auth Middleware")).toBe("concept-auth-middleware");
  });

  it("for decision: includes date", () => {
    expect(generateId("decision", "JWT rejected", "2026-04-28")).toBe("decision-2026-04-28-jwt-rejected");
  });

  it("for journal: includes date+time", () => {
    const id = generateId("journal", "Webauthn session", "2026-04-28", "1530");
    expect(id).toBe("journal-2026-04-28-1530-webauthn-session");
  });
});

describe("parseId", () => {
  it("extracts type from id", () => {
    expect(parseId("concept-foo").type).toBe("concept");
    expect(parseId("decision-2026-04-28-bar").type).toBe("decision");
    expect(parseId("journal-2026-04-28-1530-baz").type).toBe("journal");
  });
});

describe("v1.5 — type folder mapping", () => {
  it("maps 'move' type to 'moves' folder", () => {
    expect(typeFolder("move")).toBe("moves");
  });

  it("maps 'profile' type to 'profiles' folder", () => {
    expect(typeFolder("profile")).toBe("profiles");
  });
});

describe("v1.5 — move directory layout detection", () => {
  it("returns true for move type", () => {
    expect(isMoveDirectoryLayout("move")).toBe(true);
  });

  it("returns false for profile type", () => {
    expect(isMoveDirectoryLayout("profile")).toBe(false);
  });

  it("returns false for concept type", () => {
    expect(isMoveDirectoryLayout("concept")).toBe(false);
  });
});

describe("filenameForType — trainer", () => {
  it("emits trainer-<slug>.md for plain names", () => {
    expect(filenameForType("trainer", "Brett")).toBe("trainer-brett.md");
  });

  it("lowercases and slugifies multi-word names", () => {
    expect(filenameForType("trainer", "Brett's Trainer")).toBe("trainer-bretts-trainer.md");
  });
});

describe("filenameForType — simple types (no date/directory prefix)", () => {
  it("emits profile-<slug>.md for profile type", () => {
    expect(filenameForType("profile", "Charmander")).toBe("profile-charmander.md");
  });

  it("emits concept-<slug>.md for concept type", () => {
    expect(filenameForType("concept", "Auth Flow")).toBe("concept-auth-flow.md");
  });

  it("emits task-<slug>.md for task type", () => {
    expect(filenameForType("task", "Fix Bug")).toBe("task-fix-bug.md");
  });
});

describe("filenameForType — excluded types (compile-time guard)", () => {
  it("rejects 'map' at the type level — map.md is fixed canonical filename with no slug", () => {
    // 'map' must not be assignable to SimpleFilenameType.
    // @ts-expect-error — 'map' is excluded from SimpleFilenameType; canonical filename is always map.md
    filenameForType("map", "anything");
  });
});
