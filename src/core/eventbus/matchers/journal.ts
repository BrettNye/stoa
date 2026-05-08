import type { ParsedPage, SourceMatcher, VaultEvent } from "../types.js";

const PATH_RE = /\/wikis\/([^/]+)\/journal\/([^/]+)\.md$/;

export const journalMatcher: SourceMatcher = {
  source: "journal",
  globs: ["wikis/*/journal/*.md"],
  deriveKey(absPath: string, _vaultPath: string) {
    const m = absPath.replace(/\\/g, "/").match(PATH_RE);
    if (!m) return null;
    return { wiki: m[1], id: m[2] };
  },
  decide(parsed: ParsedPage, _prev, _changeKind) {
    const enrichment: Partial<VaultEvent> = {};
    if (typeof parsed.frontmatter.channel === "string") {
      enrichment.channel = parsed.frontmatter.channel;
    }
    return { emit: true, enrichment };
  },
};
