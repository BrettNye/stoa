import { z } from "zod";
import { handleWait, type HandleWaitContext } from "../core/eventbus/handle-wait.js";
import { allBehavior } from "../core/eventbus/kinds/index.js";
import { Cursor } from "../core/eventbus/types.js";

const FilterSchema = z.object({
  source: z.string(),
  wiki: z.string().optional(),
  channel: z.string().optional(),
  id: z.string().optional(),
});

const Input = z.object({
  filters: z.array(FilterSchema).min(1).max(32),
  since: z.string().optional(),
  timeout_ms: z.number().int().positive().max(120_000).default(25_000),
});

export const waitForAllTool = {
  name: "vault_wait-for-all",
  description: "Wait for events matching all of `filters` (fan-in). Returns once every filter has been satisfied or `timeout_ms` (default 25000) elapses — call again with the returned `cursor` to continue waiting. When `since:` is omitted, defaults to the time the call enters the subscribe step (i.e., only fresh events count). Pass an explicit `since:` to include historical events.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: HandleWaitContext) => {
    const since = input.since ? Cursor.fromIso(input.since) : undefined;
    return handleWait(allBehavior, input.filters, since, input.timeout_ms, ctx);
  },
};
