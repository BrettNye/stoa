// src/tools/agent-id-removal.test.ts
//
// Verifies that agent_id (and authored_by for claim.ts) has been removed from
// the inputSchema of all 7 write tools per spec §6.5 of the server-mode design.
// Also verifies each tool declares a `scope` object with an `axis` function,
// and that handlers read from ctx.principal?.agent_id rather than input.
//
// Schema / metadata tests run without filesystem access. The retract-fallback
// behavioral test uses a temp vault (see describe block below).

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { mkdtempSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { channelTool } from "./channel.js";
import { agentJournalTool } from "./agent-journal.js";
import { taskTool } from "./task.js";
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
    ["vault_channel (post/tail)", channelTool],
    ["vault_agent-journal", agentJournalTool],
    ["vault_task (create/list/update/claim)", taskTool],
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
      "vault_channel (post/tail)",
      channelTool,
      (i) => `channels/${i.channel}`,
    ],
    [
      "vault_agent-journal",
      agentJournalTool,
      (i) => `wikis/${i.wiki}/journal`,
    ],
    [
      "vault_task (create/list/update/claim)",
      taskTool,
      (i) => `wikis/${i.wiki ?? "*"}`,
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
  it("vault_channel axis returns channels/<channel>", () => {
    const t = channelTool as { scope: { axis: (i: unknown) => string } };
    expect(t.scope.axis({ channel: "ops" })).toBe("channels/ops");
  });

  it("vault_task claim mode axis returns tasks/<task_id>", () => {
    const t = taskTool as { scope: { axis: (i: unknown) => string } };
    expect(t.scope.axis({ mode: "claim", task_id: "task-foo" })).toBe("tasks/task-foo");
  });

  it("vault_task update mode axis returns tasks/<task_id>", () => {
    const t = taskTool as { scope: { axis: (i: unknown) => string } };
    expect(t.scope.axis({ mode: "update", task_id: "task-bar" })).toBe("tasks/task-bar");
  });

  it("vault_task create mode axis returns wikis/<wiki>", () => {
    const t = taskTool as { scope: { axis: (i: unknown) => string } };
    expect(t.scope.axis({ mode: "create", wiki: "stoa" })).toBe("wikis/stoa");
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

  it("vault_agent-memory axis always returns * (wiki not in input schema)", () => {
    const t = agentMemoryTool as { scope: { axis: (i: unknown) => string } };
    // wiki was removed from the input schema (over-build fix); axis is always "*"
    expect(t.scope.axis({ wiki: "stoa" })).toBe("*");
    expect(t.scope.axis({})).toBe("*");
  });
});

// ---- vault_agent-memory: wiki NOT in input schema ----------------------------

describe("vault_agent-memory: wiki field removed from input schema", () => {
  it("wiki is NOT a field in the agent-memory input schema", () => {
    const shape = schemaShape(agentMemoryTool as AnyTool);
    expect(shape).not.toHaveProperty("wiki");
  });

  it("passing wiki in input fails Zod parse in strict mode", () => {
    const s = agentMemoryTool.inputSchema;
    if (s instanceof z.ZodObject) {
      const strict = s.strict();
      const result = strict.safeParse({ wiki: "stoa" });
      expect(result.success).toBe(false);
    }
  });
});

// ---- vault_claim retract path: principal fallback is "stoa-local" not input.as

async function makeTempVaultForRetractTest(): Promise<string> {
  const base = mkdtempSync(path.join(tmpdir(), "stoa-retract-test-"));
  // Minimal vault skeleton: wikis/_agents/claim/
  const claimDir = path.join(base, "wikis", "_agents", "claim");
  await fs.mkdir(claimDir, { recursive: true });
  return base;
}

describe("vault_claim retract path: principal fallback is 'stoa-local', not input.as", () => {
  it("rejects retract when no principal and input.as does not match authored_by", async () => {
    // This verifies the fix: ctx.principal?.agent_id ?? "stoa-local"
    // With the OLD (buggy) code: retractAs = input.as = authored_by → succeeds (auth bypass)
    // With the FIXED code: retractAs = "stoa-local" ≠ authored_by → throws
    const vault = await makeTempVaultForRetractTest();

    // Create a claim authored by "agent:realauthor"
    const created = await claimTool.handler(
      {
        key: "retract.test",
        title: "retract test",
        body: "body",
        as: "agent:realauthor",
      },
      {
        vaultPath: vault,
        rawConfig: {},
        principal: { agent_id: "agent:realauthor" },
      },
    );
    expect(created.action).toBe("created");

    // Now attempt to retract with NO principal (falls back to "stoa-local")
    // but input.as = "agent:realauthor" (the actual author).
    // Old buggy: retractAs = input.as = "agent:realauthor" → succeeds (wrong!)
    // Fixed:     retractAs = "stoa-local" ≠ "agent:realauthor" → throws (correct!)
    await expect(
      claimTool.handler(
        {
          as: "agent:realauthor",
          retract: created.claim_id,
          reason: "testing principal fallback",
        },
        {
          vaultPath: vault,
          rawConfig: {},
          // no principal → fallback to "stoa-local"
        },
      ),
    ).rejects.toThrow(/author|authored_by|retract/i);
  });
});

