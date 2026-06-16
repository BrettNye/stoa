import { recallTool } from "./recall.js";
import { readTool } from "./read.js";
import { listWikisTool } from "./list-wikis.js";
import { lintTool } from "./lint.js";
import { inboxTool } from "./inbox.js";
import { processInboxTool } from "./process-inbox.js";
import { newTool } from "./new.js";
import { newWikiTool } from "./new-wiki.js";
import { setActiveTool } from "./set-active.js";
import { synthesizeTool } from "./synthesize.js";
import { reindexTool } from "./reindex.js";
import { curateTool } from "./curate.js";
import { agentJournalTool } from "./agent-journal.js";

// v1.5 — substrate tools
import { bootstrapRepoTool } from "./bootstrap-repo.js";
// seed-substrate: copy bundled example profiles/moves/course into a fresh
// vault's wikis/_agents/. Bundled under <package>/seed/_agents/.
import { seedSubstrateTool } from "./seed-substrate.js";
import { startTool } from "./start.js";
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
// move fusion, telemetry push, queue/accept match flow, and match watch.
// See `wikis/_meta/plans/2026-05-04-stadium-plan-b-dag.md`.
import { trainerInitTool } from "./trainer-init.js";
import { profileRegisterTool } from "./profile-register.js";
import { moveFuseTool } from "./move-fuse.js";
import { telemetryPushTool } from "./telemetry-push.js";
import { trainerQueueMatchTool } from "./trainer-queue-match.js";
import { trainerAcceptMatchTool } from "./trainer-accept-match.js";
import { trainerGetStateTool } from "./trainer-get-state.js";
import { matchWatchTool } from "./match-watch.js";

// v1.9 onboarding — vault_orient state-aware next-best-action tool
import { orientTool } from "./orient.js";

// Consolidated tool families (tool-surface-family-consolidation, 2026-06-14)
// Reduces advertised surface from 55 → 43 tools (−12).

// vault_wait-for: single-event, first-of-N, fan-in-all, bounded-batch
// (replaces vault_wait-for, vault_wait-for-any, vault_wait-for-all, vault_wait-for-many)
import { waitForTool } from "./wait-for.js";

// vault_trainer-submit: draft + move submission
// (replaces vault_trainer-submit-draft, vault_trainer-submit-move)
import { trainerSubmitTool } from "./trainer-submit.js";

// vault_merge: queue surfacing + merge journal/task transition
// (replaces vault_merge-queue, vault_merge-record)
import { mergeTool } from "./merge.js";

// vault_stadium-list: invite listing + platform-profile discovery
// (replaces vault_list-invites, vault_list-platform-profiles)
import { stadiumListTool } from "./stadium-list.js";

// vault_task: create, list, update, claim
// (replaces vault_task-create, vault_task-list, vault_task-update, vault_task-claim)
import { taskTool } from "./task.js";

// vault_channel: post + tail
// (replaces vault_channel-post, vault_channel-tail)
import { channelTool } from "./channel.js";

// vault_real-skill: register + refresh
// (replaces vault_real-skill-register, vault_real-skill-refresh)
import { realSkillTool } from "./real-skill.js";

// vault_sync: skills (moveset-only deploy) + agents (full profile dispatch)
// (replaces vault_sync-skills, vault_sync-agents)
import { syncTool } from "./sync.js";

export const allTools = [
  // Core knowledge & navigation (v0)
  recallTool, readTool, listWikisTool, lintTool,
  inboxTool, processInboxTool, newTool, newWikiTool, setActiveTool,
  synthesizeTool, reindexTool, curateTool, agentJournalTool,
  // v1.5 substrate
  bootstrapRepoTool, seedSubstrateTool, startTool,
  profileStatsTool, evolveProfileTool, refreshProfileMemoryTool, suggestPokemonTool,
  // new-user onboarding
  newProfileTool, newMoveTool,
  // v1.6 phase 2
  rewriteLinksTool,
  // claims foundation (plan 1)
  claimTool, listClaimsTool,
  // agent-memory
  agentMemoryTool,
  // Stadium Plan B
  trainerInitTool, profileRegisterTool,
  moveFuseTool, telemetryPushTool, trainerQueueMatchTool,
  trainerAcceptMatchTool, trainerGetStateTool, matchWatchTool,
  // v1.9 onboarding
  orientTool,
  // Consolidated tool families (2026-06-14, −12 from 55 → 43)
  waitForTool, trainerSubmitTool, mergeTool, stadiumListTool,
  taskTool, channelTool, realSkillTool, syncTool,
];

export type ToolDefinition = (typeof allTools)[number];
