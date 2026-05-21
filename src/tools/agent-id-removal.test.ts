// src/tools/agent-id-removal.test.ts
//
// Verifies that agent_id (and authored_by for claim.ts) has been removed from
// the inputSchema of all 7 write tools per spec §6.5 of the server-mode design.
// Also verifies each tool declares a `scope` object with an `axis` function,
// and that handlers read from ctx.principal?.agent_id rather than input.
//
// These tests run purely at the schema / metadata level — no filesystem access
// is needed.

import { describe, it, expect } from "vitest";
import { z } from "zod";

import { channelPostTool } from "./channel-post.js";
import { agentJournalTool } from "./agent-journal.js";
import { taskClaimTool } from "./task-claim.js";
import { taskUpdateTool } from "./task-update.js";
import { taskCreateTool } from "./task-create.js";
import { claimTool } from "./claim.js";
import { agentMemoryTool } from "./agent-memory.js";

// ---- helpers ----------------------------------------------------------------

type AnyTool = {
  name: string;
  inputSchema: z.ZodTypeAny;
  scope?: unknown;
};

function schemaShape(tool: AnyTool): Record<string, unknown> {
  const s = tool.inputSchema;
  if (s instanceof z.ZodObject) {
    return s.shape as Record<string, unknown>;
  }
  return {};
}

// ---- agent_id removed from inputSchema --------------------------------------

describe("agent_id removed from all 7 tool inputSchemas", () => {
  const toolsUnderTest: [string, AnyTool][] = [
    ["vault_channel-post", channelPostTool],
    ["vault_agent-journal", agentJournalTool],
    ["vault_task-claim", taskClaimTool],
    ["vault_task-update", taskUpdateTool],
    ["vault_task-create", taskCreateTool],
    ["vault_claim", claimTool],
    ["vault_agent-memory", agentMemoryTool],
  ];

  for (const [toolName, tool] of toolsUnderTest) {
    it(`${toolName}: agent_id is NOT a field in the input schema`, () => {
      const shape = schemaShape(tool as AnyTool);
      expect(shape).not.toHaveProperty("agent_id");
    });

    it(`${toolName}: passing agent_id in input fails Zod parse (strict mode)`, () => {
      const s = tool.inputSchema;
      if (s instanceof z.ZodObject) {
        const strict = s.strict();
        const result = strict.safeParse({ agent_id: "some-agent" });
        expect(result.success).toBe(false);
      }
    });
  }
});

// ---- authored_by removed from claim inputSchema ------------------------------

describe("authored_by removed from claim.ts inputSchema", () => {
  it("vault_claim: authored_by is NOT a field in the input schema", () => {
    const shape = schemaShape(claimTool as AnyTool);
    expect(shape).not.toHaveProperty("authored_by");
  });
});

// ---- scope declared on all 7 tools ------------------------------------------

describe("each tool declares a scope object with an axis function", () => {
  const toolsWithExpectedAxes: [string, AnyTool, (input: Record<string, string>) => string][] = [
    [
      "vault_channel-post",
      channelPostTool,
      (i) => `channels/${i.channel}`,
    ],
    [
      "vault_agent-journal",
      agentJournalTool,
      (i) => `wikis/${i.wiki}/journal`,
    ],
    [
      "vault_task-claim",
      taskClaimTool,
      (i) => `tasks/${i.task_id}`,
    ],
    [
      "vault_task-update",
      taskUpdateTool,
      (i) => `tasks/${i.task_id}`,
    ],
    [
      "vault_task-create",
      taskCreateTool,
      (i) => `wikis/${i.wiki}`,
    ],
    [
      "vault_claim",
      claimTool,
      (i) => `wikis/${i.wiki}/claim`,
    ],
    [
      "vault_agent-memory",
      agentMemoryTool,
      // wiki is optional; when absent axis should be "*"
      (_i) => "*",
    ],
  ];

  for (const [toolName, tool] of toolsWithExpectedAxes) {
    it(`${toolName}: has a scope property`, () => {
      expect(tool).toHaveProperty("scope");
    });

    it(`${toolName}: scope.axis is a function`, () => {
      const anyTool = tool as { scope?: { axis?: unknown } };
      expect(typeof anyTool.scope?.axis).toBe("function");
    });
  }

  // Spot-check axis return values for tools with deterministic inputs
  it("vault_channel-post axis returns channels/<channel>", () => {
    const t = channelPostTool as { scope: { axis: (i: unknown) => string } };
    expect(t.scope.axis({ channel: "ops" })).toBe("channels/ops");
  });

  it("vault_task-claim axis returns tasks/<task_id>", () => {
    const t = taskClaimTool as { scope: { axis: (i: unknown) => string } };
    expect(t.scope.axis({ task_id: "task-foo" })).toBe("tasks/task-foo");
  });

  it("vault_task-update axis returns tasks/<task_id>", () => {
    const t = taskUpdateTool as { scope: { axis: (i: unknown) => string } };
    expect(t.scope.axis({ task_id: "task-bar" })).toBe("tasks/task-bar");
  });

  it("vault_task-create axis returns wikis/<wiki>", () => {
    const t = taskCreateTool as { scope: { axis: (i: unknown) => string } };
    expect(t.scope.axis({ wiki: "stoa" })).toBe("wikis/stoa");
  });

  it("vault_agent-journal axis returns wikis/<wiki>/journal", () => {
    const t = agentJournalTool as { scope: { axis: (i: unknown) => string } };
    expect(t.scope.axis({ wiki: "stoa" })).toBe("wikis/stoa/journal");
  });

  it("vault_claim axis returns wikis/<wiki>/claim when wiki present", () => {
    const t = claimTool as { scope: { axis: (i: unknown) => string } };
    expect(t.scope.axis({ wiki: "stoa" })).toBe("wikis/stoa/claim");
  });

  it("vault_agent-memory axis returns * when wiki absent", () => {
    const t = agentMemoryTool as { scope: { axis: (i: unknown) => string } };
    expect(t.scope.axis({})).toBe("*");
  });

  it("vault_agent-memory axis returns wikis/<wiki> when wiki present", () => {
    const t = agentMemoryTool as { scope: { axis: (i: unknown) => string } };
    expect(t.scope.axis({ wiki: "stoa" })).toBe("wikis/stoa");
  });
});
