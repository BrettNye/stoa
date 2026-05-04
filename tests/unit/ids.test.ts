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
