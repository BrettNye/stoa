// vault-mcp/src/tools/merge-record.ts
//
// Phase-3 T3-2 — `vault.merge-record` MCP tool: write a merge journal entry
// for a PR (merged | failed | halted-conflict | halted-red-ci) and, when the
// status is `merged` AND a `task_id` is provided, transition the source task
// to `status: completed`. Pure logic (id format, frontmatter+body composition,
// task-transition rule) lives in `core/merge-record.ts` (Wave 1 T1-2); this
// layer wires alias resolution + file IO + index upsert + task lookup/update.
//
// Behaviour (locked, spec §6.1 + Plan C "vault.merge-record semantics"):
//   1. Resolve `agent_id` via the alias overlay (core/profiles.readProfile,
//      which already chains profile-<bare> → resolveCurrent under the hood).
//      If no profile exists and no alias entry resolves, throw
//      `UnknownAgentError` from `core/merge-record.ts`. NO journal written.
//   2. Compose the journal entry via `composeMergeJournal`. Optionally enrich
//      `branch` and `ready_signal_journal_id` from a recent ready signal on
//      the same channel that referenced this `pr_number`; both are best-effort.
//   3. Write the journal file at `wikis/_agents/journal/<journal_id>.md`.
//      Idempotent rewrite: same `now` + same input → same `journal_id`, the
//      file is simply overwritten with no error. `upsertPage` keeps the index
//      hot so subsequent `recall`/`channel-tail` calls see it immediately.
//   4. Conditional task transition. `computeTaskTransition` is the rule of
//      record: it returns a transition only when status === "merged" AND
//      task_id is a non-empty string. For all halt/fail statuses it returns
//      null and the task is NOT touched, even if a task_id was provided.
//      This makes failure/halt journals safe to re-run without side effects
//      on the task ledger.
//
// Failure modes:
//   - Unknown agent_id (no alias match) → `UnknownAgentError`. No journal.
//   - task_id provided but task not found → silent miss, `task_updated: false`,
//     journal STILL written (the rule of record is the journal, not the task
//     transition).
//   - File write failure → underlying error propagates; not swallowed.
//
// Flat zod schema. `z.discriminatedUnion` is incompatible with the MCP SDK
// per the carry-forward gotcha noted on `rewrite-links.ts` and `merge-queue.ts`.
import { z } from "zod";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { serializeFrontmatter } from "../core/frontmatter.js";
import { upsertPage, loadIndex } from "../core/index.js";
import { readProfile, ProfileNotFoundError } from "../core/profiles.js";
import { updateTask } from "../core/tasks.js";
import {
  composeMergeJournal,
  computeTaskTransition,
  UnknownAgentError,
  type MergeRecordInput,
  type MergeStatus
} from "../core/merge-record.js";

const Input = z.object({
  pr_number: z.number().int(),
  channel: z.string(),
  agent_id: z.string(),
  merge_commit_sha: z.string().optional(),
  status: z.enum(["merged", "failed", "halted-conflict", "halted-red-ci"]),
  notes: z.string().optional(),
  task_id: z.string().optional()
});

export interface MergeRecordResult {
  journal_id: string;
  recorded_at: string;
  task_updated: boolean;
}

// Test seam: fixed-clock injection for the "idempotent re-run" test. In
// production `nowFn` is unset and `new Date().toISOString()` runs.
let nowFn: (() => string) | undefined;
export function __setNowFnForTests(fn: (() => string) | undefined): void {
  nowFn = fn;
}

/**
 * Normalize the caller-supplied agent_id to a bare name. Accepts:
 *   "charmander"          → "charmander"
 *   "agent:charmander"    → "charmander"
 *   "profile-charmander"  → "charmander"
 */
function bareAgentId(input: string): string {
  let s = input;
  if (s.startsWith("agent:")) s = s.slice("agent:".length);
  if (s.startsWith("profile-")) s = s.slice("profile-".length);
  return s;
}

/**
 * Resolve the input `agent_id` to its current canonical `agent:<bare>` form
 * via `core/profiles.readProfile`, which already applies the alias overlay
 * (spec §7.5). Throws `UnknownAgentError` if no profile exists for the input
 * and no alias entry resolves to one.
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
 * the same channel. We scan the page index for journal entries with the
 * matching channel and a body referencing `PR-<n>`. Returns the journal id
 * (and best-guess branch parsed from `branch=...`) when found, else nothing.
 *
 * Pure read of `_index/pages.json` — no body parse here. Body parse happens
 * via the page table's tokens or, for now, we only emit ready_signal_journal_id
 * when we can parse it from the index entry's title/summary. Conservative:
 * if we can't be sure, omit both fields. The journal still composes correctly
 * without them (composeMergeJournal already treats both as optional).
 */
