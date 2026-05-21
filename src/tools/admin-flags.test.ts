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
  it("lint is admin only when scope=full", () => {
    expect(lintTool.scope!.adminOnly!({ scope: "full" })).toBe(true);
    expect(lintTool.scope!.adminOnly!({ scope: "per-wiki" })).toBe(false);
  });
});
