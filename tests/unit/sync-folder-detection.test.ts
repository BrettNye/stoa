import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectSyncFolders } from "../../src/core/sync-folder-detection.js";

it("detects Dropbox and OneDrive when both folders exist", () => {
  const home = mkdtempSync(join(tmpdir(), "sync-"));
  mkdirSync(join(home, "Dropbox"));
  mkdirSync(join(home, "OneDrive"));
  const found = detectSyncFolders(home, process.platform);
  expect(found.map((f) => f.name)).toEqual(expect.arrayContaining(["Dropbox", "OneDrive"]));
});

describe("detectSyncFolders", () => {
  it("returns empty array when no sync folders exist", () => {
    const home = mkdtempSync(join(tmpdir(), "sync-empty-"));
    const found = detectSyncFolders(home, process.platform);
    expect(found).toEqual([]);
  });

  it("detects all default-location candidates when all exist", () => {
    const home = mkdtempSync(join(tmpdir(), "sync-all-"));
    for (const subdir of ["Dropbox", "OneDrive", "Google Drive", "iCloud Drive", "Box"]) {
      mkdirSync(join(home, subdir));
    }
    const found = detectSyncFolders(home, process.platform);
    expect(found.map((f) => f.name)).toEqual(
      expect.arrayContaining(["Dropbox", "OneDrive", "Google Drive", "iCloud Drive", "Box"])
    );
  });

  it("sets detected_via to 'default-location' for all entries", () => {
    const home = mkdtempSync(join(tmpdir(), "sync-via-"));
    mkdirSync(join(home, "Dropbox"));
    mkdirSync(join(home, "Box"));
    const found = detectSyncFolders(home, process.platform);
    for (const entry of found) {
      expect(entry.detected_via).toBe("default-location");
    }
  });

  it("sets path to the full absolute path of the folder", () => {
    const home = mkdtempSync(join(tmpdir(), "sync-path-"));
    mkdirSync(join(home, "Dropbox"));
    const found = detectSyncFolders(home, process.platform);
    const dropbox = found.find((f) => f.name === "Dropbox");
    expect(dropbox).toBeDefined();
    expect(dropbox!.path).toBe(join(home, "Dropbox"));
  });

  it("detects OneDrive Business folders matching 'OneDrive - <Tenant>' pattern", () => {
    const home = mkdtempSync(join(tmpdir(), "sync-od-biz-"));
    mkdirSync(join(home, "OneDrive - Contoso"));
    mkdirSync(join(home, "OneDrive - AcmeCorp"));
    const found = detectSyncFolders(home, process.platform);
    const names = found.map((f) => f.name);
    expect(names).toContain("OneDrive - Contoso");
    expect(names).toContain("OneDrive - AcmeCorp");
  });

  it("OneDrive Business entries have detected_via 'default-location'", () => {
    const home = mkdtempSync(join(tmpdir(), "sync-od-via-"));
    mkdirSync(join(home, "OneDrive - Contoso"));
    const found = detectSyncFolders(home, process.platform);
    const entry = found.find((f) => f.name === "OneDrive - Contoso");
    expect(entry).toBeDefined();
    expect(entry!.detected_via).toBe("default-location");
  });

  it("does not throw when home directory is unreadable", () => {
    // Pass a non-existent path; existsSync returns false and readdirSync is skipped
    const found = detectSyncFolders("/nonexistent/path/that/does/not/exist", process.platform);
    expect(found).toEqual([]);
  });

  it("does not deduplicate a plain OneDrive folder when OneDrive Business also exists", () => {
    const home = mkdtempSync(join(tmpdir(), "sync-od-both-"));
    mkdirSync(join(home, "OneDrive"));
    mkdirSync(join(home, "OneDrive - Contoso"));
    const found = detectSyncFolders(home, process.platform);
    const names = found.map((f) => f.name);
    expect(names).toContain("OneDrive");
    expect(names).toContain("OneDrive - Contoso");
  });
});
