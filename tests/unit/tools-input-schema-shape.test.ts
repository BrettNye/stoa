// Regression test for the MCP tools/list contract: every tool's inputSchema,
// after zodToJsonSchema, MUST have top-level `type: "object"`. MCP clients
// reject `tools/list` responses where a tool's inputSchema is an `anyOf` /
// `oneOf` with no top-level type — which is exactly what `z.union(...)`
// produces. Use `z.object(...).refine(...)` (flat with refines) instead.
//
// Background: a regression here breaks tool registration on reconnect across
// every consumer of the vault MCP server. The handler-level and CLI-level
// tests don't catch it because they bypass the stdio transport.

import { describe, it, expect } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import { allTools } from "../../src/tools/index.js";

describe("MCP inputSchema shape", () => {
  for (const tool of allTools) {
    it(`${tool.name} serializes to top-level type: "object"`, () => {
      const json = zodToJsonSchema(tool.inputSchema as any) as any;
      expect(json.type, `${tool.name} inputSchema must be a JSON Schema object`).toBe("object");
    });
  }
});
