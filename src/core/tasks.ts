import { readPage, writePage } from "./pages.js";

export class AlreadyClaimedError extends Error {
  constructor(public taskId: string, public claimedBy: string) {
    super(`task ${taskId} already claimed by ${claimedBy}`);
    this.name = "AlreadyClaimedError";
  }
}

export interface ClaimInput {
  task_id: string;
  agent_id: string;
  expected_updated: string;
  wiki?: string;
}

export interface ClaimResult {
  task_id: string;
  claimed_by: string;
  claimed_at: string;
  updated: string;
}

export function claimTask(vaultPath: string, input: ClaimInput): ClaimResult {
  const wiki = input.wiki ?? "alpha"; // resolved by caller normally
  const page = readPage(vaultPath, input.task_id, wiki);
  const requesterAgent = `agent:${input.agent_id}`;
  if (page.frontmatter.claimed_by && page.frontmatter.claimed_by !== requesterAgent) {
    throw new AlreadyClaimedError(input.task_id, page.frontmatter.claimed_by);
  }
  const claimed_at = new Date().toISOString();
  const newFm = {
    ...page.frontmatter,
    status: "claimed",
    claimed_by: requesterAgent,
    assigned_at: claimed_at
  };
  const result = writePage(vaultPath, {
    id: input.task_id,
    type: "task",
    wiki,
    frontmatter: newFm,
    body: page.body,
    expectedUpdated: input.expected_updated
  });
  return {
    task_id: input.task_id,
    claimed_by: requesterAgent,
    claimed_at,
    updated: result.updated
  };
}
