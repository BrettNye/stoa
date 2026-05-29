import type { GraphNode } from "@stoa/types/graph";
import { WIKI_NODE_TYPE } from "../nav/visible-graph.js";
import { renderNoteBody } from "../panel/render.js";
import { el } from "./dom.js";

export interface PanelDeps {
  /** Re-select a node (wikilink clicks inside the body delegate here). */
  onSelect: (id: string) => void;
  /** Known page ids, so renderNoteBody can mark dead wikilinks. */
  getKnownIds: () => Set<string>;
  /** Fetch a note's raw markdown, or null if unavailable. */
  fetchBody: (node: GraphNode) => Promise<string | null>;
}

export interface Panel {
  /** Root element; the caller appends it to the document. */
  readonly element: HTMLElement;
  /** Open the slide-in detail panel for a node (no-op for super-nodes). */
  open(node: GraphNode): Promise<void>;
}

/** Slide-in note detail panel: title, metadata, tags, rendered markdown body. */
export function createPanel(deps: PanelDeps): Panel {
  const element = el("div", { class: "panel" });
  const close = el("button", { class: "panel-close", type: "button" }, "×");
  close.addEventListener("click", () => element.classList.remove("open"));
  const title = el("h1");
  const meta = el("div", { class: "panel-meta" });
  const bodyEl = el("div", { class: "panel-body" });
  element.appendChild(close);
  element.appendChild(title);
  element.appendChild(meta);
  element.appendChild(bodyEl);

  // Delegate wikilink clicks inside the body to re-select that node.
  bodyEl.addEventListener("click", (ev) => {
    const target = (ev.target as HTMLElement).closest(".wikilink[data-target]");
    if (!target) return;
    ev.preventDefault();
    const id = target.getAttribute("data-target");
    if (id) deps.onSelect(id);
  });

  async function open(node: GraphNode): Promise<void> {
    if (node.type === WIKI_NODE_TYPE) return;

    title.textContent = node.title || node.id;
    meta.innerHTML = "";
    meta.appendChild(
      document.createTextNode(
        `${node.type} · ${node.wiki} · ${node.status}` +
          (node.updated ? ` · ${node.updated}` : ""),
      ),
    );
    if (node.tags.length) {
      const tagWrap = el("div");
      for (const t of node.tags) tagWrap.appendChild(el("span", { class: "tag" }, t));
      meta.appendChild(tagWrap);
    }

    element.classList.add("open");

    const body = await deps.fetchBody(node);
    if (body !== null) {
      bodyEl.innerHTML = renderNoteBody(body, undefined, deps.getKnownIds());
    } else {
      // Could not load the markdown: show summary metadata only.
      bodyEl.innerHTML = "";
      bodyEl.appendChild(el("p", {}, node.summary || "(no body available)"));
    }
  }

  return { element, open };
}
