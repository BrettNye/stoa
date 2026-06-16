import { z } from "zod";
import { handleWait, type HandleWaitContext } from "../core/eventbus/handle-wait.js";
import {
  singleBehavior,
  anyBehavior,
  allBehavior,
  makeManyBehavior,
} from "../core/eventbus/kinds/index.js";
import { Cursor } from "../core/eventbus/types.js";
import type { ToolScope } from "../auth/types.js";
import { requireField } from "./_mode.js";

const Filter = z.object({
  source: z.string(),
  wiki: z.string().optional(),
  channel: z.string().optional(),
  id: z.string().optional(),
});

const Input = z.object({
  mode: z.enum(["next", "any", "all", "many"]),
  filter: Filter.optional(),                            // next, many
  filters: z.array(Filter).min(1).max(32).optional(),  // any, all
  max: z.number().int().positive().max(1000).optional(), // many
  since: z.string().optional(),
  timeout_ms: z.number().int().positive().max(120_000).default(25_000),
});

const scope: ToolScope = {
  axis: (input: unknown) => {
    if (input == null || typeof input !== "object") return "*";
    const inp = input as Record<string, unknown>;

    // For modes that use a single filter (next, many)
    const filter = inp["filter"];
    if (filter != null && typeof filter === "object") {
      const f = filter as Record<string, unknown>;
      return (typeof f["channel"] === "string" ? f["channel"] : undefined)
        ?? (typeof f["source"] === "string" ? f["source"] : undefined)
        ?? "*";
    }

    // For modes that use filters array (any, all) — use first element
    const filters = inp["filters"];
    if (Array.isArray(filters) && filters.length > 0) {
      const first = filters[0];
      if (first != null && typeof first === "object") {
        const f = first as Record<string, unknown>;
        return (typeof f["channel"] === "string" ? f["channel"] : undefined)
          ?? (typeof f["source"] === "string" ? f["source"] : undefined)
          ?? "*";
      }
    }

    return "*";
  },
};

export const waitForTool = {
  name: "vault_wait-for",
  description:
    "Wait for events. mode: next (single filter) | any (first of filters[]) | all (fan-in) | many (bounded batch of `max`). " +
    "Returns within `timeout_ms` (default 25000) — call again with the returned `cursor` to wait longer. " +
    "When `since:` is omitted, defaults to the time the call enters the subscribe step (i.e., only fresh events count). " +
    "Pass an explicit `since:` to include historical events.",
  inputSchema: Input,
  scope,
  handler: async (input: z.infer<typeof Input>, ctx: HandleWaitContext) => {
    const since = input.since ? Cursor.fromIso(input.since) : undefined;
    const ctx2 = `vault_wait-for mode=${input.mode}`;
    switch (input.mode) {
      case "next":
        return handleWait(
          singleBehavior,
          [requireField(input.filter, ctx2, "filter")],
          since,
          input.timeout_ms,
          ctx,
        );
      case "any":
        return handleWait(
          anyBehavior,
          requireField(input.filters, ctx2, "filters"),
          since,
          input.timeout_ms,
          ctx,
        );
      case "all":
        return handleWait(
          allBehavior,
          requireField(input.filters, ctx2, "filters"),
          since,
          input.timeout_ms,
          ctx,
        );
      case "many":
        return handleWait(
          makeManyBehavior(requireField(input.max, ctx2, "max")),
          [requireField(input.filter, ctx2, "filter")],
          since,
          input.timeout_ms,
          ctx,
        );
    }
  },
};
