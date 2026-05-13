import { readPage, writePage } from "./pages.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, toIsoDate } from "./frontmatter.js";
import { readProfile, ProfileNotFoundError } from "./profiles.js";
import { findOnDisk } from "./disk-fallback.js";
import { checkTaskReadiness, type TaskReadinessSignal } from "./task-readiness.js";

export class AlreadyClaimedError extends Error {
  constructor(public taskId: string, public claimedBy: string) {
    super(`task ${taskId} already claimed by ${claimedBy}`);
    this.name = "AlreadyClaimedError";
  }
}

export class WrongTypeError extends Error {
  constructor(public taskId: string, public requiredType: string, public actualType: string) {
    super(`WRONG_TYPE: task ${taskId} requires pokemon_type=${requiredType}, but agent's profile has type=${actualType}`);
    this.name = "WrongTypeError";
  }
}

export class TaskNotReadyError extends Error {
  constructor(public taskId: string, public missing: TaskReadinessSignal[]) {
    super(`TASK_NOT_READY: task ${taskId} is missing required content: ${missing.join(", ")}`);
    this.name = "TaskNotReadyError";
  }
}

export interface ClaimInput {
  task_id: string;
  agent_id: string;
  expected_updated: string;
  wiki?: string;
  force?: boolean;  // default false — skip readiness check
}

export interface ClaimResult {
  task_id: string;
  claimed_by: string;
  claimed_at: string;
  updated: string;
}

