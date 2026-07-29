import { Command } from "commander";
import { readBundleItems, readBlob } from "../../core/pangolin-bundle.js";
import { updateTask } from "../../core/tasks.js";
import { readPage } from "../../core/pages.js";
import { resolveWiki } from "../../tools/_resolve-wiki.js";
import { getCtx } from "../_ctx.js";

/** `verify` -> 1, `verify~2` -> 2. Orders gate copies by circle-back attempt. */
function attemptOf(id: string): number {
  const m = /~(\d+)$/.exec(id);
  return m ? Number(m[1]) : 1;
}

export function registerTaskClose(p: Command) {
  p.command("task-close")
    .description("Write a follow-up run's outcome back onto its stoa task")
    .requiredOption("--from-bundle <path>", "bundle.json from `pangolin orch audit --out`")
    .requiredOption("--task-id <id>", "the stoa task this run was materialized from")
    .option("--storage-root <dir>", "pangolin local storage root (for verifier findings)")
    .option("--wiki <name>")
    .action(async (opts) => {
      const ctx = getCtx();
      const wiki = resolveWiki(opts.wiki, ctx.defaultWiki, ctx.vaultPath);
      const items = readBundleItems(opts.fromBundle);

      // Ids are `verify` and, after a circle-back, the gate copy `verify~N`.
      // The LAST attempt decides: an original red followed by a green copy is a success.
      const verifies = items
        .filter((i) => /^verify(~\d+)?$/.test(i.id))
        .sort((a, b) => attemptOf(a.id) - attemptOf(b.id));
      const last = verifies[verifies.length - 1];
      const green = last !== undefined && last.status === "done" && last.verify?.passed !== false;
      const status = green ? "completed" : "failed";

      let notes = `follow-up run outcome: ${status}`;
      if (opts.storageRoot) {
        const ref = last?.outputRefs?.findings;
        const findings = ref ? readBlob(ref, opts.storageRoot) : null;
        if (findings) notes += `\n\nVerifier findings:\n\n${findings}`;
      }

      const page = readPage(ctx.vaultPath, opts.taskId, wiki);
      const r = updateTask(ctx.vaultPath, {
        task_id: opts.taskId,
        wiki,
        expected_updated: page.updated,
        status,
        notes,
        agent_id: "pangolin-followup",
      });
      console.log(JSON.stringify(r, null, 2));
    });
}
