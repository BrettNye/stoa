// Pure-functional helpers for composing the merge journal entry + computing
// the task transition for `vault_merge-record`. The tool layer (Wave 3 Task
// 3-2) handles file IO, the channel feed update, and alias resolution. This
// module assumes `agent_id` is already alias-resolved by the caller.

export type MergeStatus = "merged" | "failed" | "halted-conflict" | "halted-red-ci";

export interface MergeRecordInput {
  pr_number: number;
  channel: string;
  agent_id: string;                      // pre-resolved by caller (alias overlay applied)
  merge_commit_sha?: string;
  status: MergeStatus;
  notes?: string;
  task_id?: string;
  ready_signal_journal_id?: string;      // for backlink in body
  branch?: string;                       // resolved from channel post if available
  now: string;                           // ISO datetime — caller injects (testability)
}

export interface MergeRecordEntry {
  journal_id: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface TaskTransition {
  task_id: string;
  new_status: "completed";
}

export class UnknownAgentError extends Error {
  constructor(agentId: string) {
    super(`unknown agent_id: ${agentId}`);
    this.name = "UnknownAgentError";
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatStamp(now: string): string {
  // Use UTC components so the stamp is reproducible regardless of host TZ.
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const month = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const hour = pad2(d.getUTCHours());
  const minute = pad2(d.getUTCMinutes());
  return `${year}-${month}-${day}-${hour}${minute}`;
}

function deriveFeature(channel: string): string {
  const m = /^feat-(.*)-progress$/.exec(channel);
  return m ? m[1] : channel;
}

function titleFor(prNumber: number, status: MergeStatus): string {
  if (status === "halted-conflict") {
    return `Merge halted on conflict — PR #${prNumber}`;
  }
  return `Merge PR #${prNumber}: ${status}`;
}

function defaultNoteFor(status: MergeStatus): string {
  switch (status) {
    case "halted-conflict":
      return "Merge halted: rebase produced conflicts.";
    case "halted-red-ci":
      return "Merge halted: CI did not go green within the polling window.";
    case "failed":
      return "Merge attempt failed.";
    default:
      return "";
  }
}

export function composeMergeJournal(input: MergeRecordInput): MergeRecordEntry {
  const stamp = formatStamp(input.now);
  const journal_id = `journal-${stamp}-merge-${input.pr_number}-${input.status}`;
  const feature = deriveFeature(input.channel);

  const frontmatter: Record<string, unknown> = {
    id: journal_id,
    title: titleFor(input.pr_number, input.status),
    type: "journal",
    wiki: "_agents",
    created: input.now,
    author: input.agent_id,
    channel: input.channel,
    tags: ["merge", feature],
    pr_number: input.pr_number,
    status: input.status
  };
  if (input.merge_commit_sha !== undefined) {
    frontmatter.merge_commit_sha = input.merge_commit_sha;
  }
  if (input.task_id !== undefined) {
    frontmatter.task_id = input.task_id;
  }

  const lines: string[] = [];
  lines.push(`# Merge PR #${input.pr_number} — ${input.status}`);
  lines.push("");
  lines.push(`**PR:** #${input.pr_number}`);
  if (input.branch) {
    lines.push(`**Branch:** ${input.branch}`);
  }
  lines.push(`**Status:** ${input.status}`);

  if (input.status === "merged" && input.merge_commit_sha) {
    lines.push(`**Merge commit:** ${input.merge_commit_sha}`);
  }

  let notesShownInWhatHappened = false;
  if (
    input.status === "failed" ||
    input.status === "halted-conflict" ||
    input.status === "halted-red-ci"
  ) {
    lines.push("");
    lines.push("## What happened");
    lines.push("");
    const text = input.notes && input.notes.length > 0
      ? input.notes
      : defaultNoteFor(input.status);
    lines.push(text);
    notesShownInWhatHappened = !!input.notes && input.notes.length > 0;
  }

  if (input.ready_signal_journal_id) {
    lines.push("");
    lines.push("## Ready signal");
    lines.push("");
    lines.push(`[[wikis/_agents/journal/${input.ready_signal_journal_id}]]`);
  }

  if (input.notes && !notesShownInWhatHappened) {
    lines.push("");
    lines.push("## Notes");
    lines.push("");
    lines.push(input.notes);
  }

  lines.push("");
  const body = lines.join("\n");

  return { journal_id, frontmatter, body };
}

export function computeTaskTransition(input: MergeRecordInput): TaskTransition | null {
  if (input.status !== "merged") return null;
  if (typeof input.task_id !== "string" || input.task_id.length === 0) return null;
  return { task_id: input.task_id, new_status: "completed" as const };
}
