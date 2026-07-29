import { describe, it, expect } from "vitest";
import { resolveBlobPath, readBundleItems, readBlob } from "./pangolin-bundle.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("pangolin-bundle", () => {
  it("maps a content-addressed ref to its blob path", () => {
    expect(resolveBlobPath("pangolin://ns/artifact/concerns/sha256:abc", "/root"))
      .toBe(join("/root", "ns", "artifact", "concerns", "sha256:abc.blob"));
  });

  it("returns null for a non-content-addressed ref", () => {
    expect(resolveBlobPath("pangolin://ns/dispatches/d-1", "/root")).toBeNull();
  });

  it("returns null for a ref with more than four path segments", () => {
    expect(resolveBlobPath("pangolin://ns/artifact/concerns/extra/sha256:abc", "/root")).toBeNull();
  });

  it("returns null when a segment is '.' or '..'", () => {
    expect(resolveBlobPath("pangolin://../artifact/concerns/sha256:abc", "/root")).toBeNull();
    expect(resolveBlobPath("pangolin://ns/./concerns/sha256:abc", "/root")).toBeNull();
  });

  it("reads items out of an audit bundle", () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-"));
    const p = join(dir, "bundle.json");
    writeFileSync(p, JSON.stringify({ items: [{ id: "task-1", status: "done" }] }));
    expect(readBundleItems(p)).toHaveLength(1);
  });

  it("returns [] when the bundle has no items key", () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-"));
    const p = join(dir, "bundle.json");
    writeFileSync(p, JSON.stringify({ notItems: [] }));
    expect(readBundleItems(p)).toEqual([]);
  });

  it("readBlob returns null for an unresolvable ref", () => {
    expect(readBlob("pangolin://ns/dispatches/d-1", "/root")).toBeNull();
  });

  it("readBlob returns null for a resolvable ref whose blob file does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-storage-"));
    expect(readBlob("pangolin://ns/artifact/concerns/sha256:abc", dir)).toBeNull();
  });

  it("readBlob reads the bytes of an existing blob", () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-storage-"));
    const blobDir = join(dir, "ns", "artifact", "concerns");
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(join(blobDir, "sha256:abc.blob"), "hello world");
    expect(readBlob("pangolin://ns/artifact/concerns/sha256:abc", dir)).toBe("hello world");
  });
});
