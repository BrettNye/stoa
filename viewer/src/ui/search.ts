import type { GraphNode } from "@stoa/types/graph";
import { rankNodes } from "../search/rank.js";
import { el } from "./dom.js";

export interface SearchDeps {
  /** All nodes to search over (the full graph). */
  getNodes: () => GraphNode[];
  /** Light up matching node ids on the canvas, or clear with null. */
  onHighlight: (ids: Set<string> | null) => void;
  /** Open/fly to a node when a result row is clicked. */
  onSelect: (id: string) => void;
  /** Max results to show (default 20). */
  limit?: number;
}

export interface Search {
  /** Root element; the caller appends it to the document. */
  readonly element: HTMLElement;
}

/** Search box + results dropdown; highlights matches on the canvas as you type. */
export function createSearch(deps: SearchDeps): Search {
  const limit = deps.limit ?? 20;
  const element = el("div", { class: "search" });
  const input = el("input", {
    type: "search",
    placeholder: "Search… (e.g. type:decision, tag:recipe)",
  }) as HTMLInputElement;
  const results = el("div", { class: "search-results" });
  element.appendChild(input);
  element.appendChild(results);

  function render(query: string): void {
    results.innerHTML = "";
    const q = query.trim();
    if (!q) {
      // Cleared query: drop the canvas highlight so all nodes return to normal.
      deps.onHighlight(null);
      return;
    }
    const nodes = deps.getNodes();
    const hits = rankNodes(q, nodes, limit);
    // Light up every matching node on the canvas; dim the rest.
    deps.onHighlight(new Set(hits.map((h) => h.id)));
    for (const hit of hits) {
      const node = nodes.find((n) => n.id === hit.id);
      if (!node) continue;
      const row = el("div", { class: "hit" });
      row.appendChild(el("div", {}, node.title || node.id));
      row.appendChild(el("div", { class: "meta" }, `${node.type} · ${node.wiki}`));
      row.addEventListener("click", () => {
        deps.onSelect(node.id);
        results.innerHTML = "";
        input.value = "";
        // Input is now empty: drop the highlight so the canvas is undimmed.
        deps.onHighlight(null);
      });
      results.appendChild(row);
    }
  }

  input.addEventListener("input", () => render(input.value));
  return { element };
}
