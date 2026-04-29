import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  serializeFrontmatter,
  validateAtTier,
  FrontmatterError
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