function findReadySignal(
  vaultPath: string,
  channel: string,
  prNumber: number
): { journalId?: string; branch?: string } {
  try {
    const idx = loadIndex(vaultPath);
    const candidates = idx.pages.filter(
      p => p.type === "journal" && p.channel === channel
    );
    // We need the body to confirm the PR-<n> reference. Read each candidate's
    // file and parse. Scan most-recent-first to prefer fresh signals.
    const sorted = [...candidates].sort((a, b) => b.created.localeCompare(a.created));
    for (const p of sorted) {
      try {
        const raw = readFileSync(join(vaultPath, p.path), "utf8");
        const re = new RegExp(`\\bPR-${prNumber}\\b`);
        if (!re.test(raw)) continue;
        const branchMatch = /ready:\s*branch=(\S+)/.exec(raw);
        return {
          journalId: p.id,
          branch: branchMatch ? branchMatch[1] : undefined
        };
      } catch {
        continue;
      }
    }
  } catch {
    // index missing or malformed → no enrichment; that's fine.
  }
  return {};
}

/**
 * Look up a task by id across all wikis (the tool has no `wiki:` arg). Returns
 * the wiki + current `updated` (for OCC) so the update-task path can run with
 * a fresh expected_updated. Returns null when no task with this id exists.
 */
function findTask(
  vaultPath: string,
  taskId: string
): { wiki: string; updated: string; status: string } | null {
  // listTasks doesn't expose `updated`, so we go through the index instead.
  const idx = loadIndex(vaultPath);
  const hit = idx.pages.find(p => p.id === taskId && p.type === "task");
  if (!hit) return null;
  return {
    wiki: hit.wiki,
    updated: hit.updated,
    status: String((hit as any).status ?? "")
  };
}

export const mergeRecordTool = {
  name: "vault.merge-record",
  description:
    "Record a merge outcome for a PR: write a journal entry under wikis/_agents/journal/, and when status === 'merged' with a task_id, transition the task to status=completed. Halt/fail statuses write the journal but do NOT touch the task. agent_id is alias-resolved.",
  inputSchema: Input,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string }
  ): Promise<MergeRecordResult> => {
    const now = (nowFn ? nowFn() : new Date().toISOString());

    // Step 1 — alias-resolve agent_id. Throws UnknownAgentError if unknown.
    const resolvedAgentId = resolveAgentId(ctx.vaultPath, input.agent_id);

    // Step 2 — best-effort enrichment from a ready signal on the same channel.
    const enrich = findReadySignal(ctx.vaultPath, input.channel, input.pr_number);

    // Step 3 — compose journal via the pure helper.
    const recordInput: MergeRecordInput = {
      pr_number: input.pr_number,
      channel: input.channel,
      agent_id: resolvedAgentId,
      status: input.status as MergeStatus,
      now,
      ...(input.merge_commit_sha !== undefined && { merge_commit_sha: input.merge_commit_sha }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.task_id !== undefined && { task_id: input.task_id }),
      ...(enrich.journalId !== undefined && { ready_signal_journal_id: enrich.journalId }),
      ...(enrich.branch !== undefined && { branch: enrich.branch })
    };
    const composed = composeMergeJournal(recordInput);

    // Step 4 — write the journal file. Idempotent overwrite if same id exists.
    const journalPath = join(
      ctx.vaultPath, "wikis", "_agents", "journal", `${composed.journal_id}.md`
    );
    mkdirSync(dirname(journalPath), { recursive: true });
    writeFileSync(journalPath, serializeFrontmatter(composed.frontmatter, composed.body));
    upsertPage(ctx.vaultPath, journalPath);

    // Step 5 — conditional task transition. computeTaskTransition is the
    // single rule: merged + non-empty task_id → transition; everything else
    // returns null. We honor that and only attempt the update on transition.
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
            agent_id: resolvedAgentId
          });
          taskUpdated = true;
        } catch {
          // If the task update fails (e.g. stale OCC on idempotent re-run),
          // surface task_updated=false but keep the journal. The journal is
          // the rule of record; the task transition is a convenience.
          taskUpdated = false;
        }
      }
      // task missing → silent miss; journal STILL written, taskUpdated=false.
    }

    return {
      journal_id: composed.journal_id,
      recorded_at: now,
      task_updated: taskUpdated
    };
  }
};
