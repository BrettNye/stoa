import "./styles.css";

import type { Graph, GraphNode } from "@stoa/types/graph";
import type { Theme } from "@stoa/types/theme";

import { GraphScene } from "./graph/scene.js";
import { nextControlType, type ControlType } from "./graph/encoding.js";
import { resolveNodeColor, hueScale, type ColorScales } from "./theme/resolve.js";
import { computeLegend } from "./theme/legend.js";
import { computeVisibleGraph, type ViewState } from "./nav/visible-graph.js";
import { rankNodes } from "./search/rank.js";
import { renderNoteBody } from "./panel/render.js";
import { loadServed, loadStatic, IndexUnavailableError } from "./data/load.js";

// ---------------------------------------------------------------------------
// Module-scope state
// ---------------------------------------------------------------------------

const DEFAULT_THEME: Theme = {
  name: "default",
  palette: "default",
  defaultBy: "wiki",
  rules: [],
  perWiki: {},
};

// Region super-node sentinels. These MUST match the values produced by
// computeVisibleGraph in ./nav/visible-graph.ts, which generates `wiki:${name}`
// ids and `type: "__wiki__"` for collapsed-wiki super-nodes. (Exporting these
// from visible-graph.ts to dedupe is a deferred cross-file follow-up.)
const WIKI_NODE_TYPE = "__wiki__";
const WIKI_ID_PREFIX = "wiki:";

let fullGraph: Graph = { nodes: [], links: [] };
let knownIds: Set<string> = new Set();
/** Distinct color scales (by wiki / by type), built once from the full graph. */
let scales: ColorScales = { wiki: new Map(), type: new Map() };
let activeTheme: Theme = DEFAULT_THEME;
let controlType: ControlType = "trackball";

const view: ViewState = {
  mode: "region",
  expandedWikis: new Set(),
  focusId: null,
  hops: 1,
};

let scene: GraphScene;
/** Set when the data was loaded served-side; affects how note bodies fetch. */
let servedMode = false;

// ---------------------------------------------------------------------------
// DOM construction
// ---------------------------------------------------------------------------

