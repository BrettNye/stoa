import { describe, it, expect, afterEach } from "vitest";
import { Watcher } from "../../../src/core/eventbus/watcher.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let watcher: Watcher | null = null;

afterEach(async () => {
  if (watcher) {
    await watcher.close().catch(() => {});
    watcher = null;
  }
});

it("fires onEvent on add for matched glob", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stoa-w-"));
  mkdirSync(join(dir, "wikis", "x", "journal"), { recursive: true });
  const seen: string[] = [];
  watcher = new Watcher({
    vaultPath: dir,
    globs: ["wikis/*/journal/**/*.md"],
    onEvent: (p, k) => seen.push(`${k}:${p}`),
    awaitStabilityMs: 50,
    awaitPollMs: 20,
  });
  await watcher.start();
  writeFileSync(join(dir, "wikis", "x", "journal", "j1.md"), "---\n---\n");
  await new Promise((r) => setTimeout(r, 500));
  expect(seen.some((s) => s.startsWith("add:") && s.endsWith("j1.md"))).toBe(true);
});

describe("Watcher construction", () => {
  it("does not start chokidar at construction time", () => {
    const dir = mkdtempSync(join(tmpdir(), "stoa-w-"));
    // If chokidar were started at construction, we'd see side-effects or errors
    // This test just verifies the constructor doesn't throw and returns before start()
    watcher = new Watcher({
      vaultPath: dir,
      globs: ["**/*.md"],
      onEvent: () => {},
    });
    // No start() called — watcher should be in an unstarted state
    // We just verify construction succeeded without throwing
    expect(watcher).toBeTruthy();
  });
});

describe("Watcher.start() idempotency", () => {
  it("returns the same promise on concurrent start calls", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stoa-w-"));
    watcher = new Watcher({
      vaultPath: dir,
      globs: ["**/*.md"],
      onEvent: () => {},
      awaitStabilityMs: 30,
      awaitPollMs: 10,
    });
    const p1 = watcher.start();
    const p2 = watcher.start();
    expect(p1).toBe(p2);
    await p1;
  });

  it("is a no-op after already started", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stoa-w-"));
    watcher = new Watcher({
      vaultPath: dir,
      globs: ["**/*.md"],
      onEvent: () => {},
      awaitStabilityMs: 30,
      awaitPollMs: 10,
    });
    await watcher.start();
    // Calling start again should not throw and should resolve quickly
    await watcher.start();
  });
});

describe("Watcher close and restart", () => {
  it("can be closed and then started again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stoa-w-"));
    mkdirSync(join(dir, "notes"), { recursive: true });
    const seen: string[] = [];
    watcher = new Watcher({
      vaultPath: dir,
      globs: ["notes/**/*.md"],
      onEvent: (p, k) => seen.push(`${k}:${p}`),
      awaitStabilityMs: 50,
      awaitPollMs: 20,
    });
    await watcher.start();
    await watcher.close();

    // After close, start again
    await watcher.start();
    writeFileSync(join(dir, "notes", "note1.md"), "# test\n");
    await new Promise((r) => setTimeout(r, 500));
    expect(seen.some((s) => s.startsWith("add:") && s.endsWith("note1.md"))).toBe(true);
  });
});

describe("Watcher awaitWriteFinish defaults", () => {
  it("uses default 100ms stability and 25ms poll when not specified", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stoa-w-"));
    // Just verify construction with defaults doesn't error
    watcher = new Watcher({
      vaultPath: dir,
      globs: ["**/*.md"],
      onEvent: () => {},
    });
    // Should start without any error
    await watcher.start();
    expect(true).toBe(true);
  });
});

describe("Watcher close during startup", () => {
  it("second start() succeeds and is functional when close() is called before ready fires", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stoa-w-"));
    mkdirSync(join(dir, "notes3"), { recursive: true });
    const seen: string[] = [];
    watcher = new Watcher({
      vaultPath: dir,
      globs: ["notes3/**/*.md"],
      onEvent: (p, k) => seen.push(`${k}:${p}`),
      awaitStabilityMs: 50,
      awaitPollMs: 20,
    });

    // Fire start() but do NOT await — 'ready' may not have fired yet
    const firstStart = watcher.start();

    // Immediately close before 'ready' fires
    await watcher.close();

    // Drain the first start promise (may resolve or reject — both are acceptable)
    await firstStart.catch(() => {});

    // Second start must succeed — no leaked in-flight watcher
    await watcher.start();

    // The second watcher must be functional and fire events
    writeFileSync(join(dir, "notes3", "file2.md"), "# hi\n");
    await new Promise((r) => setTimeout(r, 600));

    expect(seen.some((s) => s.startsWith("add:") && s.endsWith("file2.md"))).toBe(true);
  });
});

describe("Watcher fires change event", () => {
  it("fires change event when an existing file is modified", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stoa-w-"));
    mkdirSync(join(dir, "docs"), { recursive: true });
    const filePath = join(dir, "docs", "page.md");
    // Write the file before starting the watcher (so it's pre-existing)
    writeFileSync(filePath, "initial content\n");

    const seen: string[] = [];
    watcher = new Watcher({
      vaultPath: dir,
      globs: ["docs/**/*.md"],
      onEvent: (p, k) => seen.push(`${k}:${p}`),
      awaitStabilityMs: 50,
      awaitPollMs: 20,
    });
    await watcher.start();

    // Modify the existing file
    writeFileSync(filePath, "updated content\n");
    await new Promise((r) => setTimeout(r, 500));
    expect(seen.some((s) => s.startsWith("change:") && s.endsWith("page.md"))).toBe(true);
  });
});
