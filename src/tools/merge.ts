// vault-mcp/src/tools/merge.ts
//
// Consolidated `vault_merge` tool (Phase refactor task-merge).
//
// Replaces `vault_merge-queue` (pure read) and `vault_merge-record` (write)
// with a single tool gated on `mode`:
//
//   mode: "queue"  — surface the merge queue for a coordination channel.
//                    Pure read; logic lives in core/merge-queue.ts.
//   mode: "record" — journal a merge outcome + conditional task transition.
//                    Writes; logic lives in core/merge-record.ts.
//
// Core modules (core/merge-queue.ts, core/merge-record.ts) are UNCHANGED.
// This layer is the same IO wiring that used to live in the two separate tool
// files, unified behind the `mode` discriminant.
//
// Test seam: `__setNowFnForTests` is re-exported from this module so that
// tests (and channel-write-through.test.ts) can import it from
// `../../src/tools/merge.js` without touching the core module directly.

import { existsSync, readdirSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { z } from "zod";
import { tailChannel, type TailEntry } from "../core/channel.js";
import { listTasks, type TaskSummary, updateTask, findTaskOnDisk } from "../core/tasks.js";
import { loadIndex } from "../core/index.js";
import { resolveFamily, membersOf } from "../core/family.js";
import { findOnDisk } from "../core/disk-fallback.js";
import { resolveCurrent } from "../core/aliases.js";
import {
  buildMergeQueue,
  type MergeQueueOutput,
  type TaskRef,
} from "../core/merge-queue.js";
import { serializeFrontmatter } from "../core/frontmatter.js";
import { upsertPage } from "../core/index.js";
import { readProfile, ProfileNotFoundError } from "../core/profiles.js";
import {
  composeMergeJournal,
  computeTaskTransition,
  UnknownAgentError,
  type MergeRecordInput,
  type MergeStatus,
} from "../core/merge-record.js";
import { requireField } from "./_mode.js";
import type { ToolScope } from "../auth/types.js";

// ---------------------------------------------------------------------------
// Re-export test seam from merge-record logic
// (channel-write-through.test.ts imports this from merge.js)
// ---------------------------------------------------------------------------

let nowFn: (() => string) | undefined;

export function __setNowFnForTests(fn: (() => string) | undefined): void {
  nowFn = fn;
}

// ---------------------------------------------------------------------------
// Shared input schema
// ---------------------------------------------------------------------------

const Input = z.object({
  mode: z.enum(["queue", "record"]),
  channel: z.string(),
  // queue-specific
  wiki: z.string().optional(),
  family: z.string().optional(),
  since: z.string().optional(),
  // record-specific
  pr_number: z.number().int().optional(),
  agent_id: z.string().optional(),
  status: z
    .enum(["merged", "failed", "halted-conflict", "halted-red-ci"])
    .optional(),
  merge_commit_sha: z.string().optional(),
  notes: z.string().optional(),
  task_id: z.string().optional(),
});

export type MergeInput = z.infer<typeof Input>;

// ---------------------------------------------------------------------------
// Re-used result type (same as former merge-record.ts)
// ---------------------------------------------------------------------------

export interface MergeRecordResult {
  journal_id: string;
  recorded_at: string;
  task_updated: boolean;
}

// ---------------------------------------------------------------------------
// ---- merge-queue logic (formerly src/tools/merge-queue.ts) ----------------
// ---------------------------------------------------------------------------

/** 7-days-ago ISO timestamp, used when `since` is unset. */
function defaultSince(): string {
  return new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
}

/**
 * Pulls every channel entry visible across `wikis` (or all wikis when
 * undefined) since `since`. Invokes `tailChannel` per-wiki so the alias-
 * overlay logic in tailChannel is reused without duplication.
 */
function tailAcross(
  vaultPath: string,
  channel: string,
  since: string,
  wikis: string[] | undefined
): TailEntry[] {
  if (wikis === undefined) {
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
 * Convert `TailEntry[]` → the shape `parseReadySignals` expects, applying
 * the alias-overlay convention from spec §7.5.
 */
function toChannelEntries(
  entries: TailEntry[]
): Array<{ journal_id: string; body: string; posted_at: string; author: string }> {
  return entries.map((e) => ({
    journal_id: e.id,
    body: e.body,
    posted_at: e.created,
    author: e.current_alias ? `agent:${e.current_alias}` : e.author,
  }));
}

/**
 * v1.7 §5.4 — disk-fallback for ready-signal journal entries that the index
 * hasn't seen yet.
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

      const entry: TailEntry = {
        id: String(fm.id ?? id),
        wiki: verified.wiki,
        author,
        created,
        body: verified.body,
      };
      if (current_alias) entry.current_alias = current_alias;
      if (fm.session_id) entry.session_id = String(fm.session_id);
      out.push(entry);
    }
  }
  return out;
}

/** Convert `TaskSummary[]` → `TaskRef[]` for `buildMergeQueue`. */
function toTaskRefs(tasks: TaskSummary[]): TaskRef[] {
  return tasks.map((t) => {
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

async function runMergeQueue(
  input: MergeInput,
  ctx: { vaultPath: string; defaultFamily?: string }
): Promise<MergeQueueOutput> {
  const since = input.since ?? defaultSince();

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
    wikis = [input.wiki];
  }

  const tail = tailAcross(ctx.vaultPath, input.channel, since, wikis);

  const seenIds = new Set(tail.map((e) => e.id));
  const diskOnly = findOnDiskJournals(
    ctx.vaultPath,
    input.channel,
    since,
    wikis,
    seenIds
  );
  const allEntries = [...tail, ...diskOnly];
  const channelEntries = toChannelEntries(allEntries);

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
}

// ---------------------------------------------------------------------------
// ---- merge-record logic (formerly src/tools/merge-record.ts) --------------
// ---------------------------------------------------------------------------

/**
 * Normalize caller-supplied agent_id to a bare name.
 *   "charmander"         → "charmander"
 *   "agent:charmander"   → "charmander"
 *   "profile-charmander" → "charmander"
 */
function bareAgentId(input: string): string {
  let s = input;
  if (s.startsWith("agent:")) s = s.slice("agent:".length);
  if (s.startsWith("profile-")) s = s.slice("profile-".length);
  return s;
}

/**
 * Resolve the input `agent_id` to its current canonical `agent:<bare>` form
 * via `core/profiles.readProfile`. Throws `UnknownAgentError` when no profile
 * or alias entry resolves.
 */
function resolveAgentId(vaultPath: string, raw: string): string {
  const bare = bareAgentId(raw);
  try {
    const profile = readProfile(vaultPath, `profile-${bare}`);
    const id = String(profile.frontmatter.id ?? `profile-${bare}`);
    const currentBare = id.startsWith("profile-")
      ? id.slice("profile-".length)
      : id;
    return `agent:${currentBare}`;
  } catch (e) {
    if (e instanceof ProfileNotFoundError) {
      throw new UnknownAgentError(raw);
    }
    throw e;
  }
}

/**
 * Best-effort lookup of the ready-signal journal that announced this PR on
 * the same channel.
 */
function findReadySignal(
  vaultPath: string,
  channel: string,
  prNumber: number
): { journalId?: string; branch?: string } {
  try {
    const idx = loadIndex(vaultPath);
    const candidates = idx.pages.filter(
      (p) => p.type === "journal" && p.channel === channel
    );
    const sorted = [...candidates].sort((a, b) =>
      b.created.localeCompare(a.created)
    );
    for (const p of sorted) {
      try {
        const raw = readFileSync(join(vaultPath, p.path), "utf8");
        const re = new RegExp(`\\bPR-${prNumber}\\b`);
        if (!re.test(raw)) continue;
        const branchMatch = /ready:\s*branch=(\S+)/.exec(raw);
        return {
          journalId: p.id,
          branch: branchMatch ? branchMatch[1] : undefined,
        };
      } catch {
        continue;
      }
    }
  } catch {
    // index missing or malformed → no enrichment
  }
  return {};
}

/**
 * Look up a task by id across all wikis. Returns wiki + updated + status
 * for the OCC path, or null when not found.
 *
 * Two-phase: index fast path → disk-scan fallback.
 */
function findTask(
  vaultPath: string,
  taskId: string
): { wiki: string; updated: string; status: string } | null {
  const idx = loadIndex(vaultPath);
  const hit = idx.pages.find((p) => p.id === taskId && p.type === "task");
  if (hit) {
    return {
      wiki: hit.wiki,
      updated: hit.updated,
      status: String((hit as any).status ?? ""),
    };
  }
  return findTaskOnDisk(vaultPath, taskId);
}

async function runMergeRecord(
  input: MergeInput,
  ctx: { vaultPath: string }
): Promise<MergeRecordResult> {
  const prNumber = requireField(input.pr_number, "vault_merge mode=record", "pr_number");
  const agentId = requireField(input.agent_id, "vault_merge mode=record", "agent_id");
  const status = requireField(input.status, "vault_merge mode=record", "status");

  const now = nowFn ? nowFn() : new Date().toISOString();

  // Step 1 — alias-resolve agent_id. Throws UnknownAgentError if unknown.
  const resolvedAgentId = resolveAgentId(ctx.vaultPath, agentId);

  // Step 2 — best-effort enrichment from a ready signal on the same channel.
  const enrich = findReadySignal(ctx.vaultPath, input.channel, prNumber);

  // Step 3 — compose journal via the pure helper.
  const recordInput: MergeRecordInput = {
    pr_number: prNumber,
    channel: input.channel,
    agent_id: resolvedAgentId,
    status: status as MergeStatus,
    now,
    ...(input.merge_commit_sha !== undefined && {
      merge_commit_sha: input.merge_commit_sha,
    }),
    ...(input.notes !== undefined && { notes: input.notes }),
    ...(input.task_id !== undefined && { task_id: input.task_id }),
    ...(enrich.journalId !== undefined && {
      ready_signal_journal_id: enrich.journalId,
    }),
    ...(enrich.branch !== undefined && { branch: enrich.branch }),
  };
  const composed = composeMergeJournal(recordInput);

  // Step 4 — write the journal file. Idempotent overwrite if same id exists.
  const journalPath = join(
    ctx.vaultPath,
    "wikis",
    "_agents",
    "journal",
    `${composed.journal_id}.md`
  );
  mkdirSync(dirname(journalPath), { recursive: true });
  writeFileSync(
    journalPath,
    serializeFrontmatter(composed.frontmatter, composed.body)
  );
  await upsertPage(ctx.vaultPath, journalPath);

  // Step 5 — conditional task transition.
  let taskUpdated = false;
  const transition = computeTaskTransition(recordInput);
  if (transition !== null) {
    const task = findTask(ctx.vaultPath, transition.task_id);
    if (task !== null) {
      try {
        updateTask(ctx.vaultPath, {
          task_id: transition.task_id,
          wiki: task.wiki,
          expected_updated: task.updated,
          status: transition.new_status,
          agent_id: resolvedAgentId,
        });
        taskUpdated = true;
      } catch {
        taskUpdated = false;
      }
    }
  }

  return {
    journal_id: composed.journal_id,
    recorded_at: now,
    task_updated: taskUpdated,
  };
}

// ---------------------------------------------------------------------------
// Exported tool
// ---------------------------------------------------------------------------

const scope: ToolScope = {
  axis: (i: any) => `wikis/${(i as any)?.wiki ?? "*"}`,
};

export const mergeTool = {
  name: "vault_merge",
  description:
    "mode: queue (READ — surface the merge queue for a channel) | record (WRITE — journal a merge outcome + transition task on merged). Two distinct operations.",
  inputSchema: Input,
  scope,
  handler: async (
    input: MergeInput,
    ctx: { vaultPath: string; defaultFamily?: string }
  ): Promise<MergeQueueOutput | MergeRecordResult> => {
    if (input.mode === "queue") {
      return runMergeQueue(input, ctx);
    }
    return runMergeRecord(input, ctx);
  },
};