const container = document.getElementById("graph");
if (!container) {
  throw new Error("Missing #graph container");
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

// --- Reindex banner (hidden until needed) ----------------------------------
const banner = el("div", { class: "banner", style: "display:none" });
banner.innerHTML =
  "The graph index could not be loaded. Run <code>/reindex</code> (or " +
  "<code>stoa reindex</code>) to rebuild it, then reload this page.";
document.body.appendChild(banner);

function showBanner(): void {
  banner.style.display = "";
}

// --- Top control bar --------------------------------------------------------
const controls = el("div", { class: "controls" });

// Mode group: region (B) / all (A) / focus (C)
const modeGroup = el("div", { class: "group" });
const modeButtons: Record<ViewState["mode"], HTMLButtonElement> = {
  region: el("button", { type: "button" }, "Regions"),
  all: el("button", { type: "button" }, "All"),
  focus: el("button", { type: "button" }, "Focus"),
};
(["region", "all", "focus"] as const).forEach((m) => {
  const btn = modeButtons[m];
  btn.addEventListener("click", () => setMode(m));
  modeGroup.appendChild(btn);
});
controls.appendChild(modeGroup);

// Control-type toggle: trackball <-> orbit
const ctrlGroup = el("div", { class: "group" });
const ctrlBtn = el("button", { type: "button" }, "Trackball");
ctrlBtn.addEventListener("click", () => {
  controlType = nextControlType(controlType);
  scene.setControlType(controlType);
  syncControlsUI();
});
ctrlGroup.appendChild(ctrlBtn);
controls.appendChild(ctrlGroup);

// Theme group: by-wiki/by-type flip + directional particles
const themeGroup = el("div", { class: "group" });
const byBtn = el("button", { type: "button" }, "By wiki");
byBtn.addEventListener("click", () => {
  activeTheme = {
    ...activeTheme,
    defaultBy: activeTheme.defaultBy === "wiki" ? "type" : "wiki",
  };
  applyColors();
  syncControlsUI();
});
themeGroup.appendChild(byBtn);

const themeSelect = el("select") as HTMLSelectElement;
themeGroup.appendChild(themeSelect);

const particlesLabel = el("label");
const particlesBox = el("input", { type: "checkbox" }) as HTMLInputElement;
particlesLabel.appendChild(particlesBox);
particlesLabel.appendChild(document.createTextNode("Particles"));
particlesBox.addEventListener("change", () => {
  scene.setDirectionalParticles(particlesBox.checked);
});
themeGroup.appendChild(particlesLabel);
controls.appendChild(themeGroup);

document.body.appendChild(controls);

// --- Search -----------------------------------------------------------------
const search = el("div", { class: "search" });
const searchInput = el("input", {
  type: "search",
  placeholder: "Search notes…",
}) as HTMLInputElement;
const searchResults = el("div", { class: "search-results" });
search.appendChild(searchInput);
search.appendChild(searchResults);
document.body.appendChild(search);

searchInput.addEventListener("input", () => renderSearch(searchInput.value));

// --- Legend -----------------------------------------------------------------
// Maps swatch colors -> wiki/type. Hidden until the first render (boot) so an
// empty box never floats over the canvas (e.g. the reindex-banner path).
const legend = el("div", { class: "legend", style: "display:none" });
const legendHeader = el("div", { class: "legend-header" });
const legendTitle = el("span", { class: "legend-title" }, "Legend");
const legendToggle = el("button", { class: "legend-toggle", type: "button" }, "−");
legendHeader.appendChild(legendTitle);
legendHeader.appendChild(legendToggle);
const legendBody = el("div", { class: "legend-body" });
legend.appendChild(legendHeader);
legend.appendChild(legendBody);
document.body.appendChild(legend);

let legendCollapsed = false;
// One listener on the header covers clicks on the toggle button too (it bubbles).
legendHeader.addEventListener("click", () => {
  legendCollapsed = !legendCollapsed;
  legend.classList.toggle("collapsed", legendCollapsed);
  legendToggle.textContent = legendCollapsed ? "+" : "−";
});

// --- Detail panel -----------------------------------------------------------
const panel = el("div", { class: "panel" });
const panelClose = el("button", { class: "panel-close", type: "button" }, "×");
panelClose.addEventListener("click", () => panel.classList.remove("open"));
const panelTitle = el("h1");
const panelMeta = el("div", { class: "panel-meta" });
const panelBody = el("div", { class: "panel-body" });
panel.appendChild(panelClose);
panel.appendChild(panelTitle);
panel.appendChild(panelMeta);
panel.appendChild(panelBody);
document.body.appendChild(panel);

// Delegate wikilink clicks inside the panel body to re-select that node.
panelBody.addEventListener("click", (ev) => {
  const target = (ev.target as HTMLElement).closest(".wikilink[data-target]");
  if (!target) return;
  ev.preventDefault();
  const id = target.getAttribute("data-target");
  if (id) selectNode(id);
});

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

/** Multiple themes available via the switcher; defaults to DEFAULT_THEME. */
let availableThemes: Theme[] = [DEFAULT_THEME];

async function loadThemes(): Promise<void> {
  const url = servedMode ? "/graph/themes" : "./graph-themes.json";
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    const raw = (await r.json()) as { themes?: Theme[]; active?: string };
    const themes = Array.isArray(raw.themes) ? raw.themes : [];
    if (themes.length === 0) {
      availableThemes = [DEFAULT_THEME];
      activeTheme = DEFAULT_THEME;
    } else {
      availableThemes = themes;
      activeTheme =
        themes.find((t) => t.name === raw.active) ?? themes[0] ?? DEFAULT_THEME;
    }
  } catch {
    // Missing or malformed graph-themes.json -> built-in default.
    availableThemes = [DEFAULT_THEME];
    activeTheme = DEFAULT_THEME;
  }
  populateThemeSelect();
}