export function claimTask(vaultPath: string, input: ClaimInput): ClaimResult {
  const wiki = input.wiki ?? "alpha"; // resolved by caller normally; fallback for tests
  const page = readPage(vaultPath, input.task_id, wiki);
  const requesterAgent = `agent:${input.agent_id}`;

  // Type restriction (spec §6.2 modification)
  const requiredType = page.frontmatter.required_pokemon_type;
  if (requiredType) {
    let agentType: string = "normal";  // default for agents without a profile
    let agentSecondaryType: string | undefined;
    try {
      // The profile id is `profile-<agent_id>` per the v1.5 convention.
      const profileId = input.agent_id.startsWith("profile-")
        ? input.agent_id
        : `profile-${input.agent_id}`;
      const profile = readProfile(vaultPath, profileId);
      agentType = String(profile.frontmatter.pokemon_type ?? "normal");
      agentSecondaryType = profile.frontmatter.secondary_pokemon_type
        ? String(profile.frontmatter.secondary_pokemon_type)
        : undefined;
    } catch (e) {
      if (!(e instanceof ProfileNotFoundError)) throw e;
      // ProfileNotFoundError → agentType stays "normal"
    }
    if (agentType !== requiredType && agentSecondaryType !== requiredType) {
      throw new WrongTypeError(input.task_id, String(requiredType), agentType);
    }
  }

  // Readiness gate — runs after type check (cheaper failure first) and before
  // AlreadyClaimedError (no point checking readiness on something already grabbed).
  if (!input.force) {
    const readiness = checkTaskReadiness(page.body);
    if (!readiness.ready) {
      throw new TaskNotReadyError(input.task_id, readiness.missing);
    }
  }

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

export interface CreateTaskInput {
  title: string;
  wiki: string;
  description?: string;
  segregation?: string[];
  blocking?: string[];
  channel?: string;
  required_pokemon_type?: string;
  estimate_minutes?: number;
}

export interface CreateTaskResult {
  id: string;
  path: string;
  updated: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export function createTask(vaultPath: string, input: CreateTaskInput): CreateTaskResult {
  const slug = slugify(input.title);
  const id = `task-${slug}`;
  const today = new Date().toISOString().slice(0, 10);

  const fm: Record<string, any> = {
    id,
    title: input.title,
    type: "task",
    wiki: input.wiki,
    status: "pending",
    created: today,
    updated: today,
    summary: input.title
  };
  if (input.description) fm.description = input.description;
  if (input.segregation) fm.segregation = input.segregation;
  if (input.blocking) fm.blocking = input.blocking;
  if (input.channel) fm.channel = input.channel;
  if (input.required_pokemon_type) fm.required_pokemon_type = input.required_pokemon_type;
  if (input.estimate_minutes) fm.estimate_minutes = input.estimate_minutes;

  const result = writePage(vaultPath, {
    id, type: "task", wiki: input.wiki,
    frontmatter: fm,
    body: input.description ?? [
      `# ${input.title}`,
      ``,
      `## Scope`,
      `(add implementation details and affected files here — e.g. task.md)`,
      ``,
      `## Out of scope`,
      `(list what this task explicitly does not cover)`,
      ``,
      `## Verification`,
      `- [ ] (add acceptance criteria here)`,
    ].join("\n")
  });

  return { id, path: result.path, updated: result.updated };
}

export interface ListTasksInput {
  wiki?: string;
  status?: "pending" | "claimed" | "in_progress" | "completed" | "failed" | "blocked";
  claimed_by?: string;
  channel?: string;
  pokemon_type?: string;
  limit?: number;
}

export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  claimed_by?: string;
  pokemon_type?: string;
  segregation?: string[];
  blocking?: string[];
  channel?: string;
  wiki: string;
  // Phase-3 T3-1 — exposed for `vault.merge-queue` so the tool can build
  // `TaskRef[]` (which `core/merge-queue` needs for branch→task mapping)
  // without each consumer re-reading task pages from disk. Optional:
  // tasks created before the convention landed simply omit it.
  branch_suffix?: string;
}

export function listTasks(vaultPath: string, input: ListTasksInput = {}): TaskSummary[] {
  const wikis = input.wiki ? [input.wiki] : listWikiNames(vaultPath);
  const out: TaskSummary[] = [];

  for (const wiki of wikis) {
    const dir = join(vaultPath, "wikis", wiki, "tasks");
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const path = join(dir, file);
      try {
        const raw = readFileSync(path, "utf8");
        const { frontmatter: fm } = parseFrontmatter(raw);
        if (input.status && fm.status !== input.status) continue;
        if (input.claimed_by && fm.claimed_by !== input.claimed_by) continue;
        if (input.channel && fm.channel !== input.channel) continue;
        if (input.pokemon_type) {
          if (fm.required_pokemon_type && fm.required_pokemon_type !== input.pokemon_type) {
            continue;
          }
        }
        out.push({
          id: String(fm.id),
          title: String(fm.title ?? ""),
          status: String(fm.status ?? "pending"),
          claimed_by: fm.claimed_by ? String(fm.claimed_by) : undefined,
          pokemon_type: fm.required_pokemon_type ? String(fm.required_pokemon_type) : undefined,
          segregation: Array.isArray(fm.segregation) ? fm.segregation : undefined,
          blocking: Array.isArray(fm.blocking) ? fm.blocking : undefined,
          channel: fm.channel ? String(fm.channel) : undefined,
          wiki,
          branch_suffix: fm.branch_suffix ? String(fm.branch_suffix) : undefined
        });
      } catch {
        // skip malformed
      }
    }
  }

  const limit = input.limit ?? 50;
  return out.slice(0, limit);
}

