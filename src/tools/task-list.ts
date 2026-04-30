import { z } from "zod";
import { listTasks } from "../core/tasks.js";
import { expandAliases } from "../core/aliases.js";

const Input = z.object({
  wiki: z.string().optional(),
  status: z.enum(["pending", "claimed", "in_progress", "completed", "failed", "blocked"]).optional(),
  claimed_by: z.string().optional(),
  channel: z.string().optional(),
  pokemon_type: z.string().optional(),
  limit: z.number().int().positive().default(50)
});

/**
 * Given a `claimed_by` query string (typically `agent:<bare-id>`), expand it
 * through the alias index so a query for the CURRENT id surfaces tasks claimed
 * under any HISTORICAL id of the same agent. Mirrors the recall-by-agent
 * convention in `core/recall.ts`.
 */
function expandClaimedBy(vaultPath: string, claimedBy: string): Set<string> {
  const bare = claimedBy.startsWith("agent:")
    ? claimedBy.slice("agent:".length)
    : claimedBy;
  const profileId = bare.startsWith("profile-") ? bare : `profile-${bare}`;
  const expandedProfileIds = expandAliases(vaultPath, profileId);
  const out = new Set<string>();
  // Always include the original input so a bare id query (no alias entry)
  // still matches.
  out.add(claimedBy);
  for (const pid of expandedProfileIds) {
    const pBare = pid.startsWith("profile-") ? pid.slice("profile-".length) : pid;
    out.add(`agent:${pBare}`);
  }
  return out;
}

export const taskListTool = {
  name: "vault.task-list",
  description: "List tasks across the vault, with optional filters.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    if (!input.claimed_by) {
      return { tasks: listTasks(ctx.vaultPath, input) };
    }
    // Alias-aware claimed_by: expand to the full historical set, then post-filter
    // (drop claimed_by from the inner call so listTasks does not exact-match).
    const expanded = expandClaimedBy(ctx.vaultPath, input.claimed_by);
    const { claimed_by, limit, ...rest } = input;
    // Pull the unfiltered set without a limit, then trim after alias filtering
    // so the limit applies to the post-filter result.
    const all = listTasks(ctx.vaultPath, { ...rest, limit: Number.MAX_SAFE_INTEGER });
    const filtered = all.filter(t => t.claimed_by !== undefined && expanded.has(t.claimed_by));
    return { tasks: filtered.slice(0, limit) };
  }
};
