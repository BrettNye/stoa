import { describe, it, expect } from "vitest";
import { reindexTool } from "./reindex.js";
import { syncAgentsTool } from "./sync-agents.js";
import { syncSkillsTool } from "./sync-skills.js";
import { bootstrapRepoTool } from "./bootstrap-repo.js";
import { seedSubstrateTool } from "./seed-substrate.js";
import { evolveProfileTool } from "./evolve-profile.js";
import { lintTool } from "./lint.js";
import { setActiveTool } from "./set-active.js";
import { newWikiTool } from "./new-wiki.js";
import { z } from "zod";

describe("admin/forbidden tool flags", () => {
  it("admin-only tools carry adminOnly()=true", () => {
    expect(reindexTool.scope!.adminOnly!({})).toBe(true);
    expect(evolveProfileTool.scope!.adminOnly!({})).toBe(true);
    expect(setActiveTool.scope!.adminOnly!({})).toBe(true);
    expect(newWikiTool.scope!.adminOnly!({ name: "x" })).toBe(true);
  });
  it("http-forbidden tools carry httpForbidden=true", () => {
    expect(syncAgentsTool.scope!.httpForbidden).toBe(true);
    expect(syncSkillsTool.scope!.httpForbidden).toBe(true);
    expect(bootstrapRepoTool.scope!.httpForbidden).toBe(true);
    expect(seedSubstrateTool.scope!.httpForbidden).toBe(true);
  });
  it("lint is admin only when scope=full (Zod-parsed input)", () => {
    const parsedFull = lintTool.inputSchema.parse({ scope: "full" });
    const parsedPerWiki = lintTool.inputSchema.parse({ scope: "per-wiki" });
    const parsedDefault = lintTool.inputSchema.parse({});
    expect(lintTool.scope!.adminOnly!(parsedFull)).toBe(true);
    expect(lintTool.scope!.adminOnly!(parsedPerWiki)).toBe(false);
    expect(lintTool.scope!.adminOnly!(parsedDefault)).toBe(false);
  });
  it("reindex axis returns wikis/<wiki> when wiki provided", () => {
    expect((reindexTool.scope!.axis as Function)({ wiki: "my-wiki" })).toBe("wikis/my-wiki");
  });
  it("reindex axis returns wikis/* (not bare *) when wiki is absent", () => {
    expect((reindexTool.scope!.axis as Function)({})).toBe("wikis/*");
    expect((reindexTool.scope!.axis as Function)({ wiki: undefined })).toBe("wikis/*");
  });
});
