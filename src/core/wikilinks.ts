/**
 * Vault-root absolute wikilink extractor.
 *
 * Walks a page's body and frontmatter `related:` array for wikilinks of the
 * form `[[wikis/<wiki>/<type>/<id>(|alias)?]]`. Code-fence-aware: links inside
 * fenced ``` blocks are skipped. Malformed wikilinks (missing pieces or not in
 * vault-root absolute form) are skipped silently.
 *
 * Single Responsibility: extract structured link references. Integrity checking
 * (does the target page exist? does the wiki exist?) is the consumer's job —
 * see `lint-checks/cross-wiki-link-broken.ts`.
 *
 * Trade-offs (acceptable, documented):
 *   - Top-level fenced blocks are stripped. Indented fenced blocks (e.g. nested
 *     inside a list item with 4-space indent) are NOT stripped, so a wikilink
 *     inside such a block would be returned. This matches Plan A's locked
 *     "simple two-pass approach" and is acceptable for v1.6 Phase 1.
 *   - Inline single-backtick code spans are NOT stripped. A wikilink inside
 *     `like this` will be returned. Plan A does not require this.
 */

export interface WikilinkRef {
  raw: string;
  wiki: string;
  type: string;
  id: string;
  alias?: string;
  source: "body" | "frontmatter";
}

// Top-level fenced code block: opening ``` (optionally followed by an
// info-string) at start-of-line, then any content, then closing ``` at
// start-of-line. Preserves newlines so line-number context isn't shifted
// (important if callers grow to report line numbers later).
const FENCE_RE = /^```[^\n]*\n([\s\S]*?)\n```$/gm;

// Vault-root absolute wikilink. Capture groups:
//   1: wiki segment
//   2: type segment
//   3: id segment
//   4: optional alias (text after |)
//
// `[^\/\]|]+` for the first three segments forbids `/`, `]`, and `|` so we
// don't span past separators or close-brackets. Using `[^|\]]+?` (non-greedy)
// for the id lets the alias group bind correctly when present.
const WIKILINK_RE = /\[\[wikis\/([^\/\]|]+)\/([^\/\]|]+)\/([^|\]]+?)(?:\|([^\]]+))?\]\]/g;

function stripFencedBlocks(content: string): string {
  // Replace each fenced block's inner content with an equivalent number of
  // blank lines. The opening and closing ``` markers themselves are also
  // blanked. This preserves total line count.
  return content.replace(FENCE_RE, (match) => {
    const newlineCount = (match.match(/\n/g) ?? []).length;
    return "\n".repeat(newlineCount);
  });
}

function parseSingleWikilink(text: string, source: "body" | "frontmatter"): WikilinkRef | null {
  // Anchored variant — caller has isolated a single candidate string.
  const re = /^\[\[wikis\/([^\/\]|]+)\/([^\/\]|]+)\/([^|\]]+?)(?:\|([^\]]+))?\]\]$/;
  const m = re.exec(text.trim());
  if (!m) return null;
  const [raw, wiki, type, id, alias] = m;
  const ref: WikilinkRef = {
    raw,
    wiki,
    type,
    id,
    source
  };
  if (alias !== undefined) ref.alias = alias;
  return ref;
}

export function extractWikilinks(
  rawPageContent: string,
  frontmatterRelated?: string[]
): WikilinkRef[] {
  const out: WikilinkRef[] = [];

  // Body pass — strip fenced blocks first, then scan.
  const stripped = stripFencedBlocks(rawPageContent);
  // Reset regex state (g-flag is stateful).
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(stripped)) !== null) {
    const [raw, wiki, type, id, alias] = m;
    const ref: WikilinkRef = {
      raw,
      wiki,
      type,
      id,
      source: "body"
    };
    if (alias !== undefined) ref.alias = alias;
    out.push(ref);
  }

  // Frontmatter pass — each `related:` entry is itself a wikilink string.
  if (frontmatterRelated && frontmatterRelated.length > 0) {
    for (const entry of frontmatterRelated) {
      if (typeof entry !== "string") continue;
      const ref = parseSingleWikilink(entry, "frontmatter");
      if (ref) out.push(ref);
    }
  }

  return out;
}
