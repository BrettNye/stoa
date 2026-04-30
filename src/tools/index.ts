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

export const allTools = [
  recallTool, readTool, listWikisTool, lintTool, channelTailTool,
  inboxTool, processInboxTool, newTool, newWikiTool, setActiveTool,
  synthesizeTool, reindexTool, agentJournalTool, channelPostTool, taskClaimTool,
  // v1.5
  bootstrapRepoTool, syncSkillsTool, startTool,
  taskCreateTool, taskListTool, taskUpdateTool, profileStatsTool, evolveProfileTool, refreshProfileMemoryTool, suggestPokemonTool,
  // v1.6 phase 2
  rewriteLinksTool
];

export type ToolDefinition = (typeof allTools)[number];
