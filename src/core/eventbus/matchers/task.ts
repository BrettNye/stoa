import type { ParsedPage, SourceMatcher, VaultEvent } from "../types.js";

const PATH_RE = /\/wikis\/([^/]+)\/tasks\/([^/]+)\.md$/;

export type TaskState = { status: string; owner: string | null };

function pickTaskState(fm: Record<string, unknown>): TaskState {
  return {
    status: typeof fm.status === "string" ? fm.status : "",
    owner: typeof fm.owner === "string" ? fm.owner : null,
  };
}

export const taskMatcher: SourceMatcher<TaskState> = {
  source: "task",
  globs: ["wikis/*/tasks/**/*.md"],
  deriveKey(absPath: string, _vaultPath: string) {
    const m = absPath.replace(/\\/g, "/").match(PATH_RE);
    if (!m) return null;
    return { wiki: m[1], id: m[2] };
  },
  decide(parsed: ParsedPage, prev: TaskState | undefined, changeKind) {
    const cur = pickTaskState(parsed.frontmatter);
    if (changeKind === "add" && !prev) {
      return { emit: true, enrichment: {} };
    }
    if (!prev) return { emit: false };
    if (cur.status === prev.status && cur.owner === prev.owner) {
      return { emit: false };
    }
    const enrichment: Partial<VaultEvent> = {};
    if (cur.status !== prev.status) {
      enrichment.task_status_change = { from: prev.status, to: cur.status };
    }
    if (cur.owner !== prev.owner) {
      enrichment.task_owner_change = { from: prev.owner, to: cur.owner };
    }
    return { emit: true, enrichment };
  },
  nextState(parsed) { return pickTaskState(parsed.frontmatter); },
  init(_path, parsed) { return pickTaskState(parsed.frontmatter); },
};
