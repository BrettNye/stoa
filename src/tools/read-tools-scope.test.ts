import { describe, it, expect } from "vitest";
import { recallTool } from "./recall.js";
import { readTool } from "./read.js";
import { listWikisTool } from "./list-wikis.js";
import { listClaimsTool } from "./list-claims.js";
import { listPlatformProfilesTool } from "./list-platform-profiles.js";
import { listInvitesTool } from "./list-invites.js";
import { channelTailTool } from "./channel-tail.js";
import { taskListTool } from "./task-list.js";
import { mergeQueueTool } from "./merge-queue.js";
import { profileStatsTool } from "./profile-stats.js";
import { orientTool } from "./orient.js";
import { startTool } from "./start.js";
import { refreshProfileMemoryTool } from "./refresh-profile-memory.js";
import { suggestPokemonTool } from "./suggest-pokemon.js";

describe("read tools scope axis declarations", () => {
  it("all 14 tools have a scope field", () => {
    const tools = [
      recallTool,
      readTool,
      listWikisTool,
      listClaimsTool,
      listPlatformProfilesTool,
      listInvitesTool,
      channelTailTool,
      taskListTool,
      mergeQueueTool,
      profileStatsTool,
      orientTool,
      startTool,
      refreshProfileMemoryTool,
      suggestPokemonTool,
    ];
    for (const tool of tools) {
      expect(tool.scope, `${tool.name} missing scope`).toBeDefined();
      expect(typeof tool.scope!.axis, `${tool.name}.scope.axis should be a function`).toBe("function");
    }
  });

  it("recall derives axis from wiki input", () => {
    expect(recallTool.scope!.axis({ topic: "x", wiki: "foo" })).toBe("wikis/foo");
    expect(recallTool.scope!.axis({ topic: "x" })).toBe("*");
  });

  it("read derives axis from id input", () => {
    expect(readTool.scope!.axis({ id: "concept-foo" })).toBe("concept-foo");
    expect(readTool.scope!.axis({})).toBe("*");
  });

  it("list-wikis has singleton vault axis", () => {
    expect(listWikisTool.scope!.axis({})).toBe("vault");
  });

  it("list-claims derives axis from wiki input", () => {
    expect(listClaimsTool.scope!.axis({ wiki: "myWiki" })).toBe("wikis/myWiki/claim");
    expect(listClaimsTool.scope!.axis({})).toBe("wikis/*/claim");
  });

  it("list-platform-profiles derives axis from wiki input", () => {
    expect(listPlatformProfilesTool.scope!.axis({ wiki: "someWiki" })).toBe("wikis/someWiki");
    expect(listPlatformProfilesTool.scope!.axis({})).toBe("wikis/*");
  });

  it("list-invites has wildcard axis (no wiki field in schema)", () => {
    expect(listInvitesTool.scope!.axis({})).toBe("wikis/*");
  });

  it("channel-tail derives axis from channel input", () => {
    expect(channelTailTool.scope!.axis({ channel: "dev" })).toBe("channels/dev");
  });

  it("task-list derives axis from wiki input", () => {
    expect(taskListTool.scope!.axis({ wiki: "proj" })).toBe("wikis/proj");
    expect(taskListTool.scope!.axis({})).toBe("wikis/*");
  });

  it("merge-queue derives axis from wiki input", () => {
    expect(mergeQueueTool.scope!.axis({ wiki: "proj", channel: "main" })).toBe("wikis/proj");
    expect(mergeQueueTool.scope!.axis({ channel: "main" })).toBe("wikis/*");
  });

  it("profile-stats derives axis from wiki and pokemon_id", () => {
    expect(profileStatsTool.scope!.axis({ wiki: "proj", pokemon_id: "charmander" })).toBe("wikis/proj/profiles/charmander");
    expect(profileStatsTool.scope!.axis({ pokemon_id: "charmander" })).toBe("wikis/*/profiles/charmander");
  });

  it("orient has singleton vault axis", () => {
    expect(orientTool.scope!.axis({})).toBe("vault");
  });

  it("start derives axis from wiki input", () => {
    expect(startTool.scope!.axis({ wiki: "proj" })).toBe("wikis/proj");
    expect(startTool.scope!.axis({})).toBe("wikis/*");
  });

  it("refresh-profile-memory derives axis from wiki and pokemon_id (agent_id field)", () => {
    expect(refreshProfileMemoryTool.scope!.axis({ wiki: "proj", agent_id: "charmeleon" })).toBe("wikis/proj/profiles/charmeleon");
    expect(refreshProfileMemoryTool.scope!.axis({ agent_id: "charmeleon" })).toBe("wikis/*/profiles/charmeleon");
  });

  it("suggest-pokemon has singleton vault axis", () => {
    expect(suggestPokemonTool.scope!.axis({})).toBe("vault");
  });
});
