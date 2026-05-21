import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertMcpServer } from "../../src/core/mcp-config-merge.js";

describe("upsertMcpServer", () => {
  it("preserves other servers when adding stoa", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-cfg-"));
    const p = join(dir, "settings.json");
    writeFileSync(p, JSON.stringify({ mcpServers: { other: { command: "other", args: [] } } }, null, 2));
    upsertMcpServer(p, "stoa", { command: "stoa", args: ["--mcp"] });
    const after = JSON.parse(readFileSync(p, "utf8"));
    expect(after.mcpServers.other).toBeDefined();
    expect(after.mcpServers.stoa.command).toBe("stoa");
  });

  it("creates file with valid shape when file does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-cfg-"));
    const p = join(dir, "nonexistent.json");
    upsertMcpServer(p, "stoa", { command: "stoa", args: ["--mcp"] });
    const after = JSON.parse(readFileSync(p, "utf8"));
    expect(after.mcpServers).toBeDefined();
    expect(after.mcpServers.stoa.command).toBe("stoa");
    expect(after.mcpServers.stoa.args).toEqual(["--mcp"]);
  });

  it("preserves other top-level keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-cfg-"));
    const p = join(dir, "settings.json");
    writeFileSync(p, JSON.stringify({ someSetting: true, mcpServers: {} }, null, 2));
    upsertMcpServer(p, "stoa", { command: "stoa", args: [] });
    const after = JSON.parse(readFileSync(p, "utf8"));
    expect(after.someSetting).toBe(true);
  });

  it("is idempotent - running twice produces byte-equal output", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-cfg-"));
    const p = join(dir, "settings.json");
    const entry = { command: "stoa", args: ["--mcp"] };
    upsertMcpServer(p, "stoa", entry);
    const after1 = readFileSync(p, "utf8");
    upsertMcpServer(p, "stoa", entry);
    const after2 = readFileSync(p, "utf8");
    expect(after1).toBe(after2);
  });

  it("treats empty file as empty object", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-cfg-"));
    const p = join(dir, "settings.json");
    writeFileSync(p, "");
    upsertMcpServer(p, "stoa", { command: "stoa", args: [] });
    const after = JSON.parse(readFileSync(p, "utf8"));
    expect(after.mcpServers.stoa.command).toBe("stoa");
  });

  it("treats whitespace-only file as empty object", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-cfg-"));
    const p = join(dir, "settings.json");
    writeFileSync(p, "   \n  ");
    upsertMcpServer(p, "stoa", { command: "stoa", args: [] });
    const after = JSON.parse(readFileSync(p, "utf8"));
    expect(after.mcpServers.stoa.command).toBe("stoa");
  });

  it("throws a descriptive error on malformed (non-empty, non-JSON) file", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-cfg-"));
    const p = join(dir, "settings.json");
    writeFileSync(p, "not valid json {{{{");
    expect(() => upsertMcpServer(p, "stoa", { command: "stoa", args: [] })).toThrow(
      /malformed|invalid|parse|JSON/i
    );
  });

  it("stores env when provided", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-cfg-"));
    const p = join(dir, "settings.json");
    upsertMcpServer(p, "stoa", { command: "stoa", args: [], env: { FOO: "bar" } });
    const after = JSON.parse(readFileSync(p, "utf8"));
    expect(after.mcpServers.stoa.env).toEqual({ FOO: "bar" });
  });

  it("updates an existing entry without adding duplicates", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-cfg-"));
    const p = join(dir, "settings.json");
    writeFileSync(p, JSON.stringify({ mcpServers: { stoa: { command: "old", args: [] } } }, null, 2));
    upsertMcpServer(p, "stoa", { command: "new", args: ["--mcp"] });
    const after = JSON.parse(readFileSync(p, "utf8"));
    expect(Object.keys(after.mcpServers)).toHaveLength(1);
    expect(after.mcpServers.stoa.command).toBe("new");
  });
});
