import MarkdownIt from "markdown-it";
import { resolveBodyWikilinks } from "./wikilinks.js";

const md = new MarkdownIt({ html: false, linkify: true });

export function renderNoteBody(
  body: string,
  related: string[] | undefined,
  knownIds: Set<string>,
): string {
  let html = md.render(body);
  for (const link of resolveBodyWikilinks(body, related, knownIds)) {
    const label = link.alias ?? link.targetId ?? link.raw;
    const repl = link.targetId
      ? `<a class="wikilink" data-target="${link.targetId}">${label}</a>`
      : `<span class="wikilink-dead">${label}</span>`;
    html = html.split(link.raw).join(repl);
  }
  return html;
}
