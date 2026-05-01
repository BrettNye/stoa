import { mkdirSync, writeFileSync, existsSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadIndex, queryWikis, type IndexedWiki } from "./index.js";

const KEBAB = /^_?[a-z0-9]+(-[a-z0-9]+)*$/;
const VALID_MODES = ["idea-map", "project-doc", "learning", "mixed"] as const;
type WikiMode = typeof VALID_MODES[number];

// Phase-2 T2-1 — accept BOTH the markdown-bold form (`**Family:** rastate`)
// emitted by `vault.new-wiki` today and the plain key:value form
// (`family: rastate`) per spec §5.1. Mirrors the regex pair already
// battle-tested in core/lint-checks/family-member-mode-drift.ts, but
// constrains the value to horizontal whitespace (no newline span) so that
// an empty `**Family:**` line followed by another `**Mode:**` line doesn't
// silently capture the next line's content as the family value.
// Note the colon-inside-bold form is `**Family:**`, NOT `**Family**:`.
const WIKI_FAMILY_LINE = /^[ \t]*(?:\*\*[ \t]*family[ \t]*:[ \t]*\*\*|family[ \t]*:)[ \t]*(.*?)[ \t]*$/im;
// v1.7 §5.7 — mirror the family regex for `mode:`, accepting the same two
// declaration shapes. Constrained to horizontal whitespace for the same
// reason (no accidental newline-spanning capture).
const WIKI_MODE_LINE = /^[ \t]*(?:\*\*[ \t]*mode[ \t]*:[ \t]*\*\*|mode[ \t]*:)[ \t]*(.*?)[ \t]*$/im;

/**
 * Reads `wikis/<wiki>/CLAUDE.md` and extracts the wiki-level metadata
 * (`family:` and `mode:`). Returns `{}` when the file is missing or
 * unreadable. Each field is omitted from the returned object when not
 * found or empty (Plan B "default to omission for back-compat" — `family`
 * and `mode` are not present in the returned object when absent, vs. `null`).
 *
 * Used by `core/reindex.ts` to surface `family` and `mode` on the
 * `IndexedWiki` summary written to `_index/wikis.json`.
 */
export function loadWikiMeta(vaultPath: string, wiki: string): { family?: string; mode?: string } {
  const claudePath = join(vaultPath, "wikis", wiki, "CLAUDE.md");
  if (!existsSync(claudePath)) return {};
  let raw: string;
  try {
    raw = readFileSync(claudePath, "utf8");
  } catch {
    return {};
  }
  const out: { family?: string; mode?: string } = {};
  const fm = raw.match(WIKI_FAMILY_LINE);
  if (fm) {
    const family = fm[1].trim();
    if (family.length > 0) out.family = family;
  }
  const mm = raw.match(WIKI_MODE_LINE);
  if (mm) {
    const mode = mm[1].trim();
    if (mode.length > 0) out.mode = mode;
  }
  return out;
}

export class WikiExistsError extends Error {
  constructor(public name: string) { super(`wiki exists: ${name}`); this.name = "WikiExistsError"; }
}

export interface ListWikisOptions {
  include_reserved?: boolean;
}

export function listWikis(vaultPath: string, opts: ListWikisOptions = {}): IndexedWiki[] {
  const all = queryWikis(loadIndex(vaultPath));
  return all.filter(w => {
    if (!w.name.startsWith("_")) return true;
    if (w.name === "_agents") return true; // always visible per v1.5
    return !!opts.include_reserved;
  });
}

const SUBFOLDERS = [
  "inbox", "ideas", "concepts", "decisions", "specs",
  "synthesis", "guides", "journal", "tasks", "sources"
];

export interface NewWikiInput {
  name: string;
  mode: WikiMode;
  scope: string;
  // Phase-2 T3-1 — optional family declaration. When set, the scaffolded
  // CLAUDE.md gets a `**Family:** <value>` line right under `**Mode:**`,
  // matching the bold-with-colon-inside form `loadWikiMeta` recognizes.
  family?: string;
}

export interface NewWikiResult {
  name: string;
  path: string;
  files_created: string[];
}

export function newWiki(vaultPath: string, input: NewWikiInput): NewWikiResult {
  if (!KEBAB.test(input.name)) throw new Error(`wiki name must be kebab-case: ${input.name}`);
  if (!VALID_MODES.includes(input.mode)) throw new Error(`invalid mode: ${input.mode}`);
  const root = join(vaultPath, "wikis", input.name);
  if (existsSync(root)) throw new WikiExistsError(input.name);

  const created: string[] = [];
  mkdirSync(root, { recursive: true });
  for (const sub of SUBFOLDERS) {
    mkdirSync(join(root, sub), { recursive: true });
  }

  // CLAUDE.md
  // Phase-2 T3-1 — emit `**Family:** <name>` between `**Mode:**` and
  // `**Scope:**` only when the caller passed family. Format intentionally
  // matches the WIKI_FAMILY_LINE regex in loadWikiMeta above so reindex
  // picks it up without manual editing.
  const familyLine = input.family ? `**Family:** ${input.family}\n` : "";
  const claudeMd = `# ${input.name} — wiki conventions\n\n**Mode:** ${input.mode}\n${familyLine}**Scope:** ${input.scope}\n\n## Tag vocabulary\n\n(Add wiki-specific tags here as they emerge.)\n\n## Local conventions\n\n(Add wiki-specific rules that extend the vault root CLAUDE.md.)\n`;
  writeFileSync(join(root, "CLAUDE.md"), claudeMd);
  created.push("CLAUDE.md");

  // map.md
  const today = new Date().toISOString().slice(0, 10);
  const mapMd = `---\nid: map-${input.name}\ntitle: "${input.name} map"\ntype: map\nwiki: ${input.name}\nstatus: active\ncreated: ${today}\nupdated: ${today}\nsummary: "Hand-curated entry point for the ${input.name} wiki."\n---\n\n# ${input.name}\n\n${input.scope}\n\n<!-- AUTO:start -->\n<!-- AUTO:end -->\n`;
  writeFileSync(join(root, "map.md"), mapMd);
  created.push("map.md");

  // index.md
  writeFileSync(join(root, "index.md"), `# ${input.name} — alphabetical index\n\n(Regenerated by reindex.)\n`);
  created.push("index.md");

  // log.md
  writeFileSync(join(root, "log.md"), `# ${input.name} — operations log\n\n- ${new Date().toISOString()} \`new-wiki\` by human:vault-owner: created wiki with mode=${input.mode}\n`);
  created.push("log.md");

  // REGISTRY.md update
  const regPath = join(vaultPath, "REGISTRY.md");
  const regLine = `- **${input.name}** (mode: ${input.mode}) — ${input.scope}\n`;
  if (!existsSync(regPath)) writeFileSync(regPath, "# Wikis\n\n" + regLine);
  else appendFileSync(regPath, regLine);

  return { name: input.name, path: root, files_created: created };
}
