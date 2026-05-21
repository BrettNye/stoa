// src/tools/creator-scopes.test.ts
//
// Verifies that the 8 creator tools declare scope.axis + scope.adminOnly
// per spec §7.4 and the server-mode plan task-tools-creators.

import { describe, it, expect } from "vitest";
import { newTool } from "./new.js";
import { inboxTool } from "./inbox.js";
import { processInboxTool } from "./process-inbox.js";
import { synthesizeTool } from "./synthesize.js";
import { newProfileTool } from "./new-profile.js";
import { newMoveTool } from "./new-move.js";
import { rewriteLinksTool } from "./rewrite-links.js";
import { mergeRecordTool } from "./merge-record.js";

describe("creator tools scope declarations", () => {

  // ---- vault_new -------------------------------------------------------

  describe("vault_new", () => {
    it("has a scope field", () => {
      expect(newTool.scope).toBeDefined();
    });

    it("scope.axis is a function", () => {
      expect(typeof newTool.scope!.axis).toBe("function");
    });

    it("scope.axis returns path including wiki, type, and id when all present", () => {
      expect(newTool.scope!.axis({ wiki: "foo", type: "concept", id: "concept-bar" }))
        .toBe("wikis/foo/concept/concept-bar");
    });

    it("scope.axis defaults id to '*' when absent", () => {
      expect(newTool.scope!.axis({ wiki: "foo", type: "concept" }))
        .toBe("wikis/foo/concept/*");
    });

    it("adminOnly returns true for type=map", () => {
      expect(newTool.scope!.adminOnly!({ type: "map", wiki: "foo" })).toBe(true);
    });

    it("adminOnly returns false for non-map types", () => {
      expect(newTool.scope!.adminOnly!({ type: "concept", wiki: "foo" })).toBe(false);
      expect(newTool.scope!.adminOnly!({ type: "guide", wiki: "foo" })).toBe(false);
      expect(newTool.scope!.adminOnly!({ type: "spec", wiki: "foo" })).toBe(false);
    });
  });

  // ---- vault_inbox -----------------------------------------------------

  describe("vault_inbox", () => {
    it("has a scope field", () => {
      expect(inboxTool.scope).toBeDefined();
    });

    it("scope.axis is a function", () => {
      expect(typeof inboxTool.scope!.axis).toBe("function");
    });

    it("scope.axis returns wikis/<wiki>/inbox when wiki present", () => {
      expect(inboxTool.scope!.axis({ thought: "test", wiki: "myWiki" }))
        .toBe("wikis/myWiki/inbox");
    });

    it("scope.axis defaults wiki to '*' when absent", () => {
      expect(inboxTool.scope!.axis({ thought: "test" }))
        .toBe("wikis/*/inbox");
    });

    it("does not have adminOnly", () => {
      expect(inboxTool.scope!.adminOnly).toBeUndefined();
    });
  });

  // ---- vault_process-inbox ---------------------------------------------

  describe("vault_process-inbox", () => {
    it("has a scope field", () => {
      expect(processInboxTool.scope).toBeDefined();
    });

    it("scope.axis is a function", () => {
      expect(typeof processInboxTool.scope!.axis).toBe("function");
    });

    it("scope.axis returns wikis/<wiki>/inbox when wiki present", () => {
      expect(processInboxTool.scope!.axis({ wiki: "proj" }))
        .toBe("wikis/proj/inbox");
    });

    it("scope.axis defaults wiki to '*' when absent", () => {
      expect(processInboxTool.scope!.axis({}))
        .toBe("wikis/*/inbox");
    });

    it("does not have adminOnly", () => {
      expect(processInboxTool.scope!.adminOnly).toBeUndefined();
    });
  });

  // ---- vault_synthesize ------------------------------------------------

  describe("vault_synthesize", () => {
    it("has a scope field", () => {
      expect(synthesizeTool.scope).toBeDefined();
    });

    it("scope.axis is a function", () => {
      expect(typeof synthesizeTool.scope!.axis).toBe("function");
    });

    it("scope.axis returns wikis/<wiki>/synthesis when wiki present", () => {
      expect(synthesizeTool.scope!.axis({ topic: "foo", wiki: "bar" }))
        .toBe("wikis/bar/synthesis");
    });

    it("scope.axis defaults wiki to '*' when absent", () => {
      expect(synthesizeTool.scope!.axis({ topic: "foo" }))
        .toBe("wikis/*/synthesis");
    });

    it("does not have adminOnly", () => {
      expect(synthesizeTool.scope!.adminOnly).toBeUndefined();
    });
  });

  // ---- vault_new-profile -----------------------------------------------

  describe("vault_new-profile", () => {
    it("has a scope field", () => {
      expect(newProfileTool.scope).toBeDefined();
    });

    it("scope.axis is a function", () => {
      expect(typeof newProfileTool.scope!.axis).toBe("function");
    });

    it("scope.axis returns wikis/<wiki>/profiles/<pokemon> when both present", () => {
      expect(newProfileTool.scope!.axis({ wiki: "myWiki", pokemon: "charmander" }))
        .toBe("wikis/myWiki/profiles/charmander");
    });

    it("scope.axis defaults wiki to '_agents' when absent", () => {
      expect(newProfileTool.scope!.axis({ pokemon: "bulbasaur" }))
        .toBe("wikis/_agents/profiles/bulbasaur");
    });

    it("scope.axis defaults pokemon to '*' when absent", () => {
      expect(newProfileTool.scope!.axis({ wiki: "myWiki" }))
        .toBe("wikis/myWiki/profiles/*");
    });

    it("scope.axis uses defaults for both wiki and pokemon when absent", () => {
      expect(newProfileTool.scope!.axis({}))
        .toBe("wikis/_agents/profiles/*");
    });

    it("adminOnly always returns true", () => {
      expect(newProfileTool.scope!.adminOnly!({})).toBe(true);
      expect(newProfileTool.scope!.adminOnly!({ wiki: "foo", pokemon: "charmander" })).toBe(true);
    });
  });

  // ---- vault_new-move --------------------------------------------------

  describe("vault_new-move", () => {
    it("has a scope field", () => {
      expect(newMoveTool.scope).toBeDefined();
    });

    it("scope.axis is a function", () => {
      expect(typeof newMoveTool.scope!.axis).toBe("function");
    });

    it("scope.axis returns wikis/<wiki>/moves/<move_id> when both present", () => {
      expect(newMoveTool.scope!.axis({ wiki: "myWiki", move_id: "move-foo" }))
        .toBe("wikis/myWiki/moves/move-foo");
    });

    it("scope.axis defaults wiki to '_agents' when absent", () => {
      expect(newMoveTool.scope!.axis({ move_id: "move-bar" }))
        .toBe("wikis/_agents/moves/move-bar");
    });

    it("scope.axis defaults move_id to '*' when absent", () => {
      expect(newMoveTool.scope!.axis({ wiki: "myWiki" }))
        .toBe("wikis/myWiki/moves/*");
    });

    it("scope.axis uses defaults for both wiki and move_id when absent", () => {
      expect(newMoveTool.scope!.axis({}))
        .toBe("wikis/_agents/moves/*");
    });

    it("adminOnly always returns true", () => {
      expect(newMoveTool.scope!.adminOnly!({})).toBe(true);
    });
  });

  // ---- vault_rewrite-links ---------------------------------------------

  describe("vault_rewrite-links", () => {
    it("has a scope field", () => {
      expect(rewriteLinksTool.scope).toBeDefined();
    });

    it("scope.axis is a function", () => {
      expect(typeof rewriteLinksTool.scope!.axis).toBe("function");
    });

    it("scope.axis returns wikis/<wiki> when wiki present", () => {
      expect(rewriteLinksTool.scope!.axis({ wiki: "myWiki", from_prefix: "a", to_prefix: "b" }))
        .toBe("wikis/myWiki");
    });

    it("scope.axis defaults wiki to '*' when absent", () => {
      expect(rewriteLinksTool.scope!.axis({ from_prefix: "a", to_prefix: "b" }))
        .toBe("wikis/*");
    });

    it("adminOnly always returns true", () => {
      expect(rewriteLinksTool.scope!.adminOnly!({})).toBe(true);
    });
  });

  // ---- vault_merge-record ----------------------------------------------

  describe("vault_merge-record", () => {
    it("has a scope field", () => {
      expect(mergeRecordTool.scope).toBeDefined();
    });

    it("scope.axis is a function", () => {
      expect(typeof mergeRecordTool.scope!.axis).toBe("function");
    });

    it("scope.axis returns wikis/<wiki> when wiki present", () => {
      expect(mergeRecordTool.scope!.axis({ wiki: "proj", pr_number: 1, channel: "main", agent_id: "x", status: "merged" }))
        .toBe("wikis/proj");
    });

    it("scope.axis defaults wiki to '*' when absent (merge-record has no wiki in schema)", () => {
      expect(mergeRecordTool.scope!.axis({ pr_number: 1, channel: "main", agent_id: "x", status: "merged" }))
        .toBe("wikis/*");
    });

    it("does not have adminOnly", () => {
      expect(mergeRecordTool.scope!.adminOnly).toBeUndefined();
    });
  });

});
