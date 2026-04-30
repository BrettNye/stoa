import { Command } from "commander";
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
import { registerStart } from "./commands/start.js";
import { registerTaskCreate } from "./commands/task-create.js";
import { registerTaskList } from "./commands/task-list.js";
import { registerTaskUpdate } from "./commands/task-update.js";
import { registerProfileStats } from "./commands/profile-stats.js";

export function buildCli(): Command {
  const program = new Command()
    .name("vault")
    .description("Vault CLI — manage the knowledge vault from any directory");

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
  registerStart(program);
  registerTaskCreate(program);
  registerTaskList(program);
  registerTaskUpdate(program);
  registerProfileStats(program);

  return program;
}
