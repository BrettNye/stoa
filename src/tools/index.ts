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
// seed-substrate: copy bundled example profiles/moves/course into a fresh
// vault's wikis/_agents/. Bundled under <package>/seed/_agents/.
import { seedSubstrateTool } from "./seed-substrate.js";
import { startTool } from "./start.js";
import { taskCreateTool } from "./task-create.js";
import { taskListTool } from "./task-list.js";
import { taskUpdateTool } from "./task-update.js";
import { profileStatsTool } from "./profile-stats.js";
import { evolveProfileTool } from "./evolve-profile.js";
import { refreshProfileMemoryTool } from "./refresh-profile-memory.js";
import { suggestPokemonTool } from "./suggest-pokemon.js";

// New-user onboarding (feat/new-user-onboarding) — substrate-aware
// scaffolding tools that pre-fill v1.5 required frontmatter so authors
// don't have to memorize the pokemon_type / evolution_stage / moveset
// contract. Thin wrappers over writePage + upsertPage; see new-profile.ts
// and new-move.ts.
import { newProfileTool } from "./new-profile.js";
import { newMoveTool } from "./new-move.js";

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

// v1.7 Phase 3 — vault_sync-agents. Builds a SubagentIntent from
// profile + moveset and dispatches to the per-runtime adapter
// (currently claude-code). Replaces sync-skills as the recommended
// primary surface; sync-skills stays for moveset-only deploys.
import { syncAgentsTool } from "./sync-agents.js";

// Claims foundation (Plan 1) — vault_claim and vault_list-claims. Authoring +
// read primitives over the claim type. Tool modules export their objects;
// registration here is the wiring that lets the stdio dispatcher and the
// shared callTool test helper reach them by name. See
// `wikis/_meta/plans/2026-05-02-vault-mcp-claims-plan-1-foundation-dag.md`
// §task-tools-index-registration.
import { claimTool } from "./claim.js";
import { listClaimsTool } from "./list-claims.js";

// agent-memory — vault_agent-memory. Identity-keyed working context for an
// agent: ranked, scope-aware, decay-aware claims. Read-only. See spec
// wikis/_meta/specs/2026-05-13-agent-memory-design.md.
import { agentMemoryTool } from "./agent-memory.js";

// Stadium Plan B (vault-side MCP tools) — trainer init/registration,
// real-skill register/refresh, move fusion, telemetry push, queue/accept
// match flow, invite listing, draft + move submission, and match watch.
// See `wikis/_meta/plans/2026-05-04-stadium-plan-b-dag.md`.
import { trainerInitTool } from "./trainer-init.js";
import { profileRegisterTool } from "./profile-register.js";
import { realSkillRegisterTool } from "./real-skill-register.js";
import { realSkillRefreshTool } from "./real-skill-refresh.js";
import { moveFuseTool } from "./move-fuse.js";
import { telemetryPushTool } from "./telemetry-push.js";
import { trainerQueueMatchTool } from "./trainer-queue-match.js";
import { listInvitesTool } from "./list-invites.js";
import { trainerAcceptMatchTool } from "./trainer-accept-match.js";
import { trainerGetStateTool } from "./trainer-get-state.js";
import { trainerSubmitDraftTool } from "./trainer-submit-draft.js";
import { trainerSubmitMoveTool } from "./trainer-submit-move.js";
import { matchWatchTool } from "./match-watch.js";

// Stadium substrate fix + discovery (spec-stadium-substrate-fix-and-discovery-design §1.1)
// Draft-pool discovery primitive: list all platform-registered profiles in a wiki.
import { listPlatformProfilesTool } from "./list-platform-profiles.js";

// v1.7.1 — push primitives. Four wait-for tools: single-event, first-of-N,
// fan-in-all, and bounded-batch. Each handler requires HandleWaitContext
// (bus + registry + watcher) which is populated by startStdio via buildCtx.
import { waitForTool } from "./wait-for.js";
import { waitForAnyTool } from "./wait-for-any.js";
import { waitForAllTool } from "./wait-for-all.js";
import { waitForManyTool } from "./wait-for-many.js";

// v1.9 onboarding — vault_orient state-aware next-best-action tool
import { orientTool } from "./orient.js";

export const allTools = [
  recallTool, readTool, listWikisTool, lintTool, channelTailTool,
  inboxTool, processInboxTool, newTool, newWikiTool, setActiveTool,
  synthesizeTool, reindexTool, agentJournalTool, channelPostTool, taskClaimTool,
  // v1.5
  bootstrapRepoTool, syncSkillsTool, seedSubstrateTool, startTool,
  taskCreateTool, taskListTool, taskUpdateTool, profileStatsTool, evolveProfileTool, refreshProfileMemoryTool, suggestPokemonTool,
  // new-user onboarding
  newProfileTool, newMoveTool,
  // v1.6 phase 2
  rewriteLinksTool,
  // v1.6 phase 3
  mergeQueueTool, mergeRecordTool,
  // v1.7 phase 3
  syncAgentsTool,
  // claims foundation (plan 1)
  claimTool, listClaimsTool,
  // agent-memory
  agentMemoryTool,
  // Stadium Plan B
  trainerInitTool, profileRegisterTool, realSkillRegisterTool, realSkillRefreshTool,
  moveFuseTool, telemetryPushTool, trainerQueueMatchTool, listInvitesTool,
  trainerAcceptMatchTool, trainerGetStateTool, trainerSubmitDraftTool,
  trainerSubmitMoveTool, matchWatchTool,
  // Stadium substrate fix + discovery
  listPlatformProfilesTool,
  // v1.7.1 — push primitives
  waitForTool, waitForAnyTool, waitForAllTool, waitForManyTool,
  // v1.9 onboarding
  orientTool,
];

export type ToolDefinition = (typeof allTools)[number];
