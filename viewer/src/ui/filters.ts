import type { GraphNode } from "@stoa/types/graph";
import type { ViewState } from "../nav/visible-graph.js";
import { filterOptions, toFilters } from "../nav/filter-options.js";
import { el } from "./dom.js";

export interface FiltersDeps {
  /** Called whenever a control changes, with the normalized filters object. */
  onChange: (filters: NonNullable<ViewState["filters"]>) => void;
}

export interface Filters {
  /** Root element; the caller appends it to the document. */
  readonly element: HTMLElement;
  /** Build the option checkboxes from the graph's distinct values. */
  populate(nodes: GraphNode[]): void;
}

type Dim = "wikis" | "types" | "statuses";

/**
 * Collapsible filter panel for "All" mode: wiki / type / status checkboxes + a
 * tag input. Emits a normalized `ViewState.filters` on every change (empty
 * dimensions become `undefined`, never an exclude-everything empty Set). Hidden
 * until `populate`; collapsed by default so it stays out of the way.
 */
export function createFilters(deps: FiltersDeps): Filters {
  const element = el("div", { class: "filters collapsed", style: "display:none" });
  const header = el("div", { class: "filters-header" });
  header.appendChild(el("span", { class: "filters-title" }, "Filters"));
  const toggle = el("button", { class: "filters-toggle", type: "button" }, "+");
  header.appendChild(toggle);
  const body = el("div", { class: "filters-body" });
  element.appendChild(header);
  element.appendChild(body);

  let collapsed = true;
  header.addEventListener("click", () => {
    collapsed = !collapsed;
    element.classList.toggle("collapsed", collapsed);
    toggle.textContent = collapsed ? "+" : "−";
  });

  const boxes: Record<Dim, HTMLInputElement[]> = { wikis: [], types: [], statuses: [] };
  let tagInput: HTMLInputElement;

  const emit = (): void => {
    deps.onChange(
      toFilters({
        wikis: new Set(boxes.wikis.filter((b) => b.checked).map((b) => b.value)),
        types: new Set(boxes.types.filter((b) => b.checked).map((b) => b.value)),
        statuses: new Set(boxes.statuses.filter((b) => b.checked).map((b) => b.value)),
        tag: tagInput?.value ?? "",
      }),
    );
  };

  const group = (label: string, values: string[], dim: Dim): HTMLElement => {
    const wrap = el("div", { class: "filters-group" });
    wrap.appendChild(el("div", { class: "filters-group-label" }, label));
    boxes[dim] = [];
    for (const v of values) {
      const lbl = el("label", { class: "filters-check" });
      const box = el("input", { type: "checkbox" }) as HTMLInputElement;
      box.value = v;
      box.addEventListener("change", emit);
      boxes[dim].push(box);
      lbl.appendChild(box);
      lbl.appendChild(document.createTextNode(v));
      wrap.appendChild(lbl);
    }
    return wrap;
  };

  function populate(nodes: GraphNode[]): void {
    const opts = filterOptions(nodes);
    body.innerHTML = "";
    body.appendChild(group("Wiki", opts.wikis, "wikis"));
    body.appendChild(group("Type", opts.types, "types"));
    body.appendChild(group("Status", opts.statuses, "statuses"));

    const tagWrap = el("div", { class: "filters-group" });
    tagWrap.appendChild(el("div", { class: "filters-group-label" }, "Tag"));
    tagInput = el("input", {
      type: "search",
      placeholder: "tag…",
      class: "filters-tag",
    }) as HTMLInputElement;
    tagInput.addEventListener("input", emit);
    tagWrap.appendChild(tagInput);
    body.appendChild(tagWrap);

    const clear = el("button", { class: "filters-clear", type: "button" }, "Clear filters");
    clear.addEventListener("click", () => {
      (["wikis", "types", "statuses"] as const).forEach((d) =>
        boxes[d].forEach((b) => (b.checked = false)),
      );
      tagInput.value = "";
      emit();
    });
    body.appendChild(clear);

    element.style.display = "";
  }

  return { element, populate };
}
