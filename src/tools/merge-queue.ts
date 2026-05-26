// vault-mcp/src/tools/merge-queue.ts
//
// Phase-3 T3-1 — `vault_merge-queue` MCP tool: surface the bulk merge queue
// for a coordination channel. Pure logic (ready-signal parsing, task→PR
// mapping, topo sort) lives in `core/merge-queue.ts` (Wave 1 T1-1); this
// layer does the IO + family resolution wiring:
//
//   1. Resolve `wiki` / `family` per spec §7.1 (`core/family.resolveFamily`).
//   2. Tail the named channel from `since` (default: 7 days ago) via
//      `core/channel.tailChannel`. For family scope, tail each member and
//      concatenate. The channel-tail helper already alias-resolves authors,
//      so the `author` we pass to `parseReadySignals` is current-id-aware.
//   3. List tasks scoped to the same wiki/family via `core/tasks.listTasks`,
//      then convert `TaskSummary[]` → `TaskRef[]` (the shape `buildMergeQueue`
//      expects). The new optional `branch_suffix` field on `TaskSummary` (also
//      Phase-3 T3-1) makes this conversion lossless.
//   4. Call `buildMergeQueue(channelEntries, tasks, channel)` and return its
//      output verbatim.
//
// Pure read — no state mutation, no file writes. `ci_status` is always
// `"unknown"` (vault-mcp does not shell out to `gh`); `core/merge-queue` already
// hardcodes that, this layer just preserves it.
//
// Flat zod schema. `z.discriminatedUnion` is incompatible with the MCP SDK
// per the carry-forward gotcha documented on `rewrite-links.ts`.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { tailChannel, type TailEntry } from "../core/channel.js";
import { listTasks, type TaskSummary } from "../core/tasks.js";
import { loadIndex } from "../core/index.js";
import { resolveFamily, membersOf } from "../core/family.js";
import { findOnDisk } from "../core/disk-fallback.js";
import { resolveCurrent } from "../core/aliases.js";
import {
  buildMergeQueue,
  type MergeQueueOutput,
  type TaskRef,
} from "../core/merge-queue.js";
import type { ToolScope } from "../auth/types.js";

const Input = z.object({
  channel: z.string(),
  wiki: z.string().optional(),
  family: z.string().optional(),
  since: z.string().datetime().optional(),
});

/** 7-days-ago ISO timestamp, used when `since` is unset. */
function defaultSince(): string {
  return new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
}

/**
 * Pulls every channel entry visible across `wikis` (or all wikis when undefined)
 * since `since`. We invoke `tailChannel` per-wiki because its `wiki:` filter is
 * single-valued — calling it once per family member and concatenating gives us
 * the family-scoped tail without duplicating its alias-overlay logic here.
 *
 * `limit` is set to `MAX_SAFE_INTEGER` per call: the merge queue wants every
 * `ready:` signal in the window, not just the last 50.
 */
function tailAcross(
  vaultPath: string,
  channel: string,
  since: string,
  wikis: string[] | undefined
): TailEntry[] {
  if (wikis === undefined) {
    // Single-vault default: one tail, no wiki filter (matches everything).
    return tailChannel(vaultPath, {
      channel,
      since,
      limit: Number.MAX_SAFE_INTEGER,
    }).entries;
  }
  const out: TailEntry[] = [];
  for (const wiki of wikis) {
    const r = tailChannel(vaultPath, {
      channel,
      since,
      wiki,
      limit: Number.MAX_SAFE_INTEGER,
    });
    out.push(...r.entries);
  }
  return out;
}

/**
 * Convert `TailEntry[]` (from channel-tail) → the shape `parseReadySignals`
 * expects. `current_alias` (when present) is the alias-resolved current agent
 * id — preferred over the historical `author` so a journal posted under
 * `charmander` surfaces as `charmeleon` after rename. Mirrors the spec §7.5
 * alias-overlay convention.
 */
function toChannelEntries(
  entries: TailEntry[]
): Array<{ journal_id: string; body: string; posted_at: string; author: string }> {
  return entries.map(e => ({
    journal_id: e.id,
    body: e.body,
    posted_at: e.created,
    author: e.current_alias ? `agent:${e.current_alias}` : e.author,
  }));
}

/**
 * v1.7 §5.4 — disk-fallback for ready-signal journal entries. Scans
 * `wikis/<wiki>/journal/*.md` for journal pages on the named channel that
 * post-date `since`, dedupes against the index-based `tailEntries` set, and
 * returns the surplus entries with the same alias-overlay treatment
 * `tailChannel` applies. Index-first semantics preserved — this only fires
 * when the index has a stale view of recent journal writes.
 */
