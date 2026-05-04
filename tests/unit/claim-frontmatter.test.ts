import { describe, it, expect } from "vitest";
import {
  parseClaim,
  ClaimStatus,
  ClaimDraft,
  ClaimActive,
  ClaimSuperseded,
  ClaimRetracted,
  type ClaimFrontmatter,
} from "../../src/types/claim.js";
import * as ClaimModule from "../../src/types/claim.js";

const baseDraft = {
  id: "claim-x",
  type: "claim",
  title: "x",
  created: "2026-05-02",
  key: "test.x",
  confidence: 0.7,
  last_validated: "2026-05-02",
  status: "draft",
};

const baseActive = {
  ...baseDraft,
  status: "active",
  wiki: "_agents",
  summary: "x",
  updated: "2026-05-02",
  authored_by: "agent:x",
};

describe("parseClaim — required fields and tier enforcement", () => {
  it("rejects active claim missing key", () => {
    const fm = { ...baseActive } as Record<string, unknown>;
    delete fm.key;
    expect(() => parseClaim(fm)).toThrow(/key/);
  });

  it("rejects active claim missing wiki", () => {
    const fm = { ...baseActive } as Record<string, unknown>;
    delete fm.wiki;
    expect(() => parseClaim(fm)).toThrow();
  });

  it("rejects active claim missing summary", () => {
    const fm = { ...baseActive } as Record<string, unknown>;
    delete fm.summary;
    expect(() => parseClaim(fm)).toThrow();
  });

  it("rejects active claim missing updated", () => {
    const fm = { ...baseActive } as Record<string, unknown>;
    delete fm.updated;
    expect(() => parseClaim(fm)).toThrow();
  });

  it("rejects active claim missing authored_by", () => {
    const fm = { ...baseActive } as Record<string, unknown>;
    delete fm.authored_by;
    expect(() => parseClaim(fm)).toThrow();
  });

  it("rejects active claim missing confidence", () => {
    const fm = { ...baseActive } as Record<string, unknown>;
    delete fm.confidence;
    expect(() => parseClaim(fm)).toThrow();
  });

  it("rejects active claim missing last_validated", () => {
    const fm = { ...baseActive } as Record<string, unknown>;
    delete fm.last_validated;
    expect(() => parseClaim(fm)).toThrow();
  });

  it("accepts a draft claim with only the minimal required fields", () => {
    const fm = { ...baseDraft };
    const parsed = parseClaim(fm);
    expect(parsed.status).toBe("draft");
    expect(parsed.id).toBe("claim-x");
    expect(parsed.key).toBe("test.x");
  });

  it("accepts an active claim with all required fields", () => {
    const parsed = parseClaim(baseActive);
    expect(parsed.status).toBe("active");
    expect(parsed.wiki).toBe("_agents");
    expect(parsed.authored_by).toBe("agent:x");
  });
});

describe("parseClaim — evidence array semantics", () => {
  it("accepts active claim with empty evidence array (preferred but not required)", () => {
    expect(parseClaim({ ...baseActive, evidence: [] })).toMatchObject({
      status: "active",
      evidence: [],
    });
  });

  it("accepts active claim with populated evidence array", () => {
    const evidence = [
      "[[wikis/_agents/journal/journal-2026-04-30-foo]]",
      "[[wikis/_agents/journal/journal-2026-04-30-bar]]",
    ];
    expect(parseClaim({ ...baseActive, evidence })).toMatchObject({
      status: "active",
      evidence,
    });
  });

  it("defaults evidence to [] when omitted entirely", () => {
    const parsed = parseClaim({ ...baseActive });
    expect(parsed.evidence).toEqual([]);
  });
});

