import { Command } from "commander";
import { readBundleItems, readBlob } from "../../core/pangolin-bundle.js";
import { renderFourSection, validateEnvelope, type ConcernsEnvelope } from "../../core/four-section.js";
import { canonicalizeLockPath } from "../../core/lock-path.js";
import { checkTaskReadiness } from "../../core/task-readiness.js";
import { createTask, findTaskOnDisk } from "../../core/tasks.js";
import { slugify } from "../../core/ids.js";
import { resolveWiki } from "../../tools/_resolve-wiki.js";
import { getCtx } from "../_ctx.js";

export function registerTaskImport(p: Command) {
  p.command("task-import")
    .description("Harvest implementer concerns from a pangolin audit bundle into the task backlog")
    .requiredOption("--from-bundle <path>", "bundle.json from `pangolin orch audit --out`")
    .requiredOption("--storage-root <dir>", "pangolin local storage root")
    .option("--wiki <name>")
    .option("--json")
    .action(async (opts) => {
      const ctx = getCtx();
      const wiki = resolveWiki(opts.wiki, ctx.defaultWiki, ctx.vaultPath);
      const created: string[] = [];
      const skipped: { id: string; why: string }[] = [];

      for (const item of readBundleItems(opts.fromBundle)) {
        const ref = item.status === "done" ? item.outputRefs?.concerns : undefined;
        if (!ref) continue;
        const raw = readBlob(ref, opts.storageRoot);
        if (raw === null) { skipped.push({ id: item.id, why: "blob unreadable" }); continue; }

        let parsed: unknown;
        try { parsed = JSON.parse(raw); }
        catch { skipped.push({ id: item.id, why: "malformed JSON" }); continue; }

        const errs = validateEnvelope(parsed);
        if (errs.length) { skipped.push({ id: item.id, why: errs.join("; ") }); continue; }

        const envelope = parsed as ConcernsEnvelope;
        for (const c of envelope.concerns) {
          try {
            const body = renderFourSection(c);
            const readiness = checkTaskReadiness(body);
            if (!readiness.ready) {
              skipped.push({ id: c.title, why: `not ready: ${readiness.missing.join(", ")}` });
              continue;
            }
            // Must agree exactly with createTask's id derivation (src/core/tasks.ts,
            // which calls sharedSlugify(title, 80)) — otherwise this pre-check looks
            // up an id that will never exist on disk, and re-running the import
            // creates duplicates under the id createTask actually assigns.
            const id = `task-${slugify(c.title, 80)}`;
            if (findTaskOnDisk(ctx.vaultPath, id)) { skipped.push({ id, why: "already exists" }); continue; }
            const r = createTask(ctx.vaultPath, {
              title: c.title, wiki, body,
              segregation: (c.files ?? []).map(canonicalizeLockPath),
            });
            created.push(r.id);
          } catch (e) {
            skipped.push({ id: c.title ?? item.id, why: (e as Error).message });
          }
        }
      }

      if (opts.json) return console.log(JSON.stringify({ created, skipped }, null, 2));
      console.log(`created ${created.length}, skipped ${skipped.length}`);
      for (const s of skipped) console.log(`  skipped ${s.id}: ${s.why}`);
    });
}