function findOnDiskJournals(
  vaultPath: string,
  channel: string,
  since: string,
  wikis: string[] | undefined,
  alreadySeen: Set<string>
): TailEntry[] {
  const wikisDir = join(vaultPath, "wikis");
  if (!existsSync(wikisDir)) return [];
  const candidateWikis = wikis ?? readdirSync(wikisDir);
  const out: TailEntry[] = [];
  for (const wiki of candidateWikis) {
    const journalDir = join(wikisDir, wiki, "journal");
    if (!existsSync(journalDir)) continue;
    for (const file of readdirSync(journalDir)) {
      if (!file.endsWith(".md")) continue;
      const id = file.replace(/\.md$/, "");
      if (alreadySeen.has(id)) continue;
      // Verify via findOnDisk (defensive id-mismatch guard).
      const verified = findOnDisk(vaultPath, id);
      if (!verified) continue;
      if (verified.type !== "journal") continue;
      const fm = verified.frontmatter;
      if (String(fm.channel ?? "") !== channel) continue;
      const created = String(fm.created ?? "");
      if (created < since) continue;

      const author = String(fm.author ?? "unknown");
      let current_alias: string | undefined;
      if (author.startsWith("agent:")) {
        const bare = author.slice("agent:".length);
        const profileId = `profile-${bare}`;
        const current = resolveCurrent(vaultPath, profileId);
        if (current !== profileId) {
          current_alias = current.startsWith("profile-")
            ? current.slice("profile-".length)
            : current;
        }
      }

      // Re-parse the body from the verified file path — findOnDisk already
      // gave us body, so just use it.
      const entry: TailEntry = {
        id: String(fm.id ?? id),
        wiki: verified.wiki,
        author,
        created,
        body: verified.body
      };
      if (current_alias) entry.current_alias = current_alias;
      if (fm.session_id) entry.session_id = String(fm.session_id);
      out.push(entry);
    }
  }
  return out;
}

/**
 * Convert `TaskSummary[]` (from task-list) → `TaskRef[]` (what `buildMergeQueue`
 * consumes). `claimed_by` is left optional: the unready_prs path tolerates an
 * empty string when the task is unclaimed.
 */
function toTaskRefs(tasks: TaskSummary[]): TaskRef[] {
  return tasks.map(t => {
    const ref: TaskRef = {
      id: t.id,
      channel: t.channel ?? "",
      blocking: t.blocking ?? [],
      status: t.status,
    };
    if (t.branch_suffix !== undefined) ref.branch_suffix = t.branch_suffix;
    if (t.claimed_by !== undefined) ref.claimed_by = t.claimed_by;
    return ref;
  });
}

const mergeQueueScope: ToolScope = {
  axis: (input: any) => (input as any).wiki ? `wikis/${(input as any).wiki}` : "wikis/*",
};

export const mergeQueueTool = {
  name: "vault_merge-queue",
  description:
    "Surface the bulk merge queue for a coordination channel: ready PRs (parsed from `ready: branch=...` journal signals), unready tasks, and a topo-sorted dependency order keyed by task.blocking. Pure read; ci_status is always 'unknown'.",
  inputSchema: Input,
  scope: mergeQueueScope,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string; defaultFamily?: string }
  ): Promise<MergeQueueOutput> => {
    const since = input.since ?? defaultSince();

    // Family resolution: explicit `wiki:` always wins. If `wiki:` is unset and
    // `family:` resolves (explicit / ctx.defaultFamily / .active-family), expand
    // scope to all members. Both unset → undefined wikis array (all-wikis tail
    // + all-wikis listTasks). Mirrors `tools/recall.ts`.
    let wikis: string[] | undefined;
    if (!input.wiki) {
      const idx = loadIndex(ctx.vaultPath);
      const knownWikis: Record<string, { family?: string | null }> = {};
      for (const w of idx.wikis) {
        knownWikis[w.name] = { family: w.family ?? null };
      }
      const resolvedFamily = resolveFamily(
        { vaultPath: ctx.vaultPath, defaultFamily: ctx.defaultFamily ?? undefined },
        input.family,
        input.wiki,
        knownWikis
      );
      if (resolvedFamily !== null) {
        wikis = membersOf(resolvedFamily, knownWikis);
      }
    } else {
      // Explicit single-wiki — scope tail + tasks to it.
      wikis = [input.wiki];
    }

    const tail = tailAcross(ctx.vaultPath, input.channel, since, wikis);

    // v1.7 §5.4 — append on-disk journal entries for the channel that the
    // index hasn't caught up to yet. Index-first preserved: this scan runs
    // after the fast-path tail and only adds entries the tail didn't return.
    const seenIds = new Set(tail.map(e => e.id));
    const diskOnly = findOnDiskJournals(
      ctx.vaultPath,
      input.channel,
      since,
      wikis,
      seenIds
    );
    const allEntries = [...tail, ...diskOnly];
    const channelEntries = toChannelEntries(allEntries);

    // Task scope mirrors the channel scope: explicit wiki → that wiki, family
    // → each member, neither → all wikis (listTasks with `wiki: undefined`).
    let tasks: TaskSummary[];
    if (wikis === undefined) {
      tasks = listTasks(ctx.vaultPath, { limit: Number.MAX_SAFE_INTEGER });
    } else {
      tasks = [];
      for (const wiki of wikis) {
        tasks.push(...listTasks(ctx.vaultPath, { wiki, limit: Number.MAX_SAFE_INTEGER }));
      }
    }
    const taskRefs = toTaskRefs(tasks);

    return buildMergeQueue(channelEntries, taskRefs, input.channel);
  },
};
