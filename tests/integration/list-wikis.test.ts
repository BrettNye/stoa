import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWikisTool } from "../../src/tools/list-wikis.js";

describe("v1.5 — _agents wiki visibility", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-lw-v15-"));
    mkdirSync(join(vaultPath, "wikis", "alpha"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_agents"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_archive"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "wikis.json"), JSON.stringify({
      wikis: [
        { name: "alpha",    mode: "mixed", scope: "", page_counts: {}, last_touched: "2026-04-29" },
        { name: "_agents",  mode: "mixed", scope: "", page_counts: {}, last_touched: "2026-04-29" },
        { name: "_archive", mode: "mixed", scope: "", page_counts: {}, last_touched: "2026-04-29" }
      ]
    }));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("always exposes _agents (no flag needed)", async () => {
    const r = await listWikisTool.handler({ include_reserved: false }, { vaultPath });
    const names = r.wikis.map(w => w.name);
    expect(names).toContain("alpha");
    expect(names).toContain("_agents");
    expect(names).not.toContain("_archive");
  });

  it("with include_reserved=true returns _archive too", async () => {
    const r = await listWikisTool.handler({ include_reserved: true }, { vaultPath });
    const names = r.wikis.map(w => w.name);
    expect(names).toContain("_archive");
  });
});
