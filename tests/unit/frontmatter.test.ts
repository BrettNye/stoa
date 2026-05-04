import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  serializeFrontmatter,
  validateAtTier,
  FrontmatterError,
  NoteType
} from "../../src/core/frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter and body", () => {
    const raw = `---
id: concept-foo
title: "Foo"
type: concept
created: 2026-04-28
---
This is the body.
`;
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.id).toBe("concept-foo");
    expect(frontmatter.type).toBe("concept");
    expect(body.trim()).toBe("This is the body.");
  });

  it("throws on missing frontmatter", () => {
    expect(() => parseFrontmatter("just body, no frontmatter\n"))
      .toThrow(FrontmatterError);
  });
});

describe("serializeFrontmatter", () => {
  it("round-trips with parseFrontmatter", () => {
    const fm = { id: "concept-x", title: "X", type: "concept", created: "2026-04-28" };
    const body = "Hello.";
    const raw = serializeFrontmatter(fm, body);
    const parsed = parseFrontmatter(raw);
    expect(parsed.frontmatter.id).toBe("concept-x");
    expect(parsed.body.trim()).toBe("Hello.");
  });
});

describe("validateAtTier", () => {
  it("accepts draft with minimal fields", () => {
    const fm = { id: "x", title: "X", type: "concept", created: "2026-04-28" };
    expect(() => validateAtTier(fm, "draft")).not.toThrow();
  });

  it("rejects draft missing required field", () => {
    const fm = { id: "x", title: "X", type: "concept" }; // missing created
    expect(() => validateAtTier(fm, "draft")).toThrow(FrontmatterError);
  });

  it("requires wiki/status/summary/updated at active tier", () => {
    const fm = { id: "x", title: "X", type: "concept", created: "2026-04-28" };
    expect(() => validateAtTier(fm, "active")).toThrow(/wiki|status|summary|updated/);
  });

  it("requires confidence on accepted decision", () => {
    const fm = {
      id: "d-1", title: "D", type: "decision", created: "2026-04-28",
      wiki: "x", status: "accepted", summary: "s", updated: "2026-04-28",
      tags: [], related: []
    };
    expect(() => validateAtTier(fm, "accepted")).toThrow(/confidence/);
  });

  it("validates channel kebab-case format", () => {
    const fm = {
      id: "j-1", title: "J", type: "journal", created: "2026-04-28",
      channel: "Bad_Channel"
    };
    expect(() => validateAtTier(fm, "draft")).toThrow(/channel/);
  });
});

describe("v1.5 — note types move and profile", () => {
  it("accepts 'move' as a NoteType", () => {
    expect(NoteType.safeParse("move").success).toBe(true);
  });

  it("accepts 'profile' as a NoteType", () => {
    expect(NoteType.safeParse("profile").success).toBe(true);
  });

  it("validates a draft move with required SKILL.md fields", () => {
    expect(() =>
      validateAtTier({
        id: "move-tdd-cycle", type: "move", title: "TDD cycle",
        created: "2026-04-29",
        name: "tdd-cycle",
        description: "Use when implementing any feature or bugfix"
      }, "draft")
    ).not.toThrow();
  });

  it("rejects a move missing description at active status", () => {
    expect(() =>
      validateAtTier({
        id: "move-tdd-cycle", type: "move", title: "TDD cycle",
        created: "2026-04-29", wiki: "_agents", status: "active",
        summary: "Red-green-refactor", updated: "2026-04-29",
        name: "tdd-cycle"
        // description missing
      }, "active")
    ).toThrow(FrontmatterError);
  });

  it("validates a draft profile with pokemon metadata", () => {
    expect(() =>
      validateAtTier({
        id: "profile-charmander", type: "profile", title: "Charmander",
        created: "2026-04-29"
      }, "draft")
    ).not.toThrow();
  });

  it("rejects a profile with invalid pokemon_type at active status", () => {
    expect(() =>
      validateAtTier({
        id: "profile-x", type: "profile", title: "X",
        created: "2026-04-29", wiki: "_agents", status: "active",
        summary: "test", updated: "2026-04-29",
        pokemon_type: "lava",  // not in 18-canon
        evolution_stage: "basic", moveset: []
      }, "active")
    ).toThrow(FrontmatterError);
  });

  it("rejects a profile with invalid evolution_stage", () => {
    expect(() =>
      validateAtTier({
        id: "profile-x", type: "profile", title: "X",
        created: "2026-04-29", wiki: "_agents", status: "active",
        summary: "test", updated: "2026-04-29",
        pokemon_type: "fire",
        evolution_stage: "level5",  // invalid
        moveset: []
      }, "active")
    ).toThrow(FrontmatterError);
  });
});

describe("trainer type", () => {
  it("round-trips a trainer through serialize → parse", () => {
    const fm = {
      id: "trainer-alice",
      type: "trainer" as const,
      title: "Alice",
      wiki: "_agents",
      status: "active" as const,
      created: "2026-05-03",
      updated: "2026-05-03",
      owner_user: "usr_a",
      trainer_id: "trn_a",
      auto_accept_invites: false,
      preferred_roster: ["profile-charizard"],
      match_history_synced_through: "2026-05-03T00:00:00Z",
      summary: "Aggressive",
      tags: ["trainer", "agent"]
    };
    const md = serializeFrontmatter(fm, "Aggressive lead. Prefer Fire-typed openers.");
    const parsed = parseFrontmatter(md);
    expect(parsed.frontmatter).toMatchObject(fm);
    expect(parsed.body.trim()).toContain("Aggressive lead");
  });

  it("parses an active trainer page from disk text", () => {
    const md = `---\nid: trainer-brett\ntype: trainer\ntitle: "Brett"\nwiki: _agents\nstatus: active\ncreated: '2026-05-03'\nupdated: '2026-05-03'\nowner_user: usr_abc123\ntrainer_id: trn_xyz789\nauto_accept_invites: true\npreferred_roster: []\nsummary: "Conservative drafter"\ntags: [trainer, agent]\n---\nStrategy body.\n`;
    const { frontmatter } = parseFrontmatter(md);
    expect(frontmatter.type).toBe("trainer");
    expect(frontmatter.trainer_id).toBe("trn_xyz789");
    expect(frontmatter.auto_accept_invites).toBe(true);
    expect(frontmatter.preferred_roster).toEqual([]);
  });

  it("accepts 'trainer' as a NoteType", () => {
    expect(NoteType.safeParse("trainer").success).toBe(true);
  });
});
