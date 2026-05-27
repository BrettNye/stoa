import "./styles.css";

import type { Graph, GraphNode } from "@stoa/types/graph";
import type { Theme } from "@stoa/types/theme";

import { GraphScene } from "./graph/scene.js";
import { nextControlType, type ControlType } from "./graph/encoding.js";
import { nodeColor, hueScale, type ColorScales } from "./theme/resolve.js";
import {
  computeVisibleGraph,
  WIKI_ID_PREFIX,
  type ViewState,
} from "./nav/visible-graph.js";
import { loadServed, loadStatic, IndexUnavailableError } from "./data/load.js";
import { el } from "./ui/dom.js";
import { createLegend } from "./ui/legend.js";
import { createPanel } from "./ui/panel.js";
import { createSearch } from "./ui/search.js";

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

/** View modes, in display order. Single-sourced for the buttons and sync loop. */
const MODES = ["region", "all", "focus"] as const;

/** Max search hits shown in the results dropdown. */
const SEARCH_LIMIT = 20;

let fullGraph: Graph = { nodes: [], links: [] };
let knownIds: Set<string> = new Set();
/** Distinct color scales (by wiki / by type), built once from the full graph. */
let scales: ColorScales = { wiki: new Map(), type: new Map() };
let activeTheme: Theme = DEFAULT_THEME;
let controlType: ControlType = "orbit";
/** Mirrors the scene's label visibility; default-on so labels render on first load. */
let labelsEnabled = true;

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
// DOM construction (control bar lives here; self-contained widgets are in ui/)
// ---------------------------------------------------------------------------

const container = document.getElementById("graph");
if (!container) {
  throw new Error("Missing #graph container");
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
MODES.forEach((m) => {
  const btn = modeButtons[m];
  btn.addEventListener("click", () => setMode(m));
  modeGroup.appendChild(btn);
});
controls.appendChild(modeGroup);

// Control-type toggle: trackball <-> orbit
const ctrlGroup = el("div", { class: "group" });
const ctrlBtn = el("button", { type: "button" }, "Orbit");
ctrlBtn.addEventListener("click", () => {
  controlType = nextControlType(controlType);
  scene.setControlType(controlType);
  syncControlsUI();
});
ctrlGroup.appendChild(ctrlBtn);
controls.appendChild(ctrlGroup);

// Theme group: by-wiki/by-type flip + theme switcher + directional particles
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

const labelsBtn = el("button", { type: "button" }, "Labels");
labelsBtn.addEventListener("click", () => {
  labelsEnabled = !labelsEnabled;
  scene.setLabelsEnabled(labelsEnabled);
  syncControlsUI();
});
themeGroup.appendChild(labelsBtn);
controls.appendChild(themeGroup);

document.body.appendChild(controls);

// --- Widgets (search / legend / detail panel) -------------------------------
const search = createSearch({
  getNodes: () => fullGraph.nodes,
  onHighlight: (ids) => scene.setHighlight(ids),
  onSelect: (id) => selectNode(id),
  limit: SEARCH_LIMIT,
});
document.body.appendChild(search.element);

const legend = createLegend();
document.body.appendChild(legend.element);

const panel = createPanel({
  onSelect: (id) => selectNode(id),
  getKnownIds: () => knownIds,
  fetchBody: fetchNoteBody,
});
document.body.appendChild(panel.element);

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
  // nodeColor is the single source of truth shared with the legend (it handles
  // region super-nodes -> wiki color, real nodes -> rules/scale).
  scene.setNodeColor((n) => nodeColor(n, activeTheme, scales));
  renderLegend();
}

/**
 * Nodes the legend should describe: exactly what's drawn. `computeLegend` turns
 * region super-nodes into by-wiki rows and groups real nodes by the active
 * dimension, so the visible graph is passed through as-is.
 */
function legendNodes(): GraphNode[] {
  return computeVisibleGraph(fullGraph, view).nodes;
}

function renderLegend(): void {
  // Region mode draws wiki super-nodes (colored by wiki); reflect that in the
  // title even when the by-type toggle is set, since super-nodes ignore it.
  const collapsedRegion = view.mode === "region" && view.expandedWikis.size === 0;
  const dim = collapsedRegion ? "wiki" : activeTheme.defaultBy;
  legend.render(legendNodes(), activeTheme, scales, dim);
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
  MODES.forEach((m) => {
    modeButtons[m].classList.toggle("active", view.mode === m);
  });
  ctrlBtn.textContent = controlType === "orbit" ? "Orbit" : "Trackball";
  byBtn.textContent = activeTheme.defaultBy === "type" ? "By type" : "By wiki";
  labelsBtn.classList.toggle("active", labelsEnabled);
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
  const node = fullGraph.nodes.find((n) => n.id === id);
  if (node) void panel.open(node);
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
  void panel.open(node);
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
  scene.setLabelAccessor((n) => n.title || n.id);
  scene.setLabelsEnabled(labelsEnabled);

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