describe("parseClaim — supersession", () => {
  it("rejects superseded claim with null superseded_by", () => {
    const fm = {
      ...baseActive,
      status: "superseded",
      superseded_by: null,
    };
    expect(() => parseClaim(fm)).toThrow();
  });

  it("rejects superseded claim missing superseded_by entirely", () => {
    const fm = { ...baseActive, status: "superseded" };
    expect(() => parseClaim(fm)).toThrow();
  });

  it("accepts superseded claim with a valid superseded_by id", () => {
    const fm = {
      ...baseActive,
      status: "superseded",
      superseded_by: "claim-newer",
    };
    const parsed = parseClaim(fm);
    expect(parsed.status).toBe("superseded");
    expect(parsed.superseded_by).toBe("claim-newer");
  });
});

describe("parseClaim — retraction", () => {
  it("accepts retracted claim with all retraction fields populated", () => {
    const fm = {
      ...baseActive,
      status: "retracted",
      retracted_at: "2026-05-02",
      retracted_by: "agent:x",
      retraction_reason: "found a counterexample",
    };
    const parsed = parseClaim(fm);
    expect(parsed.status).toBe("retracted");
    expect(parsed.retracted_at).toBe("2026-05-02");
    expect(parsed.retracted_by).toBe("agent:x");
    expect(parsed.retraction_reason).toBe("found a counterexample");
  });

  it("rejects retracted claim with null retracted_at", () => {
    const fm = {
      ...baseActive,
      status: "retracted",
      retracted_at: null,
      retracted_by: "agent:x",
      retraction_reason: "x",
    };
    expect(() => parseClaim(fm)).toThrow();
  });

  it("rejects retracted claim missing retraction_reason", () => {
    const fm = {
      ...baseActive,
      status: "retracted",
      retracted_at: "2026-05-02",
      retracted_by: "agent:x",
    };
    expect(() => parseClaim(fm)).toThrow();
  });

  it("rejects retracted claim with empty retraction_reason", () => {
    const fm = {
      ...baseActive,
      status: "retracted",
      retracted_at: "2026-05-02",
      retracted_by: "agent:x",
      retraction_reason: "",
    };
    expect(() => parseClaim(fm)).toThrow();
  });
});

describe("parseClaim — confidence range", () => {
  it("rejects confidence > 1", () => {
    expect(() => parseClaim({ ...baseActive, confidence: 1.5 })).toThrow();
  });

  it("rejects confidence < 0", () => {
    expect(() => parseClaim({ ...baseActive, confidence: -0.1 })).toThrow();
  });

  it("accepts confidence at boundaries (0 and 1)", () => {
    expect(parseClaim({ ...baseActive, confidence: 0 }).confidence).toBe(0);
    expect(parseClaim({ ...baseActive, confidence: 1 }).confidence).toBe(1);
  });

  it("accepts mid-range confidence", () => {
    expect(parseClaim({ ...baseActive, confidence: 0.42 }).confidence).toBe(0.42);
  });
});

describe("parseClaim — scope dimensions", () => {
  it("rejects profile as a single string (must be array)", () => {
    expect(() =>
      parseClaim({ ...baseActive, profile: "single-string" } as Record<string, unknown>),
    ).toThrow();
  });

  it("rejects move as a single string", () => {
    expect(() =>
      parseClaim({ ...baseActive, move: "move-x" } as Record<string, unknown>),
    ).toThrow();
  });

  it("rejects scope_wiki as a single string", () => {
    expect(() =>
      parseClaim({ ...baseActive, scope_wiki: "_agents" } as Record<string, unknown>),
    ).toThrow();
  });

  it("rejects tags as a single string", () => {
    expect(() =>
      parseClaim({ ...baseActive, tags: "windows" } as Record<string, unknown>),
    ).toThrow();
  });

  it("accepts empty arrays on every scope dimension", () => {
    const parsed = parseClaim({
      ...baseActive,
      profile: [],
      move: [],
      scope_wiki: [],
      tags: [],
    });
    expect(parsed.profile).toEqual([]);
    expect(parsed.move).toEqual([]);
    expect(parsed.scope_wiki).toEqual([]);
    expect(parsed.tags).toEqual([]);
  });

  it("accepts populated arrays on every scope dimension", () => {
    const parsed = parseClaim({
      ...baseActive,
      profile: ["profile-charmander"],
      move: ["move-pr-create"],
      scope_wiki: ["_agents"],
      tags: ["windows", "git-worktree"],
    });
    expect(parsed.profile).toEqual(["profile-charmander"]);
    expect(parsed.move).toEqual(["move-pr-create"]);
    expect(parsed.scope_wiki).toEqual(["_agents"]);
    expect(parsed.tags).toEqual(["windows", "git-worktree"]);
  });

  it("defaults all scope dimensions to [] when omitted entirely", () => {
    const parsed = parseClaim({ ...baseActive });
    expect(parsed.profile).toEqual([]);
    expect(parsed.move).toEqual([]);
    expect(parsed.scope_wiki).toEqual([]);
    expect(parsed.tags).toEqual([]);
  });
});

