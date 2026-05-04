/**
 * core/resolve-trainer-context — centralized trainer + wiki resolution.
 *
 * Per spec §2 of spec-stadium-substrate-fix-and-discovery-design.md.
 *
 * Resolution priority:
 *   1. Explicit `trainer:` arg on the tool call.
 *   2. `STADIUM_TRAINER` env var.
 *   3. `~/.vault/stadium.toml` `active = "<slug>"` at root.
 *   4. Error `NO_ACTIVE_TRAINER`.
 *
 * The trainer page is found by walking registered wikis (from _index/wikis.json)
 * looking for `wikis/<wiki>/trainers/trainer-<slug>.md`. Result is memoized
 * per-process and invalidated on the toml's mtime change.
 */

import { statSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseFrontmatter } from "./frontmatter.js";
import { loadIndex } from "./index.js";

// ─── Public types ────────────────────────────────────────────────────────────

export type TrainerContext = {
  trainerSlug: string;
  trainerId: string;
  wiki: string;
};

export class TrainerContextError extends Error {
  constructor(
    public code: "NO_ACTIVE_TRAINER" | "TRAINER_NOT_FOUND" | "TRAINER_WIKI_UNSET",
    message: string
  ) {
    super(message);
    this.name = "TrainerContextError";
  }
}

// ─── Options (for testability) ────────────────────────────────────────────────

export interface ResolveTrainerContextOpts {
  /** Override ~/.vault/stadium.toml lookup root. Mirrors stadium-config pattern. */
  home?: string;
  /** Override VAULT_PATH for finding trainer pages. */
  vaultPath?: string;
}

// ─── Process-level cache ──────────────────────────────────────────────────────

interface TrainerCache {
  byMtime: number;
  /** Map of slug → context (loaded from disk). */
  bySlug: Map<string, TrainerContext>;
  /** Active slug from toml, if present. */
  activeSlug: string | undefined;
  /** The toml path used to build this cache entry (used for key equality). */
  tomlPath: string;
  /** The vault path used to build this cache entry. */
  vaultPath: string;
}

// Keyed by `${tomlPath}::${vaultPath}` so that tests using different dirs
// get isolated cache entries without module-level state leaking between tests.
const cacheMap = new Map<string, TrainerCache>();

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Resolves the active trainer context.
 *
 * @param args  - Optional `trainer` slug override (highest priority).
 * @param opts  - Optional overrides for home dir and vault path (testability).
 */
export function resolveTrainerContext(
  args: { trainer?: string } = {},
  opts: ResolveTrainerContextOpts = {}
): TrainerContext {
  const home = opts.home ?? process.env.STADIUM_HOME ?? homedir();
  const vaultPath = opts.vaultPath ?? process.env.VAULT_PATH;

  const tomlPath = join(home, ".vault", "stadium.toml");
  const mtime = safeMtime(tomlPath);

  // Cache key combines toml path + vault path to isolate test instances.
  const cacheKey = `${tomlPath}::${vaultPath ?? ""}`;
  let cache = cacheMap.get(cacheKey);
  if (!cache || cache.byMtime !== mtime) {
    const activeSlug = readActiveSlug(tomlPath);
    const bySlug = vaultPath
      ? loadTrainerPages(vaultPath)
      : new Map<string, TrainerContext>();
    cache = {
      byMtime: mtime,
      bySlug,
      activeSlug,
      tomlPath,
      vaultPath: vaultPath ?? "",
    };
    cacheMap.set(cacheKey, cache);
  }

  // Resolve slug per priority: explicit arg > STADIUM_TRAINER env > toml active
  const slug =
    (args.trainer ?? "").trim() ||
    (process.env.STADIUM_TRAINER ?? "").trim() ||
    cache.activeSlug;

  if (!slug) {
    throw new TrainerContextError(
      "NO_ACTIVE_TRAINER",
      "NO_ACTIVE_TRAINER: No trainer resolved. Provide one of: explicit `trainer:` arg on the tool call, " +
        "`STADIUM_TRAINER` env var, or `active = \"<slug>\"` in ~/.vault/stadium.toml."
    );
  }

  const ctx = cache.bySlug.get(slug);
  if (!ctx) {
    throw new TrainerContextError(
      "TRAINER_NOT_FOUND",
      `TRAINER_NOT_FOUND: No trainer-${slug}.md found in any registered wiki.`
    );
  }

  if (!ctx.wiki) {
    throw new TrainerContextError(
      "TRAINER_WIKI_UNSET",
      `TRAINER_WIKI_UNSET: Trainer ${slug} has no wiki: frontmatter; pass explicit wiki: arg.`
    );
  }

  return ctx;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function safeMtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Reads the `active = "<slug>"` root-level key from `~/.vault/stadium.toml`.
 * Returns undefined when the file is absent or has no `active` key.
 * Only reads keys above the first section header (root-level only).
 */
function readActiveSlug(tomlPath: string): string | undefined {
  if (!existsSync(tomlPath)) return undefined;
  let content: string;
  try {
    content = readFileSync(tomlPath, "utf8");
  } catch {
    return undefined;
  }
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) break; // entering a section; stop reading root-level keys
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (key !== "active") continue;
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      const q = value[0];
      const close = value.indexOf(q, 1);
      value = close > 0 ? value.slice(1, close) : value.slice(1);
    }
    return value || undefined;
  }
  return undefined;
}

/**
 * Walks all registered wikis (from `_index/wikis.json`) looking for
 * `wikis/<wiki>/trainers/trainer-<slug>.md`. Builds a Map<slug, TrainerContext>.
 *
 * Fails gracefully: missing or unreadable index → empty map (TRAINER_NOT_FOUND
 * is raised by the caller when the slug is not found).
 */
function loadTrainerPages(vaultPath: string): Map<string, TrainerContext> {
  const result = new Map<string, TrainerContext>();

  let wikiNames: string[];
  try {
    const idx = loadIndex(vaultPath);
    wikiNames = idx.wikis.map((w) => w.name);
  } catch {
    return result;
  }

  for (const wiki of wikiNames) {
    const trainersDir = join(vaultPath, "wikis", wiki, "trainers");
    if (!existsSync(trainersDir)) continue;

    let entries: string[];
    try {
      entries = readdirSync(trainersDir);
    } catch {
      continue;
    }

    for (const filename of entries) {
      const match = filename.match(/^trainer-(.+)\.md$/);
      if (!match) continue;
      const slug = match[1];
      const filePath = join(trainersDir, filename);

      let frontmatter: Record<string, any>;
      try {
        const raw = readFileSync(filePath, "utf8");
        ({ frontmatter } = parseFrontmatter(raw));
      } catch {
        continue; // skip unparseable files
      }

      const trainerId = String(frontmatter.trainer_id ?? "");
      const wikiField = String(frontmatter.wiki ?? "");

      result.set(slug, {
        trainerSlug: slug,
        trainerId,
        wiki: wikiField,
      });
    }
  }

  return result;
}
