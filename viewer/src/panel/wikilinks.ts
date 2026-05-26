import { extractWikilinks } from "@stoa/core/wikilinks";

export interface ResolvedLink {
  raw: string;
  targetId: string | null;
  alias?: string;
}

export function resolveBodyWikilinks(
  body: string,
  related: string[] | undefined,
  knownIds: Set<string>,
): ResolvedLink[] {
  return extractWikilinks(body, related).map((ref) => ({
    raw: ref.raw,
    alias: ref.alias,
    targetId: knownIds.has(ref.id) ? ref.id : null,
  }));
}