describe("parseClaim — id and type discriminators", () => {
  it("rejects id that does not start with claim-", () => {
    expect(() => parseClaim({ ...baseActive, id: "task-x" })).toThrow();
  });

  it("rejects type other than 'claim'", () => {
    expect(() => parseClaim({ ...baseActive, type: "concept" })).toThrow();
  });
});

describe("parseClaim — key format", () => {
  it("rejects key without dot segments", () => {
    expect(() => parseClaim({ ...baseActive, key: "nodot" })).toThrow();
  });

  it("rejects key with uppercase letters", () => {
    expect(() => parseClaim({ ...baseActive, key: "Test.X" })).toThrow();
  });

  it("accepts kebab-case multi-segment key", () => {
    const parsed = parseClaim({
      ...baseActive,
      key: "move.pr-create.requires-remote-preflight",
    });
    expect(parsed.key).toBe("move.pr-create.requires-remote-preflight");
  });
});

describe("parseClaim — date format", () => {
  it("rejects malformed last_validated date", () => {
    expect(() => parseClaim({ ...baseActive, last_validated: "not-a-date" })).toThrow();
  });

  it("rejects malformed created date", () => {
    expect(() => parseClaim({ ...baseActive, created: "2026/05/02" })).toThrow();
  });
});

describe("parseClaim — status enum", () => {
  it("rejects unknown status value", () => {
    expect(() => parseClaim({ ...baseActive, status: "ephemeral" })).toThrow();
  });

  it("accepts every valid ClaimStatus value", () => {
    const values = ClaimStatus.options;
    expect(values).toContain("draft");
    expect(values).toContain("active");
    expect(values).toContain("superseded");
    expect(values).toContain("retracted");
  });
});

describe("module exports — named only, no default", () => {
  it("exposes parseClaim as a named export", () => {
    expect(typeof parseClaim).toBe("function");
  });

  it("exposes ClaimDraft, ClaimActive, ClaimSuperseded, ClaimRetracted, ClaimStatus as named exports", () => {
    expect(ClaimDraft).toBeDefined();
    expect(ClaimActive).toBeDefined();
    expect(ClaimSuperseded).toBeDefined();
    expect(ClaimRetracted).toBeDefined();
    expect(ClaimStatus).toBeDefined();
  });

  it("does not expose a default export", () => {
    // CommonJS-style default check: in ESM, an absent default is `undefined` on the namespace.
    expect((ClaimModule as unknown as { default?: unknown }).default).toBeUndefined();
  });
});

describe("ClaimFrontmatter type inference", () => {
  it("typed parse result matches narrowed shape", () => {
    const parsed: ClaimFrontmatter = parseClaim(baseActive);
    // Type-level smoke: the inferred type carries the expected fields.
    expect(parsed.id).toBe("claim-x");
    expect(parsed.confidence).toBe(0.7);
  });
});
