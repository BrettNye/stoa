import { z } from "zod";
import { handleWait, type HandleWaitContext } from "../core/eventbus/handle-wait.js";
import { singleBehavior } from "../core/eventbus/kinds/index.js";
import { Cursor } from "../core/eventbus/types.js";
import type { ToolScope } from "../auth/types.js";

const FilterSchema = z.object({
  source: z.string(),
  wiki: z.string().optional(),
  channel: z.string().optional(),
  id: z.string().optional(),
});

const Input = z.object({
  filter: FilterSchema,
  since: z.string().optional(),
  timeout_ms: z.number().int().positive().max(120_000).default(25_000),
});

const scope: ToolScope = {
  axis: (input: unknown) => {
    if (input == null || typeof input !== "object") return "*";
    const inp = input as Record<string, unknown>;
    const filter = inp["filter"];
    if (filter == null || typeof filter !== "object") return "*";
    const f = filter as Record<string, unknown>;
    return (typeof f["channel"] === "string" ? f["channel"] : undefined)
      ?? (typeof f["source"] === "string" ? f["source"] : undefined)
      ?? "*";
  },
};

export const waitForTool = {
  name: "vault_wait-for",
  description: "Wait for the next event matching `filter` (or return immediately if `since` cursor reveals one). Returns within `timeout_ms` (default 25000) — call again with the returned `cursor` to wait longer. When `since:` is omitted, defaults to the time the call enters the subscribe step (i.e., only fresh events count). Pass an explicit `since:` to include historical events.",
  inputSchema: Input,
  scope,
  handler: async (input: z.infer<typeof Input>, ctx: HandleWaitContext) => {
    const since = input.since ? Cursor.fromIso(input.since) : undefined;
    return handleWait(singleBehavior, [input.filter], since, input.timeout_ms, ctx);
  },
};
