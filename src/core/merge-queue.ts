// core/merge-queue.ts — pure logic for ready-signal parsing + task→PR mapping + topo sort.
// No IO. The caller (tool layer) loads channel entries + tasks and passes them in.
// See plans/v1.6-phase-3 §"vault_merge-queue semantics" for the contract.

export interface ReadyEntry {
  journal_id: string;
  branch: string;
  pr_number: number;
  posted_at: string; // ISO datetime
  author: string; // agent id (already alias-resolved by caller)
}

export interface TaskRef {
  id: string;
  channel: string;
  blocking: string[]; // task ids this task depends on
  branch_suffix?: string;
  status: string;
  claimed_by?: string;
}

export interface ReadyPR {
  pr_number: number;
  branch: string;
  task_id: string | null;
  blocking: string[];
  ci_status: "unknown";
  ready_signal_journal_id: string;
  author: string;
}

export interface UnreadyPR {
  task_id: string;
  claimed_by: string;
  branch_inferred?: string;
}

export interface MergeQueueOutput {
  feature: string;
  ready_prs: ReadyPR[];
  unready_prs: UnreadyPR[];
  dependency_order: number[];
  warnings: string[];
}

const READY_RE = /ready[:\s]+(?:branch[:\s]+)?(\S+)/i;
const PR_RE = /(?:PR-|#)(\d+)/;
const MERGE_RECORD_ID = /-merge-\d+-(merged|failed|halted-conflict|halted-red-ci)$/;

export function parseReadySignals(
  channelEntries: Array<{
    journal_id: string;
    body: string;
    posted_at: string;
    author: string;
  }>,
): ReadyEntry[] {
  const out: ReadyEntry[] = [];
  for (const entry of channelEntries) {
    // Skip merge-record outcomes — they live on the same channel feed but are
    // not ready signals. (Their `## Ready signal` H2 + `**PR:** #N` line would
    // otherwise pass both regex tests.)
    if (MERGE_RECORD_ID.test(entry.journal_id)) continue;

    const readyMatch = entry.body.match(READY_RE);
    const prMatch = entry.body.match(PR_RE);
    if (!readyMatch || !prMatch) continue;
    let branch = readyMatch[1];
    if (branch.startsWith("branch=")) {
      branch = branch.slice("branch=".length);
    }
    const pr_number = parseInt(prMatch[1], 10);
    out.push({
      journal_id: entry.journal_id,
      branch,
      pr_number,
      posted_at: entry.posted_at,
      author: entry.author,
    });
  }
  return out;
}

export function mapReadyToTasks(
  ready: ReadyEntry[],
  tasks: TaskRef[],
  channel: string,
): {
  matched: Array<{ ready: ReadyEntry; task: TaskRef | null }>;
  warnings: string[];
} {
  const matched: Array<{ ready: ReadyEntry; task: TaskRef | null }> = [];
  const warnings: string[] = [];

  const channelTasks = tasks.filter((t) => t.channel === channel);

  for (const r of ready) {
    const candidates = channelTasks.filter(
      (t) => t.branch_suffix !== undefined && r.branch.endsWith(t.branch_suffix),
    );
    if (candidates.length === 0) {
      matched.push({ ready: r, task: null });
      warnings.push(`PR #${r.pr_number} has no matching task; ordered last`);
    } else if (candidates.length === 1) {
      matched.push({ ready: r, task: candidates[0] });
    } else {
      matched.push({ ready: r, task: candidates[0] });
      const ids = candidates.map((c) => c.id).join(", ");
      warnings.push(
        `PR #${r.pr_number} matched multiple tasks: [${ids}]; first match wins`,
      );
    }
  }

  return { matched, warnings };
}

export function topoSortReady(
  matched: Array<{ ready: ReadyEntry; task: TaskRef | null }>,
): { dependency_order: number[]; warnings: string[] } {
  const warnings: string[] = [];

  // Build pr_number -> matched-pair lookup, and task_id -> pr_number for edge resolution.
  const byPr = new Map<number, { ready: ReadyEntry; task: TaskRef | null }>();
  const taskIdToPr = new Map<string, number>();
  for (const pair of matched) {
    byPr.set(pair.ready.pr_number, pair);
    if (pair.task) {
      taskIdToPr.set(pair.task.id, pair.ready.pr_number);
    }
  }

  // Build adjacency (dep_pr -> set of dependent prs) and in-degree map.
  const adj = new Map<number, Set<number>>();
  const inDegree = new Map<number, number>();
  for (const pr of byPr.keys()) {
    adj.set(pr, new Set());
    inDegree.set(pr, 0);
  }
  for (const pair of matched) {
    if (!pair.task) continue;
    const thisPr = pair.ready.pr_number;
    for (const depTaskId of pair.task.blocking) {
      const depPr = taskIdToPr.get(depTaskId);
      if (depPr === undefined) continue; // dep not represented as a ready PR — ignore
      // edge depPr -> thisPr
      const set = adj.get(depPr)!;
      if (!set.has(thisPr)) {
        set.add(thisPr);
        inDegree.set(thisPr, (inDegree.get(thisPr) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm with explicit tie-breaking.
  const cmp = (a: number, b: number): number => {
    const pa = byPr.get(a)!.ready.posted_at;
    const pb = byPr.get(b)!.ready.posted_at;
    if (pa < pb) return -1;
    if (pa > pb) return 1;
    return a - b;
  };

  const queue: number[] = [];
  for (const [pr, deg] of inDegree) {
    if (deg === 0) queue.push(pr);
  }
  queue.sort(cmp);

  const order: number[] = [];
  while (queue.length > 0) {
    const next = queue.shift()!;
    order.push(next);
    for (const neighbor of adj.get(next)!) {
      const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) {
        queue.push(neighbor);
      }
    }
    queue.sort(cmp);
  }

  // Cycle detection: any nodes still with in-degree > 0 are in a cycle.
  const remaining: number[] = [];
  for (const [pr, deg] of inDegree) {
    if (deg > 0) remaining.push(pr);
  }
  if (remaining.length > 0) {
    remaining.sort((a, b) => a - b);
    warnings.push(
      `cycle detected in task.blocking; affected PRs appended last: [${remaining.join(", ")}]`,
    );
    order.push(...remaining);
  }

  return { dependency_order: order, warnings };
}

export function buildMergeQueue(
  channelEntries: Parameters<typeof parseReadySignals>[0],
  tasks: TaskRef[],
  channel: string,
): MergeQueueOutput {
  const ready = parseReadySignals(channelEntries);
  const { matched, warnings: mapWarnings } = mapReadyToTasks(ready, tasks, channel);
  const { dependency_order, warnings: topoWarnings } = topoSortReady(matched);

  // Derive feature from channel name.
  const featMatch = channel.match(/^feat-(.*)-progress$/);
  const feature = featMatch ? featMatch[1] : channel;

  // ready_prs
  const ready_prs: ReadyPR[] = matched.map(({ ready: r, task }) => ({
    pr_number: r.pr_number,
    branch: r.branch,
    task_id: task?.id ?? null,
    blocking: task?.blocking ?? [],
    ci_status: "unknown" as const,
    ready_signal_journal_id: r.journal_id,
    author: r.author,
  }));

  // unready_prs: tasks for this channel that are not completed and have no matching ready PR.
  const matchedTaskIds = new Set<string>();
  for (const m of matched) {
    if (m.task) matchedTaskIds.add(m.task.id);
  }
  const unready_prs: UnreadyPR[] = [];
  for (const t of tasks) {
    if (t.channel !== channel) continue;
    if (t.status === "completed") continue;
    if (matchedTaskIds.has(t.id)) continue;
    const u: UnreadyPR = {
      task_id: t.id,
      claimed_by: t.claimed_by ?? "",
    };
    if (t.branch_suffix !== undefined) {
      u.branch_inferred = t.branch_suffix;
    }
    unready_prs.push(u);
  }

  return {
    feature,
    ready_prs,
    unready_prs,
    dependency_order,
    warnings: [...mapWarnings, ...topoWarnings],
  };
}
