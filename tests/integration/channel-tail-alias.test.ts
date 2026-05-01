import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tailChannel } from "../../src/core/channel.js";
import { reindex } from "../../src/core/reindex.js";
import { recordRename } from "../../src/core/aliases.js";

describe("channel-tail — alias overlay + author fix", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-cta-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "journal"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });

    writeFileSync(join(vaultPath, "wikis", "alpha", "journal", "journal-2026-04-29-1000-x.md"),
      `---
id: journal-2026-04-29-1000-x
title: Journal x
type: journal
wiki: alpha
created: 2026-04-29T10:00:00Z
author: agent:charmander
channel: feat-x
---
charmander posted to feat-x
`);
    writeFileSync(join(vaultPath, "wikis", "alpha", "journal", "journal-2026-04-29-1100-y.md"),
      `---
id: journal-2026-04-29-1100-y
title: Journal y
type: journal
wiki: alpha
created: 2026-04-29T11:00:00Z
author: agent:squirtle
channel: feat-x
---
squirtle posted to feat-x
`);
    await reindex(vaultPath);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("populates the entry author from the page frontmatter (fixes the latent unknown bug)", () => {
    const r = tailChannel(vaultPath, { channel: "feat-x", since: "2026-01-01" });
    const charm = r.entries.find(e => e.id === "journal-2026-04-29-1000-x");
    expect(charm?.author).toBe("agent:charmander");
  });

  it("emits current_alias when the author's profile has been renamed", () => {
    recordRename(vaultPath, "profile-charmander", "profile-charmeleon");
    const r = tailChannel(vaultPath, { channel: "feat-x", since: "2026-01-01" });
    const charm = r.entries.find(e => e.id === "journal-2026-04-29-1000-x");
    expect(charm?.author).toBe("agent:charmander");
    expect(charm?.current_alias).toBe("charmeleon");
  });

  it("omits current_alias when the author has NOT been renamed", () => {
    const r = tailChannel(vaultPath, { channel: "feat-x", since: "2026-01-01" });
    const sq = r.entries.find(e => e.id === "journal-2026-04-29-1100-y");
    expect(sq?.author).toBe("agent:squirtle");
    expect(sq?.current_alias).toBeUndefined();
  });
});
