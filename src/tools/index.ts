import { recallTool } from "./recall.js";
import { readTool } from "./read.js";
import { listWikisTool } from "./list-wikis.js";
import { lintTool } from "./lint.js";
import { channelTailTool } from "./channel-tail.js";
import { inboxTool } from "./inbox.js";
import { processInboxTool } from "./process-inbox.js";
import { newTool } from "./new.js";
import { newWikiTool } from "./new-wiki.js";
import { setActiveTool } from "./set-active.js";
import { synthesizeTool } from "./synthesize.js";
import { reindexTool } from "./reindex.js";
import { agentJournalTool } from "./agent-journal.js";
import { channelPostTool } from "./channel-post.js";
import { taskClaimTool } from "./task-claim.js";

// v1.5 — substrate tools
import { bootstrapRepoTool } from "./bootstrap-repo.js";
import { syncSkillsTool } from "./sync-skills.js";
import { startTool } from "./start.js";
import { taskCreateTool } from "./task-create.js";
import { taskListTool } from "./task-list.js";
import { taskUpdateTool } from "./task-update.js";
import { profileStatsTool } from "./profile-stats.js";
import { evolveProfileTool } from "./evolve-profile.js";
import { refreshProfileMemoryTool } from "./refresh-profile-memory.js";
import { suggestPokemonTool } from "./suggest-pokemon.js";

// v1.6 Phase 2 — wiki families. Bulk wikilink rewrite tool used during
// family migrations (split rastate → rastate-{core,dev,ideas,learning})
// and wiki renames more generally. Pure rewrite logic in core/rewrite-links.
import { rewriteLinksTool } from "./rewrite-links.js";

// v1.6 Phase 3 — bulk merge-queue surfacing. Reads `ready: branch=...`
// signals from a coordination channel + tasks scoped to the resolved
// wiki/family, returns a topo-sorted dependency order. Pure logic in
// core/merge-queue.
import { mergeQueueTool } from "./merge-queue.js";

// v1.6 Phase 3 — merge journal + task transition. Writes a merge outcome
// journal entry under wikis/_agents/journal/ and, on status=merged with
// task_id, transitions the task to completed. Pure logic in core/merge-record.
import { mergeRecordTool } from "./merge-record.js";

// v1.7 Phase 3 — vault.sync-agents. Builds a SubagentIntent from
// profile + moveset and dispatches to the per-runtime adapter
// (currently claude-code). Replaces sync-skills as the recommended
// primary surface; sync-skills stays for moveset-only deploys.
import { syncAgentsTool } from "./sync-agents.js";

export const allTools = [
  recallTool, readTool, listWikisTool, lintTool, channelTailTool,
  inboxTool, processInboxTool, newTool, newWikiTool, setActiveTool,
  synthesizeTool, reindexTool, agentJournalTool, channelPostTool, taskClaimTool,
  // v1.5
  bootstrapRepoTool, syncSkillsTool, startTool,
  taskCreateTool, taskListTool, taskUpdateTool, profileStatsTool, evolveProfileTool, refreshProfileMemoryTool, suggestPokemonTool,
  // v1.6 phase 2
  rewriteLinksTool,
  // v1.6 phase 3
  mergeQueueTool, mergeRecordTool,
  // v1.7 phase 3
  syncAgentsTool
];

export type ToolDefinition = (typeof allTools)[number];
