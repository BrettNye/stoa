/**
 * Pure logic for bulk wikilink prefix rewriting across page content.
 *
 * The MCP tool layer (`tools/rewrite-links.ts`, Wave 3 Task 3-5) handles file
 * IO + reindex orchestration; this module is IO-free and deterministic.
 *
 * Match rule: any wikilink whose path begins with `from_prefix` (raw match,
 * NOT regex). Replace just the prefix; trailing path segments and aliases are
 * preserved verbatim.
 *
 * Fence safety: body wikilinks inside top-level ``` fenced code blocks are
 * NOT rewritten. We replicate the two-pass strip pattern from
 * `core/wikilinks.ts` rather than import its private helper — semantics are
 * locked to the same fence regex so behaviour matches the lint check.
 *
 * Idempotency: running twice with the same args is a no-op once links are
 * rewritten. The matcher only finds `from_prefix`; once rewritten, subsequent
 * passes produce zero matches and the function returns null.
 */

export interface RewriteScope {
  body: boolean;
  frontmatter: boolean;
}

export interface PageRewrite {
  page_id: string;
  links_rewritten: number;
  /** Body with rewrites applied (only meaningful when body in scope; otherwise === input body). */
  new_body: string;
  /** Frontmatter `related:` rewritten (only set when frontmatter in scope AND original related was provided). */
  new_related: string[] | undefined;
}

// Top-level fenced code block, mirrors core/wikilinks.ts FENCE_RE so semantics
// match the lint check / extractWikilinks. Matches ``` at start-of-line, then
// content (any), then closing ``` at start-of-line.
const FENCE_RE = /^```[^\n]*\n[\s\S]*?\n```$/gm;

/**
 * Wikilink shape: `[[<path>(|alias)?]]` — `<path>` may not contain `|` or `]`.
 * Capture group 1 is the path (used for prefix match).
 * Capture group 2 (optional) is the alias (preserved verbatim if present).
 */
const WIKILINK_GLOBAL_RE = /\[\[([^|\]]+)(\|[^\]]+)?\]\]/g;

/**
 * Anchored variant for parsing a single frontmatter related: entry.
 */
const WIKILINK_ANCHORED_RE = /^\[\[([^|\]]+)(\|[^\]]+)?\]\]$/;

export function normalizeScopes(
  scopes: ("body" | "frontmatter" | "all")[]
): RewriteScope {
  let body = false;
  let frontmatter = false;
  for (const s of scopes) {
    if (s === "all") {
      body = true;
      frontmatter = true;
    } else if (s === "body") {
      body = true;
    } else if (s === "frontmatter") {
      frontmatter = true;
    }
  }
  return { body, frontmatter };
}

/**
 * Splits content into alternating segments: [non-fenced, fenced, non-fenced, ...].
 * Fenced segments include their opening/closing ``` lines and content; we never
 * modify them. Total reassembly preserves the original string byte-for-byte
 * (modulo intentional rewrites in non-fenced segments).
 */
function splitFenceSegments(content: string): { text: string; fenced: boolean }[] {
  const segments: { text: string; fenced: boolean }[] = [];
  // Reset regex state — g-flag is stateful.
  FENCE_RE.lastIndex = 0;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(content)) !== null) {
    if (m.index > cursor) {
      segments.push({ text: content.slice(cursor, m.index), fenced: false });
    }
    segments.push({ text: m[0], fenced: true });
    cursor = m.index + m[0].length;
  }
  if (cursor < content.length) {
    segments.push({ text: content.slice(cursor), fenced: false });
  }
  // Edge case: empty input or content with no segments at all.
  if (segments.length === 0 && content.length === 0) {
    segments.push({ text: "", fenced: false });
  }
  return segments;
}

/**
 * Rewrites a single non-fenced text segment in place. Returns the rewritten
 * text plus the count of links rewritten. Only wikilinks whose path begins
 * with `fromPrefix` (raw string prefix, not regex) are touched.
 */
function rewriteSegment(
  segment: string,
  fromPrefix: string,
  toPrefix: string
): { text: string; count: number } {
  let count = 0;
  const rewritten = segment.replace(WIKILINK_GLOBAL_RE, (match, path: string, aliasPart: string | undefined) => {
    if (typeof path !== "string" || !path.startsWith(fromPrefix)) {
      return match;
    }
    count += 1;
    const newPath = toPrefix + path.slice(fromPrefix.length);
    return aliasPart ? `[[${newPath}${aliasPart}]]` : `[[${newPath}]]`;
  });
  return { text: rewritten, count };
}

function rewriteRelatedEntry(
  entry: string,
  fromPrefix: string,
  toPrefix: string
): { text: string; matched: boolean } {
  // Only rewrite if the entry is itself a single anchored wikilink whose path
  // starts with fromPrefix. Other shapes (empty string, prose, malformed) are
  // passed through verbatim.
  const m = WIKILINK_ANCHORED_RE.exec(entry);
  if (!m) return { text: entry, matched: false };
  const path = m[1];
  const aliasPart = m[2];
  if (!path.startsWith(fromPrefix)) return { text: entry, matched: false };
  const newPath = toPrefix + path.slice(fromPrefix.length);
  const newRaw = aliasPart ? `[[${newPath}${aliasPart}]]` : `[[${newPath}]]`;
  return { text: newRaw, matched: true };
}

export function rewritePageLinks(
  pageId: string,
  body: string,
  related: string[] | undefined,
  fromPrefix: string,
  toPrefix: string,
  scope: RewriteScope
): PageRewrite | null {
  let totalRewrites = 0;

  // Body pass — only when scope.body. Walk fence-aware segments.
  let newBody = body;
  if (scope.body) {
    const segments = splitFenceSegments(body);
    let bodyChanged = false;
    const out: string[] = [];
    for (const seg of segments) {
      if (seg.fenced) {
        out.push(seg.text);
        continue;
      }
      const { text, count } = rewriteSegment(seg.text, fromPrefix, toPrefix);
      if (count > 0) {
        bodyChanged = true;
        totalRewrites += count;
      }
      out.push(text);
    }
    if (bodyChanged) {
      newBody = out.join("");
    }
  }

  // Frontmatter pass — only when scope.frontmatter AND original related defined.
  let newRelated: string[] | undefined = undefined;
  if (scope.frontmatter && related !== undefined) {
    let relatedChanged = false;
    const rewrittenRelated: string[] = [];
    for (const entry of related) {
      if (typeof entry !== "string") {
        // Pass through non-string entries verbatim — caller's schema problem.
        rewrittenRelated.push(entry as unknown as string);
        continue;
      }
      const { text, matched } = rewriteRelatedEntry(entry, fromPrefix, toPrefix);
      if (matched) {
        relatedChanged = true;
        totalRewrites += 1;
      }
      rewrittenRelated.push(text);
    }
    if (relatedChanged) {
      newRelated = rewrittenRelated;
    }
  }

  if (totalRewrites === 0) {
    return null;
  }

  return {
    page_id: pageId,
    links_rewritten: totalRewrites,
    new_body: newBody,
    new_related: newRelated
  };
}
