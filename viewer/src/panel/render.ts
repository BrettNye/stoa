import MarkdownIt from "markdown-it";
import { resolveBodyWikilinks } from "./wikilinks.js";

const md = new MarkdownIt({ html: false });

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderNoteBody(
  body: string,
  related: string[] | undefined,
  knownIds: Set<string>,
): string {
  let html = md.render(body);
  for (const link of resolveBodyWikilinks(body, related, knownIds)) {
    // prefer alias, then resolved id, else the raw token
    const label = link.alias ?? link.targetId ?? link.raw;
    const repl = link.targetId
      ? `<a class="wikilink" data-target="${esc(link.targetId)}">${esc(label)}</a>`
      : `<span class="wikilink-dead">${esc(label)}</span>`;
    html = html.split(link.raw).join(repl);
  }
  return html;
}