function populateThemeSelect(): void {
  themeSelect.innerHTML = "";
  for (const t of availableThemes) {
    const opt = el("option", { value: t.name }, t.name);
    if (t.name === activeTheme.name) opt.selected = true;
    themeSelect.appendChild(opt);
  }
  themeSelect.onchange = () => {
    const picked = availableThemes.find((t) => t.name === themeSelect.value);
    if (picked) {
      // Preserve the user's by-wiki/by-type flip across theme switches.
      activeTheme = { ...picked, defaultBy: activeTheme.defaultBy };
      applyColors();
      syncControlsUI();
    }
  };
}

// ---------------------------------------------------------------------------
// State -> scene
// ---------------------------------------------------------------------------

function applyColors(): void {
  scene.setNodeColor((n: GraphNode) =>
    // Region super-nodes represent a wiki, so always color them by wiki
    // (their synthetic `__wiki__` type is meaningless for by-type coloring).
    n.type === WIKI_NODE_TYPE
      ? scales.wiki.get(n.wiki) ?? "#888888"
      : resolveNodeColor(n, activeTheme, scales),
  );
  renderLegend();
}

/**
 * Nodes the legend should describe: the visible graph, but with collapsed-wiki
 * super-nodes expanded back into the real nodes they stand for. Without this,
 * any view that shows super-nodes (region mode, or focus mode before a focus
 * node is chosen) would leave the legend empty — the canvas has bubbles but no
 * real nodes to color-key.
 */
function legendNodes(): GraphNode[] {
  // Describe exactly what's drawn: region super-nodes become by-wiki rows and
  // real nodes group by the active dimension (no super-node expansion).
  return computeVisibleGraph(fullGraph, view).nodes;
}

function renderLegend(): void {
  // Region mode draws wiki super-nodes (colored by wiki); reflect that in the
  // title even when the by-type toggle is set, since super-nodes ignore it.
  const collapsedRegion = view.mode === "region" && view.expandedWikis.size === 0;
  const dim = collapsedRegion ? "wiki" : activeTheme.defaultBy;
  legendTitle.textContent = `Legend · by ${dim}`;
  const entries = computeLegend(legendNodes(), activeTheme, scales);
  legendBody.innerHTML = "";
  legend.style.display = "";
  if (entries.length === 0) {
    legendBody.appendChild(el("div", { class: "legend-empty" }, "No nodes to show"));
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
    legendBody.appendChild(row);
  }
}

function rerender(): void {
  const visible = computeVisibleGraph(fullGraph, view);
  scene.setData(visible);
  applyColors();
}

function setMode(mode: ViewState["mode"]): void {
  view.mode = mode;
  if (mode !== "focus") view.focusId = null;
  rerender();
  syncControlsUI();
}

