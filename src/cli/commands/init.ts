import type { Command } from "commander";
import { existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { seedSubstrateTool } from "../../tools/seed-substrate.js";
import { newWiki } from "../../core/wikis.js";

export interface InitOptions {
  /** Absolute or relative path to the vault to create. */
  vaultPath: string;
  /** Allow init against a non-empty dir. */
  force?: boolean;
  /** Optional first content wiki to scaffold. */
  withWiki?: string;
  /** Mode for the optional first content wiki (default idea-map). */
  mode?: "idea-map" | "project-doc" | "learning" | "mixed";
  /** When true, print the next-steps block to stdout. CLI uses true; tests can opt-in. */
  print?: boolean;
}

export interface InitResult {
  /** Absolute, resolved path to the created vault. */
  vaultPath: string;
  /** Relative paths (or just labels) of what was created, for printing. */
  filesCreated: string[];
  /** Wiki names that exist after init (always includes `_agents`). */
  wikisCreated: string[];
  /** Active wiki value written to `.active-wiki` (empty when no content wiki). */
  activeWiki: string;
  /** Theme used during init (pokemon | plain). Present when set via -y / env. */
  theme?: "pokemon" | "plain";
}

/**
 * Programmatic entrypoint for `stoa init`. Side-effect: scaffolds a vault tree
 * at the given path. Pure data return for caller-driven printing or testing.
 *
 * Behaviour:
 *  - Resolves `vaultPath` to absolute before any FS work.
 *  - Errors if the parent dir doesn't exist (clear, no auto-create one level up).
 *  - Errors if the target exists and is non-empty and `force` is false.
 *  - Writes `_index/{pages,tokens,links,wikis}.json` with minimal valid stubs
 *    matching the shapes that `loadIndex` (core/index.ts) expects.
 *  - Calls the seed-substrate tool to copy `wikis/_agents/`.
 *  - Optionally calls `newWiki()` to scaffold a first content wiki and sets
 *    `.active-wiki` to its name.
 */
export async function initVault(opts: InitOptions): Promise<InitResult> {
  const absVaultPath = resolve(opts.vaultPath);
  const parent = dirname(absVaultPath);

  if (!existsSync(parent)) {
    throw new Error(
      `parent directory does not exist: ${parent}\n` +
      `create the parent dir first, or pick a path under an existing dir.`
    );
  }

  // Non-empty check. We treat "doesn't exist" and "exists but empty" as fine.
  if (existsSync(absVaultPath)) {
    const stat = statSync(absVaultPath);
    if (!stat.isDirectory()) {
      throw new Error(`target exists and is not a directory: ${absVaultPath}`);
    }
    const entries = readdirSync(absVaultPath);
    if (entries.length > 0 && !opts.force) {
      throw new Error(
        `target directory is not empty: ${absVaultPath}\n` +
        `pass --force to scaffold into a non-empty dir (existing files are left in place).`
      );
    }
  }

  // --- mkdir target + skeleton ---
  mkdirSync(absVaultPath, { recursive: true });

  const filesCreated: string[] = [];

  // _index stubs — match loadIndex() expectations:
  //  pages.json  -> { pages: [] }
  //  wikis.json  -> { wikis: [] }
  //  tokens.json -> {} (Record<id, PageTokens>)
  //  links.json  -> {} (Record<id, { outbound: [], inbound: [] }>)
  const indexDir = join(absVaultPath, "_index");
  mkdirSync(indexDir, { recursive: true });

  const indexFiles: Array<[string, string]> = [
    ["pages.json", JSON.stringify({ pages: [] }, null, 2) + "\n"],
    ["wikis.json", JSON.stringify({ wikis: [] }, null, 2) + "\n"],
    ["tokens.json", JSON.stringify({}, null, 2) + "\n"],
    ["links.json", JSON.stringify({}, null, 2) + "\n"],
  ];
  for (const [name, body] of indexFiles) {
    const p = join(indexDir, name);
    writeFileSync(p, body);
    filesCreated.push(`_index/${name}`);
  }

  // wikis/ root
  mkdirSync(join(absVaultPath, "wikis"), { recursive: true });
  filesCreated.push("wikis/");

  // .active-wiki (empty until --with-wiki is processed below)
  const activeWikiPath = join(absVaultPath, ".active-wiki");
  writeFileSync(activeWikiPath, "");
  filesCreated.push(".active-wiki");

  // --- Seed the substrate (wikis/_agents/) ---
  const seedResult = await seedSubstrateTool.handler(
    { vault_path: absVaultPath, force: false },
    { vaultPath: absVaultPath }
  );
  // Track copied files relative to vault root for printable summary.
  for (const f of seedResult.files_copied) {
    filesCreated.push(f.replace(absVaultPath + "\\", "").replace(absVaultPath + "/", ""));
  }

  const wikisCreated: string[] = ["_agents"];
  let activeWiki = "";

  // --- Optional first content wiki ---
  if (opts.withWiki) {
    const mode = opts.mode ?? "idea-map";
    const scope = `First content wiki for this vault.`;
    newWiki(absVaultPath, { name: opts.withWiki, mode, scope });
    wikisCreated.push(opts.withWiki);
    activeWiki = opts.withWiki;
    writeFileSync(activeWikiPath, opts.withWiki);
    filesCreated.push(`wikis/${opts.withWiki}/`);
  }

  if (opts.print) {
    printNextSteps({
      vaultPath: absVaultPath,
      filesCreated,
      wikisCreated,
      activeWiki,
    });
  }

  return {
    vaultPath: absVaultPath,
    filesCreated,
    wikisCreated,
    activeWiki,
  };
}

function printNextSteps(r: InitResult): void {
  const lines: string[] = [];
  lines.push("");
  lines.push(`Vault scaffolded at: ${r.vaultPath}`);
  lines.push("");
  lines.push("Created:");
  lines.push(`  - _index/{pages,tokens,links,wikis}.json (empty stubs)`);
  lines.push(`  - wikis/_agents/ (3 example profiles, 4 example moves, onboarding course)`);
  if (r.activeWiki) {
    lines.push(`  - wikis/${r.activeWiki}/ (set as the active wiki)`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("Next: add this to your ~/.claude/settings.json so Claude Code can use it:");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify({
    mcpServers: {
      stoa: {
        command: "stoa",
        args: ["--mcp"],
        env: { STOA_VAULT_PATH: r.vaultPath }
      }
    }
  }, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("Restart Claude Code, then in any session try:");
  lines.push(`  "List the wikis in my vault using vault_list-wikis"`);
  lines.push(`  "Capture this thought to my inbox: <whatever's on your mind>"`);
  lines.push("");
  lines.push("Read more:");
  lines.push(`  - docs/quickstart.md`);
  lines.push(`  - docs/training-program.md`);
  lines.push("");
  for (const ln of lines) console.log(ln);
}

/**
 * Non-interactive init: reads `STOA_VAULT_PATH`, `STOA_THEME`, `STOA_DEFAULT_WIKI`
 * from the environment. Falls back to sensible defaults. No prompts.
 *
 * Called by `stoa init -y` for Docker / CI scenarios (spec §12).
 */
export async function runNonInteractive(): Promise<InitResult & { theme: "pokemon" | "plain" }> {
  const vaultPath = process.env.STOA_VAULT_PATH ?? process.cwd();
  const theme = (process.env.STOA_THEME as "pokemon" | "plain" | undefined) === "plain"
    ? "plain"
    : "pokemon";
  const defaultWiki = process.env.STOA_DEFAULT_WIKI;

  const result = await initVault({
    vaultPath,
    force: true, // idempotent: allow running on an existing vault
    withWiki: defaultWiki,
    print: false,
  });

  return { ...result, theme };
}

/**
 * Commander wiring. The `bin.ts` entrypoint dispatches here without first
 * running `parseConfig`, because `init` is pre-vault setup (no STOA_VAULT_PATH
 * exists yet).
 */
export function registerInit(program: Command): void {
  program
    .command("init [vault-path]")
    .description("Scaffold a working vault at the given path (default ./vault).")
    .option("--with-wiki <name>", "create a first content wiki and set it active")
    .option("--mode <mode>", "wiki mode for --with-wiki (idea-map|project-doc|learning|mixed)", "idea-map")
    .option("--force", "allow init against a non-empty target dir", false)
    .option("-y, --yes", "accept defaults / use env vars without prompting (STOA_VAULT_PATH, STOA_THEME, STOA_DEFAULT_WIKI)")
    .action(async (vaultPath: string | undefined, opts: { withWiki?: string; mode?: InitOptions["mode"]; force?: boolean; yes?: boolean }) => {
      if (opts.yes) {
        try {
          await runNonInteractive();
        } catch (e: any) {
          process.stderr.write(`init failed: ${e?.message ?? e}\n`);
          process.exit(1);
        }
        return;
      }
      const target = vaultPath ?? join(process.cwd(), "vault");
      try {
        await initVault({
          vaultPath: target,
          force: !!opts.force,
          withWiki: opts.withWiki,
          mode: opts.mode,
          print: true,
        });
      } catch (e: any) {
        process.stderr.write(`init failed: ${e?.message ?? e}\n`);
        process.exit(1);
      }
    });
}
