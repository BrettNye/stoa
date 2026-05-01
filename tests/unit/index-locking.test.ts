import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSerializedIndexWrite } from "../../src/core/index-locking.js";

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
