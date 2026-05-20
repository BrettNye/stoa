import { z } from "zod";
import {
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { upsertPage } from "../core/index.js";

const Input = z.object({
  // Optional — falls back to ctx.vaultPath. The override is useful for callers
  // that want to seed a vault other than the active one (e.g. one-shot setups
  // of a new clone before `vault start` ever runs).
  vault_path: z.string().optional(),
  // When false (default), pre-existing target files are left alone and tracked
  // in `files_skipped[]`. When true, they are overwritten.
  force: z.boolean().default(false),
});

/**
 * Resolve the directory containing the bundled seed `_agents/` tree.
 *
 * The seed lives at `<package-root>/seed/_agents/`. Both dev (`src/tools/...`)
 * and production (`dist/tools/...`) are two directories deep from the package
 * root, so the same `../../seed/_agents` traversal works in either layout.
 *
 * Tests inject a fake source via `__setSeedSourceForTesting`.
 */
let _seedSourceOverride: string | null = null;

export function __setSeedSourceForTesting(path: string | null): void {
  _seedSourceOverride = path;
}

function resolveSeedSource(): string {
  if (_seedSourceOverride !== null) return _seedSourceOverride;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // src/tools/seed-substrate.ts -> src/tools -> src -> package root
  // dist/tools/seed-substrate.js -> dist/tools -> dist -> package root
  return join(__dirname, "..", "..", "seed", "_agents");
}

/**
 * Recursively enumerate every file under `dir`, returning absolute paths.
 */
function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const entry of readdirSync(cur)) {
      const full = join(cur, entry);
      const st = statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (st.isFile()) out.push(full);
    }
  }
  return out;
}

export const seedSubstrateTool = {
  name: "vault_seed-substrate",
  description:
    "Copy stoa's bundled seed substrate (example profiles, moves, and onboarding course) into <vault>/wikis/_agents/. Use this on a fresh vault to get a working starting set. Idempotent — won't overwrite existing files unless force=true.",
  inputSchema: Input,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string }
  ): Promise<{
    files_copied: string[];
    files_skipped: string[];
    target_dir: string;
  }> => {
    const vaultPath = input.vault_path ?? ctx.vaultPath;
    const targetDir = join(vaultPath, "wikis", "_agents");
    const seedSource = resolveSeedSource();

    if (!existsSync(seedSource)) {
      throw new Error(
        `SEED_SOURCE_MISSING: bundled seed directory not found at ${seedSource}`
      );
    }

    mkdirSync(targetDir, { recursive: true });

    const sourceFiles = listFilesRecursive(seedSource);
    const filesCopied: string[] = [];
    const filesSkipped: string[] = [];
    const writtenPagePaths: string[] = [];

    for (const src of sourceFiles) {
      const rel = relative(seedSource, src);
      const dst = join(targetDir, rel);

      if (existsSync(dst) && !input.force) {
        filesSkipped.push(dst);
        continue;
      }

      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      filesCopied.push(dst);

      // Track markdown pages (excluding SKILL.md moves — those are skill files
      // not vault pages; upsertPage parses for an `id:` field and SKILL.md
      // moves carry one, so they're indexable too). We upsert every .md the
      // copy landed so the index reflects new content without a manual
      // reindex. upsertPage is a no-op for malformed/missing frontmatter.
      if (rel.endsWith(".md")) {
        writtenPagePaths.push(dst);
      }
    }

    for (const p of writtenPagePaths) {
      await upsertPage(vaultPath, p);
    }

    return {
      files_copied: filesCopied,
      files_skipped: filesSkipped,
      target_dir: targetDir,
    };
  },
};
