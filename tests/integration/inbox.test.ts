import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureInbox, listInbox, promoteInboxItem } from "../../src/core/inbox.js";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-inbox-"));
  mkdirSync(join(vault, "wikis", "alpha", "inbox"), { recursive: true });
  mkdirSync(join(vault, "wikis", "alpha", "ideas"), { recursive: true });
});

describe("captureInbox", () => {
  it("writes a dated file with content", () => {
    const result = captureInbox(vault, "alpha", "thought about event sourcing");
    expect(existsSync(result.path)).toBe(true);
    expect(result.id).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}-thought-about/);
    expect(readFileSync(result.path, "utf8")).toContain("thought about event sourcing");
  });
});

describe("listInbox", () => {
  it("returns paths of all inbox files", () => {
    captureInbox(vault, "alpha", "first");
    captureInbox(vault, "alpha", "second");
    const items = listInbox(vault, "alpha");
    expect(items).toHaveLength(2);
  });
});

describe("promoteInboxItem", () => {
  it("moves and renames file with new frontmatter", () => {
    const captured = captureInbox(vault, "alpha", "event sourcing thought");
    const result = promoteInboxItem(vault, {
      inbox_path: captured.path,
      type: "idea",
      id: "idea-event-sourcing",
      wiki: "alpha"
    });
    expect(existsSync(captured.path)).toBe(false);
    expect(existsSync(result.to)).toBe(true);
    const content = readFileSync(result.to, "utf8");
    expect(content).toMatch(/type: idea/);
    expect(content).toMatch(/id: idea-event-sourcing/);
    expect(content).toMatch(/status: draft/);
  });
});
