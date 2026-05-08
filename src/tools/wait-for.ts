import { z } from "zod";
import { handleWait, type HandleWaitContext } from "../core/eventbus/handle-wait.js";
import { singleBehavior } from "../core/eventbus/kinds/index.js";
import { Cursor } from "../core/eventbus/types.js";

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

export const waitForTool = {
  name: "vault.wait-for",
  description: "Wait for the next event matching `filter` (or return immediately if `since` cursor reveals one). Returns within `timeout_ms` (default 25000) — call again with the returned `cursor` to wait longer.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: HandleWaitContext) => {
    const since = input.since ? Cursor.fromIso(input.since) : undefined;
    return handleWait(singleBehavior, [input.filter], since, input.timeout_ms, ctx);
  },
};
