import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postToChannel, tailChannel } from "../../src/core/channel.js";
import { reindex } from "../../src/core/reindex.js";

describe("multi-instance simulation (v1.7 Phase 1 acceptance §5.8)", () => {
  it("3 simulated agents write to a shared channel and reindex concurrently with zero lost writes", async () => {
    const vaultPath = mkdtempSync(join(tmpdir(), "vault-multi-instance-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "alpha", "journal"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "pages.json"), JSON.stringify({ pages: [] }));
    writeFileSync(join(vaultPath, "_index", "tokens.json"), JSON.stringify({}));
    writeFileSync(join(vaultPath, "_index", "wikis.json"), JSON.stringify({
      wikis: [{ name: "alpha", mode: "mixed", scope: "", page_counts: {}, last_touched: "" }]
    }));
    writeFileSync(join(vaultPath, "_index", "links.json"), JSON.stringify({}));

    const writeOnce = async (agent: string, i: number) => {
      await postToChannel(vaultPath, {
        channel: "feat-multi-instance-test",
        content: `agent ${agent} message ${i}`,
        wiki: "alpha",
        agent_id: agent,
      });
    };

    const work = [
      ...Array.from({ length: 5 }, (_, i) => writeOnce("orch", i)),
      ...Array.from({ length: 5 }, (_, i) => writeOnce("char", i)),
      ...Array.from({ length: 5 }, (_, i) => writeOnce("squir", i)),
      reindex(vaultPath),  // concurrent reindex during writes
    ];

    await Promise.all(work);

    // No lost writes: 15 channel posts on disk and in pages.json.
    const tail = tailChannel(vaultPath, { channel: "feat-multi-instance-test", wiki: "alpha", limit: 100 });
    expect(tail.entries).toHaveLength(15);

    // Internal consistency: every entry in pages.json has a tokens entry.
    const pages = JSON.parse(readFileSync(join(vaultPath, "_index", "pages.json"), "utf8")).pages;
    const tokens = JSON.parse(readFileSync(join(vaultPath, "_index", "tokens.json"), "utf8"));
    for (const p of pages) expect(tokens[p.id]).toBeDefined();

    // wikis.json reflects the writes.
    const wikis = JSON.parse(readFileSync(join(vaultPath, "_index", "wikis.json"), "utf8")).wikis;
    const alpha = wikis.find((w: any) => w.name === "alpha");
    expect(alpha.page_counts.journal).toBe(15);
  });
});