function syncControlsUI(): void {
  (["region", "all", "focus"] as const).forEach((m) => {
    modeButtons[m].classList.toggle("active", view.mode === m);
  });
  ctrlBtn.textContent = controlType === "orbit" ? "Orbit" : "Trackball";
  byBtn.textContent = activeTheme.defaultBy === "type" ? "By type" : "By wiki";
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

function isWikiSuperNode(id: string): string | null {
  // Region super-nodes have id `wiki:<name>` and type `__wiki__`.
  return id.startsWith(WIKI_ID_PREFIX) ? id.slice(WIKI_ID_PREFIX.length) : null;
}

function onNodeClick(id: string): void {
  const wiki = isWikiSuperNode(id);
  if (wiki !== null && view.mode === "region") {
    // Toggle expansion of this wiki.
    if (view.expandedWikis.has(wiki)) view.expandedWikis.delete(wiki);
    else view.expandedWikis.add(wiki);
    rerender();
    return;
  }
  // A real node: open the detail panel.
  void openPanel(id);
}

/** Programmatic selection (search result or wikilink click). */
function selectNode(id: string): void {
  const node = fullGraph.nodes.find((n) => n.id === id);
  if (!node) return;
  // Ensure the node is visible: in region mode, auto-expand its wiki.
  if (view.mode === "region" && !view.expandedWikis.has(node.wiki)) {
    view.expandedWikis.add(node.wiki);
    rerender();
  }
  scene.flyToNode(id);
  void openPanel(id);
}

async function openPanel(id: string): Promise<void> {
  const node = fullGraph.nodes.find((n) => n.id === id);
  if (!node || node.type === WIKI_NODE_TYPE) return;

  panelTitle.textContent = node.title || node.id;
  panelMeta.innerHTML = "";
  panelMeta.appendChild(
    document.createTextNode(
      `${node.type} · ${node.wiki} · ${node.status}` +
        (node.updated ? ` · ${node.updated}` : ""),
    ),
  );
  if (node.tags.length) {
    const tagWrap = el("div");
    for (const t of node.tags) tagWrap.appendChild(el("span", { class: "tag" }, t));
    panelMeta.appendChild(tagWrap);
  }

  panel.classList.add("open");

  const body = await fetchNoteBody(node);
  if (body !== null) {
    panelBody.innerHTML = renderNoteBody(body, undefined, knownIds);
  } else {
    // Could not load the markdown: show summary metadata only.
    panelBody.innerHTML = "";
    panelBody.appendChild(el("p", {}, node.summary || "(no body available)"));
  }
}

async function fetchNoteBody(node: GraphNode): Promise<string | null> {
  if (!node.path) return null;
  const url = servedMode ? `/${node.path}` : `./${node.path}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function renderSearch(query: string): void {
  searchResults.innerHTML = "";
  const q = query.trim();
  if (!q) {
    // Cleared query: drop the canvas highlight so all nodes return to normal.
    scene.setHighlight(null);
    return;
  }
  const hits = rankNodes(q, fullGraph.nodes, 20);
  // Light up every matching node on the canvas; dim the rest.
  scene.setHighlight(new Set(hits.map((h) => h.id)));
  for (const hit of hits) {
    const node = fullGraph.nodes.find((n) => n.id === hit.id);
    if (!node) continue;
    const row = el("div", { class: "hit" });
    row.appendChild(el("div", {}, node.title || node.id));
    row.appendChild(el("div", { class: "meta" }, `${node.type} · ${node.wiki}`));
    row.addEventListener("click", () => {
      selectNode(node.id);
      searchResults.innerHTML = "";
      searchInput.value = "";
      // Input is now empty: drop the highlight so the canvas is undimmed.
      scene.setHighlight(null);
    });
    searchResults.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function loadGraph(): Promise<Graph | null> {
  // Try served mode first; any served failure falls back to static.
  try {
    const g = await loadServed();
    servedMode = true;
    return g;
  } catch {
    // Fall back to static below. We intentionally ignore the served-mode error:
    // not being served is the expected case, and the static load is the source
    // of truth for whether the banner is needed.
  }
  try {
    const g = await loadStatic(".");
    servedMode = false;
    return g;
  } catch (staticErr) {
    // Only a missing/unbuilt static index means "reindex needed" (→ banner).
    if (staticErr instanceof IndexUnavailableError) return null;
    // Any other error (e.g. malformed pages.json) is real — surface it.
    throw staticErr;
  }
}

async function boot(): Promise<void> {
  scene = new GraphScene(container as HTMLElement, { onNodeClick });
  scene.setControlType(controlType);

  const graph = await loadGraph();
  if (graph === null) {
    showBanner();
    syncControlsUI();
    return;
  }

  fullGraph = graph;
  knownIds = new Set(graph.nodes.map((n) => n.id));
  // Build distinct color scales from the full domain so colors are stable and
  // collision-free regardless of which nodes are currently visible.
  scales = {
    wiki: hueScale(graph.nodes.map((n) => n.wiki)),
    type: hueScale(graph.nodes.map((n) => n.type)),
  };

  await loadThemes();

  rerender();
  syncControlsUI();
}

void boot();
