import { Command } from "commander";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pkg = require("../../package.json");
import { registerRecall } from "./commands/recall.js";
import { registerRead } from "./commands/read.js";
import { registerListWikis } from "./commands/list-wikis.js";
import { registerLint } from "./commands/lint.js";
import { registerChannelTail } from "./commands/channel-tail.js";
import { registerInbox } from "./commands/inbox.js";
import { registerProcessInbox } from "./commands/process-inbox.js";
import { registerNew } from "./commands/new.js";
import { registerNewWiki } from "./commands/new-wiki.js";
import { registerSetActive } from "./commands/set-active.js";
import { registerSynthesize } from "./commands/synthesize.js";
import { registerReindex } from "./commands/reindex.js";
import { registerAgentJournal } from "./commands/agent-journal.js";
import { registerChannelPost } from "./commands/channel-post.js";
import { registerClaimTask } from "./commands/claim-task.js";

// v1.5 — substrate commands
import { registerBootstrapRepo } from "./commands/bootstrap-repo.js";
import { registerSyncSkills } from "./commands/sync-skills.js";
import { registerSeedSubstrate } from "./commands/seed-substrate.js";
import { registerSyncAgents } from "./commands/sync-agents.js";
import { registerUi } from "./commands/ui.js";
import { registerStart } from "./commands/start.js";
import { registerTaskCreate } from "./commands/task-create.js";
import { registerTaskList } from "./commands/task-list.js";
import { registerTaskUpdate } from "./commands/task-update.js";
import { registerProfileStats } from "./commands/profile-stats.js";
import { registerEvolveProfile } from "./commands/evolve-profile.js";
import { registerRefreshProfileMemory } from "./commands/refresh-profile-memory.js";
import { registerSuggestPokemon } from "./commands/suggest-pokemon.js";
import { registerAgentMemory } from "./commands/agent-memory.js";

// New-user onboarding (feat/new-user-onboarding) — substrate-aware
// scaffolding commands mirroring the new-profile / new-move MCP tools.
import { registerNewProfile } from "./commands/new-profile.js";
import { registerNewMove } from "./commands/new-move.js";
import { registerInit } from "./commands/init.js";

// v1.9 onboarding — interactive setup + state-aware next-best-action
import { registerOnboard } from "./commands/onboard.js";
import { registerOrient } from "./commands/orient.js";

// v0.4 server-mode
import { registerServeCommand } from "./commands/serve.js";
import { registerMintTokenCommand } from "./commands/mint-token.js";
import { registerGraph } from "./commands/graph.js";

// vault_curate — autonomous status curation
import { registerCurate } from "./commands/curate.js";

export function buildCli(): Command {
  const program = new Command()
    .name("vault")
    .description("Vault CLI — manage the knowledge vault from any directory")
    .version(pkg.version);

  registerRecall(program);
  registerRead(program);
  registerListWikis(program);
  registerLint(program);
  registerChannelTail(program);
  registerInbox(program);
  registerProcessInbox(program);
  registerNew(program);
  registerNewWiki(program);
  registerSetActive(program);
  registerSynthesize(program);
  registerReindex(program);
  registerAgentJournal(program);
  registerChannelPost(program);
  registerClaimTask(program);

  // v1.5
  registerBootstrapRepo(program);
  registerSyncSkills(program);
  registerSeedSubstrate(program);
  registerSyncAgents(program);
  registerUi(program);
  registerStart(program);
  registerTaskCreate(program);
  registerTaskList(program);
  registerTaskUpdate(program);
  registerProfileStats(program);
  registerEvolveProfile(program);
  registerRefreshProfileMemory(program);
  registerSuggestPokemon(program);
  registerAgentMemory(program);

  // new-user onboarding
  registerNewProfile(program);
  registerNewMove(program);
  registerInit(program);

  // v1.9 onboarding
  registerOnboard(program);
  registerOrient(program);

  // v0.4 server-mode
  registerServeCommand(program);
  registerMintTokenCommand(program);
  registerGraph(program);

  // vault_curate — autonomous status curation
  registerCurate(program);

  return program;
}
