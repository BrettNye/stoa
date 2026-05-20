import { z } from "zod";
import { handleWait, type HandleWaitContext } from "../core/eventbus/handle-wait.js";
import { makeManyBehavior } from "../core/eventbus/kinds/index.js";
import { Cursor } from "../core/eventbus/types.js";

const FilterSchema = z.object({
  source: z.string(),
  wiki: z.string().optional(),
  channel: z.string().optional(),
  id: z.string().optional(),
});

const Input = z.object({
  filter: FilterSchema,
  max: z.number().int().positive().max(1000),
  since: z.string().optional(),
  timeout_ms: z.number().int().positive().max(120_000).default(25_000),
});

export const waitForManyTool = {
  name: "vault_wait-for-many",
  description: "Collect up to `max` events matching `filter` (bounded batch). Returns once `max` events are collected or `timeout_ms` (default 25000) elapses — call again with the returned `cursor` to continue. When `since:` is omitted, defaults to the time the call enters the subscribe step (i.e., only fresh events count). Pass an explicit `since:` to include historical events.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: HandleWaitContext) => {
    const since = input.since ? Cursor.fromIso(input.since) : undefined;
    return handleWait(makeManyBehavior(input.max), [input.filter], since, input.timeout_ms, ctx);
  },
};
