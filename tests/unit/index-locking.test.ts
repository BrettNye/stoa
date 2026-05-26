import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync, writeFileSync, readFileSync, mkdirSync, utimesSync,
  rmSync, unlinkSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSerializedIndexWrite, STALE_LOCK_THRESHOLD_MS } from "../../src/core/index-locking.js";

// ---------------------------------------------------------------------------
// Module-level intercept state used by the stale-cap test.
// vi.mock is hoisted before all imports, so this object is initialized first.
// The real implementations are captured once inside the factory and invoked
// when the override slots are null (i.e., during all other tests).
// ---------------------------------------------------------------------------
let openSyncOverride: ((...args: unknown[]) => unknown) | null = null;
let statSyncOverride: ((...args: unknown[]) => unknown) | null = null;

vi.mock("node:fs", async () => {
  const real = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...real,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    openSync: (...args: unknown[]) => {
      if (openSyncOverride) return openSyncOverride(...args);
      return (real.openSync as (...a: unknown[]) => unknown)(...args);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    statSync: (...args: unknown[]) => {
      if (statSyncOverride) return statSyncOverride(...args);
      return (real.statSync as (...a: unknown[]) => unknown)(...args);
    },
  };
});

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
    const timer = setTimeout(() => {
      try { unlinkSync(lockPath); } catch { /* already gone */ }
    }, 100);

    let ran = false;
    await withSerializedIndexWrite(vault, ["pages.json"], async () => { ran = true; });
    clearTimeout(timer);
    expect(ran).toBe(true);
    rmSync(vault, { recursive: true, force: true });
  });

  describe("stale-unlink retry cap", () => {
    afterEach(() => {
      // Always restore overrides so subsequent tests use real fs.
      openSyncOverride = null;
      statSyncOverride = null;
    });

    it("caps stale-unlink retries at 3 then falls through to backoff and MAX_RETRIES exhaustion", async () => {
      // openSync("wx") always throws EEXIST — lock is never acquirable.
      // statSync always returns a stale mtime — stale-detection fires every iteration.
      //
      // With the cap in place, iterations 1-3 take the stale-unlink fast path
      // (staleRetries < 3). From iteration 4 onward, staleRetries >= 3 so the
      // code falls through to attempts++ + 50ms backoff. Eventually MAX_RETRIES
      // is exhausted and "could not acquire lock" is thrown.
      //
      // Without the cap (old code), the loop spins forever because `continue`
      // fires unconditionally after unlinkSync, bypassing attempts++ entirely.
      const staleMtime = Date.now() - 120_000;
      openSyncOverride = (...args: unknown[]) => {
        const [, flags] = args as [unknown, string];
        if (flags === "wx") {
          throw Object.assign(new Error("EEXIST: file already exists"), { code: "EEXIST" });
        }
        // Non-"wx" opens (e.g., mkdirSync internals) pass through — but
        // existsSync / mkdirSync don't use openSync, so this is a safety net.
        throw Object.assign(new Error("Unexpected openSync call in cap test"), { code: "ENOENT" });
      };
      statSyncOverride = () => ({ mtimeMs: staleMtime } as unknown as Stats);

      const vault = mkdtempSync(join(tmpdir(), "stoa-lock-stale-cap-"));
      try {
        await expect(
          withSerializedIndexWrite(vault, ["pages.json"], () => "should not run")
        ).rejects.toThrow(/could not acquire lock/);
      } finally {
        rmSync(vault, { recursive: true, force: true });
      }
    }, 30_000); // generous; bounded by MAX_RETRIES × RETRY_DELAY_MS ≈ 10s
  });
});
