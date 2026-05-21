import { describe, it, expect } from "vitest";
import { buildCtx } from "./stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("buildCtx", () => {
  it("stamps a stdio principal with *:* scopes", () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-stdio-"));
    const ctx = buildCtx({ vaultPath: vault } as any);
    expect(ctx.principal.source).toBe("stdio");
    expect(ctx.principal.scopes).toEqual(["*:*"]);
    rmSync(vault, { recursive: true, force: true });
  });

  it("uses explicit principal when passed", () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-stdio-"));
    const explicit = { agent_id: "explicit", scopes: ["vault_recall:*"], source: "http" as const };
    const ctx = buildCtx({ vaultPath: vault } as any, undefined, explicit);
    expect(ctx.principal.agent_id).toBe("explicit");
    expect(ctx.principal.source).toBe("http");
    rmSync(vault, { recursive: true, force: true });
  });

  it("includes principal in DispatchCtx shape", () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-stdio-"));
    const ctx = buildCtx({ vaultPath: vault } as any);
    // principal must be on the returned ctx
    expect(ctx).toHaveProperty("principal");
    expect(ctx.principal).toBeDefined();
    rmSync(vault, { recursive: true, force: true });
  });

  it("preserves existing fields like vaultPath, fetcher", () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-stdio-"));
    const ctx = buildCtx({ vaultPath: vault } as any);
    expect(ctx.vaultPath).toBe(vault);
    expect(typeof ctx.fetcher).toBe("function");
    rmSync(vault, { recursive: true, force: true });
  });
});
