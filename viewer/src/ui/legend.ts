import type { GraphNode } from "@stoa/types/graph";
import type { Theme } from "@stoa/types/theme";
import type { ColorScales } from "../theme/resolve.js";
import { computeLegend } from "../theme/legend.js";
import { el } from "./dom.js";

export interface Legend {
  /** Root element; the caller appends it to the document. */
  readonly element: HTMLElement;
  /** Rebuild the rows for the given visible nodes; `dim` titles the panel. */
  render(nodes: GraphNode[], theme: Theme, scales: ColorScales, dim: string): void;
}

/**
 * Collapsible legend panel mapping swatch colors -> wiki/type. Hidden until the
 * first `render` so an empty box never floats over the canvas (e.g. the
 * reindex-banner path).
 */
export function createLegend(): Legend {
  const element = el("div", { class: "legend", style: "display:none" });
  const header = el("div", { class: "legend-header" });
  const title = el("span", { class: "legend-title" }, "Legend");
  const toggle = el("button", { class: "legend-toggle", type: "button" }, "−");
  header.appendChild(title);
  header.appendChild(toggle);
  const body = el("div", { class: "legend-body" });
  element.appendChild(header);
  element.appendChild(body);

  let collapsed = false;
  // One listener on the header covers clicks on the toggle button too (bubbles).
  header.addEventListener("click", () => {
    collapsed = !collapsed;
    element.classList.toggle("collapsed", collapsed);
    toggle.textContent = collapsed ? "+" : "−";
  });

  function render(
    nodes: GraphNode[],
    theme: Theme,
    scales: ColorScales,
    dim: string,
  ): void {
    title.textContent = `Legend · by ${dim}`;
    const entries = computeLegend(nodes, theme, scales);
    body.innerHTML = "";
    element.style.display = "";
    if (entries.length === 0) {
      body.appendChild(el("div", { class: "legend-empty" }, "No nodes to show"));
      return;
    }
    for (const e of entries) {
      const text = e.sublabel ? `${e.label} · ${e.sublabel}` : e.label;
      const row = el("div", { class: "legend-row" });
      const swatch = el("span", { class: "legend-swatch" });
      swatch.style.background = e.color;
      row.appendChild(swatch);
      const label = el("span", { class: "legend-label" }, text);
      label.title = text;
      row.appendChild(label);
      row.appendChild(el("span", { class: "legend-count" }, String(e.count)));
      body.appendChild(row);
    }
  }

  return { element, render };
}
