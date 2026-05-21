import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initVault } from "../../src/cli/commands/init.js";
import { listWikisTool } from "../../src/tools/list-wikis.js";
import { lintTool } from "../../src/tools/lint.js";

describe("integration — stoa init end-to-end", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "stoa-init-i-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("init scaffolds a complete vault tree", async () => {
    const target = join(workDir, "vault");
    await initVault({ vaultPath: target, force: false });

    // _index
    expect(existsSync(join(target, "_index", "pages.json"))).toBe(true);
    expect(existsSync(join(target, "_index", "tokens.json"))).toBe(true);
    expect(existsSync(join(target, "_index", "links.json"))).toBe(true);
    expect(existsSync(join(target, "_index", "wikis.json"))).toBe(true);

    // _agents seed
    expect(existsSync(join(target, "wikis", "_agents", "README.md"))).toBe(true);
    expect(existsSync(join(target, "wikis", "_agents", "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(target, "wikis", "_agents", "profiles"))).toBe(true);
    expect(existsSync(join(target, "wikis", "_agents", "moves"))).toBe(true);

    // Active wiki marker
    expect(existsSync(join(target, ".active-wiki"))).toBe(true);
  });

  it("after init, vault_list-wikis returns the expected wikis", async () => {
    const target = join(workDir, "vault");
    await initVault({ vaultPath: target, force: false });

    // Reindex so list-wikis sees something
    const { reindex } = await import("../../src/core/reindex.js");
    await reindex(target);

    const result = await listWikisTool.handler(
      { include_reserved: true, group_by_family: false },
      { vaultPath: target }
    );
    const names = (result as any).wikis.map((w: any) => w.name);
    expect(names).toContain("_agents");
  });

  it("after init, vault_lint reports no errors", async () => {
    const target = join(workDir, "vault");
    await initVault({ vaultPath: target, force: false });

    // Reindex first so lint has fresh sidecars.
    const { reindex } = await import("../../src/core/reindex.js");
    await reindex(target);

    const result = await lintTool.handler({ level: "error" }, { vaultPath: target });
    const errs = (result.diagnostics ?? []).filter((d: any) => d.severity === "error");
    expect(errs).toEqual([]);
  });

  it("with --with-wiki=notes, the notes wiki is scaffolded and set active", async () => {
    const target = join(workDir, "vault");
    await initVault({
      vaultPath: target,
      force: false,
      withWiki: "notes",
      mode: "idea-map"
    });

    // Notes scaffolded
    expect(existsSync(join(target, "wikis", "notes"))).toBe(true);
    expect(existsSync(join(target, "wikis", "notes", "map.md"))).toBe(true);
    expect(existsSync(join(target, "wikis", "notes", "CLAUDE.md"))).toBe(true);

    // .active-wiki is set
    const activeWiki = readFileSync(join(target, ".active-wiki"), "utf8").trim();
    expect(activeWiki).toBe("notes");

    // List wikis sees both
    const { reindex } = await import("../../src/core/reindex.js");
    await reindex(target);
    const result = await listWikisTool.handler(
      { include_reserved: true, group_by_family: false },
      { vaultPath: target }
    );
    const names = (result as any).wikis.map((w: any) => w.name);
    expect(names).toContain("_agents");
    expect(names).toContain("notes");
  });

  it("with --with-wiki, after reindex vault_lint reports no errors", async () => {
    const target = join(workDir, "vault");
    await initVault({
      vaultPath: target,
      force: false,
      withWiki: "notes",
      mode: "idea-map"
    });

    const { reindex } = await import("../../src/core/reindex.js");
    await reindex(target);

    const result = await lintTool.handler({ level: "error" }, { vaultPath: target });
    const errs = (result.diagnostics ?? []).filter((d: any) => d.severity === "error");
    expect(errs).toEqual([]);
  });

  it("init prints a next-steps block including the MCP wiring snippet", async () => {
    const target = join(workDir, "vault");
    const captured: string[] = [];
    const orig = console.log;
    console.log = (...args: any[]) => { captured.push(args.join(" ")); };
    try {
      await initVault({ vaultPath: target, force: false, print: true });
    } finally {
      console.log = orig;
    }
    const out = captured.join("\n");
    expect(out).toContain(target);
    expect(out).toContain("STOA_VAULT_PATH");
    expect(out).toContain("mcpServers");
  });
});