function listWikiNames(vaultPath: string): string[] {
  const wikisDir = join(vaultPath, "wikis");
  if (!existsSync(wikisDir)) return [];
  return readdirSync(wikisDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

export interface TaskOnDisk {
  wiki: string;
  updated: string;
  status: string;
}

/**
 * Disk-scan fallback for finding a task by id.
 *
 * `tools/merge-record.ts:findTask` consults `_index/pages.json` first (fast path).
 * If a task was created on disk since the last `vault.reindex`, the index lookup
 * misses. This helper does a targeted scan to recover the task without forcing a
 * full reindex.
 *
 * v1.7 §5.4 — now delegates to the generalized `findOnDisk` in
 * `core/disk-fallback.ts`. Public contract preserved: returns a `TaskOnDisk`
 * shape with `{ wiki, updated, status }`, with `updated` ISO-normalized and
 * the defensive id-mismatch guard intact. Restricts results to `type: "task"`.
 *
 * Returns null when no task with the given id exists in any wiki's tasks/ dir.
 */
export function findTaskOnDisk(vaultPath: string, taskId: string): TaskOnDisk | null {
  const found = findOnDisk(vaultPath, taskId);
  if (!found) return null;
  if (found.type !== "task") return null;
  return {
    wiki: found.wiki,
    // gray-matter parses unquoted YAML dates as JS Date objects; normalize.
    updated: toIsoDate(found.frontmatter.updated),
    status: String(found.frontmatter.status ?? "")
  };
}

export interface Task {
  id: string;
  title: string;
  type: string;
  wiki: string;
  status: string;
  claimed_by?: string;
  claimed_at?: string;
  updated: string;
  body: string;
}

export interface ReleaseInput {
  task_id: string;
  expected_updated: string;
  wiki: string;
  reason?: string;
}

export interface ReleaseResult {
  task: Task;
}

export class NotClaimedError extends Error {
  code = "NotClaimed" as const;
  constructor(public currentStatus: string) {
    super(`task is not in a claimed state (current: ${currentStatus})`);
    this.name = "NotClaimedError";
  }
}

export function releaseTask(vaultPath: string, input: ReleaseInput): ReleaseResult {
  const wiki = input.wiki;
  const page = readPage(vaultPath, input.task_id, wiki);

  const currentStatus = String(page.frontmatter.status ?? "pending");
  const allowedStatuses = new Set(["claimed", "in_progress"]);
  if (!allowedStatuses.has(currentStatus)) {
    throw new NotClaimedError(currentStatus);
  }

  const newFm: Record<string, any> = { ...page.frontmatter };
  newFm.status = "pending";
  delete newFm.claimed_by;
  delete newFm.assigned_at;

  let body = page.body;
  if (input.reason) {
    const date = new Date().toISOString().slice(0, 10);
    body = `${body.trimEnd()}\n\n## Released ${date}: ${input.reason}\n`;
  }

  const result = writePage(vaultPath, {
    id: input.task_id,
    type: "task",
    wiki,
    frontmatter: newFm,
    body,
    expectedUpdated: input.expected_updated
  });

  const task: Task = {
    id: input.task_id,
    title: String(newFm.title ?? ""),
    type: "task",
    wiki,
    status: "pending",
    updated: result.updated,
    body
  };

  return { task };
}

export interface UpdateTaskInput {
  task_id: string;
  wiki: string;
  expected_updated: string;
  status?: "pending" | "claimed" | "in_progress" | "completed" | "failed" | "blocked";
  notes?: string;
  segregation?: string[];
  agent_id?: string;
}

export interface UpdateTaskResult {
  task_id: string;
  updated: string;
  status: string;
}

export function updateTask(vaultPath: string, input: UpdateTaskInput): UpdateTaskResult {
  const page = readPage(vaultPath, input.task_id, input.wiki);
  const fm = { ...page.frontmatter };
  if (input.status) fm.status = input.status;
  if (input.segregation) fm.segregation = input.segregation;

  let body = page.body;
  if (input.notes) {
    const stamp = new Date().toISOString();
    const author = input.agent_id ?? "agent:unknown";
    body = `${body.trimEnd()}\n\n## ${stamp} — ${author}\n${input.notes}\n`;
  }

  const result = writePage(vaultPath, {
    id: input.task_id,
    type: "task",
    wiki: input.wiki,
    frontmatter: fm,
    body,
    expectedUpdated: input.expected_updated
  });

  return {
    task_id: input.task_id,
    updated: result.updated,
    status: String(fm.status ?? "pending")
  };
}
