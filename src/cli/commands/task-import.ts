import { Command } from "commander";
import { readBundleItems, readBlob } from "../../core/pangolin-bundle.js";
import { renderFourSection, validateEnvelope, type ConcernsEnvelope } from "../../core/four-section.js";
import { canonicalizeLockPath } from "../../core/lock-path.js";
import { checkTaskReadiness } from "../../core/task-readiness.js";
import { createTask, findTaskOnDisk } from "../../core/tasks.js";
import { slugify } from "../../core/ids.js";
import { resolveWiki } from "../../tools/_resolve-wiki.js";
import { getCtx } from "../_ctx.js";

const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * `validateEnvelope` (core/four-section.ts) only checks `schemaVersion` and that
 * `concerns` is an array — it does not validate individual concerns, so a
 * concern missing `scope`/`out_of_scope`/`verification` renders via
 * `renderFourSection` with those headings present but empty underneath
 * (Array.join coerces `undefined` to `""`, so nothing throws), passes
 * `checkTaskReadiness` (which only pattern-matches on the static headings),
 * and would otherwise become a live backlog task with no error and no log
 * line. Every producer-supplied concern must pass this field check before it
 * ever reaches the renderer.
 * Returns the name of the first missing/empty field, or null if the concern
 * is well-formed.
 */
function findConcernFieldError(c: unknown): string | null {
  const rec = c as Record<string, unknown> | null | undefined;
  if (!rec || typeof rec !== "object") return "concern is not an object";
  if (!nonEmptyString(rec.title)) return "missing or empty field: title";
  if (
    !Array.isArray(rec.files) ||
    rec.files.length === 0 ||
    !rec.files.every((f) => nonEmptyString(f))
  ) {
    return "missing or empty field: files";
  }
  if (!nonEmptyString(rec.scope)) return "missing or empty field: scope";
  if (!nonEmptyString(rec.out_of_scope)) return "missing or empty field: out_of_scope";
  if (!nonEmptyString(rec.verification)) return "missing or empty field: verification";
  return null;
}

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
        for (const [i, c] of envelope.concerns.entries()) {
          const fieldErr = findConcernFieldError(c);
          if (fieldErr) {
            const label = nonEmptyString((c as { title?: unknown } | null)?.title)
              ? (c as { title: string }).title
              : `${item.id}[${i}]`;
            skipped.push({ id: label, why: fieldErr });
            continue;
          }
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
            skipped.push({ id: c.title ?? `${item.id}[${i}]`, why: (e as Error).message });
          }
        }
      }

      if (opts.json) return console.log(JSON.stringify({ created, skipped }, null, 2));
      console.log(`created ${created.length}, skipped ${skipped.length}`);
      for (const s of skipped) console.log(`  skipped ${s.id}: ${s.why}`);
    });
}
