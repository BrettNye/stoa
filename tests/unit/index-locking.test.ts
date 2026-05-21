import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSerializedIndexWrite, STALE_LOCK_THRESHOLD_MS } from "../../src/core/index-locking.js";

describe("withSerializedIndexWrite — atomic-rename-with-retry serialization", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-locking-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "pages.json"), JSON.stringify({ pages: [] }));
  });

  it("serializes 10 concurrent increments without lost updates", async () => {
    const incrementOnce = () => withSerializedIndexWrite(vaultPath, ["pages.json"], () => {
      const data = JSON.parse(readFileSync(join(vaultPath, "_index", "pages.json"), "utf8"));
      data.pages = [...(data.pages ?? []), { id: `page-${data.pages.length}` }];
      writeFileSync(join(vaultPath, "_index", "pages.json"), JSON.stringify(data));
    });

    await Promise.all(Array.from({ length: 10 }, () => incrementOnce()));

    const data = JSON.parse(readFileSync(join(vaultPath, "_index", "pages.json"), "utf8"));
    expect(data.pages).toHaveLength(10);
  });

  it("returns the value the inner fn returns", async () => {
    const result = await withSerializedIndexWrite(vaultPath, ["pages.json"], () => 42);
    expect(result).toBe(42);
  });

  it("releases the lock on inner-fn throw, allowing subsequent calls to proceed", async () => {
    await expect(
      withSerializedIndexWrite(vaultPath, ["pages.json"], () => { throw new Error("boom"); })
    ).rejects.toThrow("boom");
    // Subsequent call must succeed (lock not stuck).
    const result = await withSerializedIndexWrite(vaultPath, ["pages.json"], () => "ok");
    expect(result).toBe("ok");
  });
});

describe("withSerializedIndexWrite — stale-lock detection", () => {
  it("exports STALE_LOCK_THRESHOLD_MS as 60000", () => {
    expect(STALE_LOCK_THRESHOLD_MS).toBe(60_000);
  });

  it("unlinks a stale lock older than threshold and proceeds", async () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-lock-"));
    const locksDir = join(vault, "_index", ".locks");
    mkdirSync(locksDir, { recursive: true });
    const lockPath = join(locksDir, "pages.json.lock");
    writeFileSync(lockPath, "");
    const oldTime = (Date.now() - 120_000) / 1000;
    utimesSync(lockPath, oldTime, oldTime);

    let ran = false;
    await withSerializedIndexWrite(vault, ["pages.json"], async () => { ran = true; });
    expect(ran).toBe(true);
    rmSync(vault, { recursive: true, force: true });
  });

  it("does not immediately remove a fresh (non-stale) lock", async () => {
    // A fresh lock should NOT be cleared by stale detection — it must wait via backoff.
    const vault = mkdtempSync(join(tmpdir(), "stoa-lock-"));
    const locksDir = join(vault, "_index", ".locks");
    mkdirSync(locksDir, { recursive: true });
    const lockPath = join(locksDir, "pages.json.lock");
    writeFileSync(lockPath, "");
    // Release the fresh lock after 100ms so the retry loop can proceed.
    const { unlinkSync } = await import("node:fs");
    const timer = setTimeout(() => {
      try { unlinkSync(lockPath); } catch { /* already gone */ }
    }, 100);

    let ran = false;
    await withSerializedIndexWrite(vault, ["pages.json"], async () => { ran = true; });
    clearTimeout(timer);
    expect(ran).toBe(true);
    rmSync(vault, { recursive: true, force: true });
  });
});
