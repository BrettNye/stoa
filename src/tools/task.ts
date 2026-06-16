import { z } from "zod";
import type { ToolScope } from "../auth/types.js";
import { createTask, listTasks, updateTask, claimTask, TaskNotReadyError } from "../core/tasks.js";
import { upsertPage } from "../core/index.js";
import { pathForPage } from "../core/pages.js";
import { expandAliases } from "../core/aliases.js";
import { resolveWiki } from "./_resolve-wiki.js";
import { requireField } from "./_mode.js";

const Input = z.object({
  mode: z.enum(["create", "list", "update", "claim"]),
  // create
  title: z.string().optional(),
  description: z.string().optional(),
  segregation: z.array(z.string()).optional(),
  blocking: z.array(z.string()).optional(),
  channel: z.string().optional(),
  required_pokemon_type: z.string().optional(),
  estimate_minutes: z.number().int().nonnegative().optional(),
  // list
  status: z.enum(["pending", "claimed", "in_progress", "completed", "failed", "blocked"]).optional(),
  claimed_by: z.string().optional(),
  pokemon_type: z.string().optional(),
  limit: z.number().int().positive().default(50),
  // update / claim
  task_id: z.string().optional(),
  expected_updated: z.string().optional(),
  notes: z.string().optional(),
  force: z.boolean().optional(),
  wiki: z.string().optional(),
});

type Input = z.infer<typeof Input>;

/**
 * Given a `claimed_by` query string (typically `agent:<bare-id>`), expand it
 * through the alias index so a query for the CURRENT id surfaces tasks claimed
 * under any HISTORICAL id of the same agent.
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

const scope: ToolScope = {
  axis: (input: any) =>
    (input?.mode === "update" || input?.mode === "claim")
      ? `tasks/${input?.task_id ?? "*"}`
      : `wikis/${input?.wiki ?? "*"}`,
};

export const taskTool = {
  name: "vault_task",
  description:
    "Task queue ops. mode: create | list | update | claim. update/claim use mtime OCC; agent_id is server-stamped.",
  inputSchema: Input,
  scope,
  handler: async (
    input: Input,
    ctx: { vaultPath: string; defaultWiki?: string; principal?: { agent_id: string } },
  ) => {
    switch (input.mode) {
      case "create": {
        const title = requireField(input.title, "vault_task mode=create", "title");
        const wiki = requireField(input.wiki, "vault_task mode=create", "wiki");
        const result = createTask(ctx.vaultPath, {
          title,
          wiki,
          description: input.description,
          segregation: input.segregation,
          blocking: input.blocking,
          channel: input.channel,
          required_pokemon_type: input.required_pokemon_type,
          estimate_minutes: input.estimate_minutes,
        });
        await upsertPage(ctx.vaultPath, result.path);
        return result;
      }

      case "list": {
        if (!input.claimed_by) {
          return { tasks: listTasks(ctx.vaultPath, {
            wiki: input.wiki,
            status: input.status,
            claimed_by: input.claimed_by,
            channel: input.channel,
            pokemon_type: input.pokemon_type,
            limit: input.limit,
          }) };
        }
        // Alias-aware claimed_by: expand to the full historical set, then post-filter
        const expanded = expandClaimedBy(ctx.vaultPath, input.claimed_by);
        const { limit } = input;
        const all = listTasks(ctx.vaultPath, {
          wiki: input.wiki,
          status: input.status,
          channel: input.channel,
          pokemon_type: input.pokemon_type,
          limit: Number.MAX_SAFE_INTEGER,
        });
        const filtered = all.filter(
          t => t.claimed_by !== undefined && expanded.has(t.claimed_by)
        );
        return { tasks: filtered.slice(0, limit) };
      }

      case "update": {
        const task_id = requireField(input.task_id, "vault_task mode=update", "task_id");
        const wiki = requireField(input.wiki, "vault_task mode=update", "wiki");
        const expected_updated = requireField(input.expected_updated, "vault_task mode=update", "expected_updated");
        const agent_id = ctx.principal?.agent_id ?? "stoa-local";
        const result = updateTask(ctx.vaultPath, {
          task_id,
          wiki,
          expected_updated,
          status: input.status,
          notes: input.notes,
          segregation: input.segregation,
          agent_id,
        });
        const path = pathForPage(ctx.vaultPath, task_id, "task", wiki);
        await upsertPage(ctx.vaultPath, path);
        return result;
      }

      case "claim": {
        const task_id = requireField(input.task_id, "vault_task mode=claim", "task_id");
        const expected_updated = requireField(input.expected_updated, "vault_task mode=claim", "expected_updated");
        const wiki = resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);
        const agent_id = ctx.principal?.agent_id ?? "stoa-local";
        try {
          return await claimTask(ctx.vaultPath, {
            task_id,
            agent_id,
            expected_updated,
            wiki,
            force: input.force,
          });
        } catch (e) {
          if (e instanceof TaskNotReadyError) {
            throw Object.assign(new Error(e.message), {
              code: "TASK_NOT_READY",
              missing: e.missing,
              task_id: e.taskId,
            });
          }
          throw e;
        }
      }

      default: {
        const _exhaustive: never = input.mode;
        throw new Error(`Unknown mode: ${_exhaustive}`);
      }
    }
  },
};
