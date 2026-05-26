---
id: spec-stoa-3d-graph-viewer-design
title: "Stoa 3D graph viewer (region-drill navigation, viewer-side theming, markdown panel, search)"
date: 2026-05-26
status: draft
target_version: 0.5.0
supersedes: []
related:
  - docs/superpowers/specs/2026-05-21-stoa-server-mode-design.md
  - docs/server-mode.md
---

# Stoa 3D graph viewer

## 1. Summary

The vault is a graph: 1,247 pages, ~1,625 link edges, 16 wikis, 15 note types — all already encoded in `_index/pages.json` (node metadata) and `_index/links.json` (per-page outbound/inbound edges). Obsidian's built-in graph view renders this in 2D but breaks down at this scale: it slows under load, scans the entire filesystem (so code repos and `node_modules` pollute the view), and offers no way to load the graph regionally.

This spec defines a standalone **3D graph viewer** built on `3d-force-graph` (Three.js + d3-force-3d). It reads stoa's `_index`, so only the 1,247 vault pages appear — non-vault files are excluded for free. It ships as a self-contained static single-page app that *also* runs behind stoa's existing HTTP server (v0.4 server mode). It opens calm — one bubble per wiki — and expands by region on demand, directly addressing the scale and focus pains.

The driving pain is recorded in the vault: `question-obsidian-graph-lazy-loading` ("graph is starting to slow down… lazy loaded by region") and `question-obsidian-graph-ignore-paths` ("ignore parts of the file system in graph"), both 2026-05-15.

## 2. Goals and non-goals

### Goals

1. Render the vault link graph as a **volumetric 3D layout** (nodes positioned in real X/Y/Z by `d3-force-3d`, not a 2D projection), with a free-orbit camera — drag to tumble the graph on any axis, scroll to zoom, right-drag to pan. Smooth at 1,250+ nodes.
2. Default to a calm, regional entry point that lazy-loads by wiki (mode B).
3. Provide whole-graph (mode A) and focus/neighborhood (mode C) modes.
4. Color nodes via a configurable, viewer-side **theme engine** — global default by wiki, per-wiki rule overrides keyed on existing fields (no schema change).
5. Read any note's rendered markdown in an in-viewer detail panel, with clickable wikilinks for traversal.
6. Provide global metadata search that highlights and focuses nodes.
7. Work both as a static file (zero stoa dependency) and served by stoa (live data).

### Non-goals

1. **No stoa schema change.** No first-class `subtype` field — per-wiki "subtypes" are expressed through existing tags. A first-class subtype is a separate decision with its own spec (see §10).
2. **No note editing.** The viewer is read-only; it never writes `.md` files. (Editing would require a save endpoint + reindex + open-file conflict handling — out of scope.)
3. **No Obsidian coupling.** No `obsidian://` deep-linking; the viewer is a self-contained place to explore.
4. **No full-body search in MVP.** Metadata search only; body search via `tokens.json` is deferred (§9, §10).
5. **No in-viewer visual theme editor in MVP.** Themes are defined in a config file; the viewer offers a switcher, not a visual editor (§10).
6. No replacement of Obsidian's graph in Obsidian itself — this is a separate viewer, not a plugin.

## 3. Architecture overview

One codebase, two delivery paths, one normalized data shape.

```
                 ┌─────────────────────────────┐
                 │   Viewer SPA (3d-force-graph)│
                 │   navigation · theming ·     │
                 │   detail panel · search      │
                 └──────────────┬──────────────┘
                                │ consumes ONE shape:
                                │ { nodes:[…], links:[…] }
              ┌─────────────────┴───────────────────┐
   static mode│                                       │served mode
   ┌──────────▼──────────┐               ┌────────────▼─────────────┐
   │ fetch _index/        │               │ stoa routes (v0.4 server)│
   │  pages.json +        │               │  GET /graph (assets)     │
   │  links.json,         │               │  GET /graph/data (JSON)  │
   │ normalize in browser │               │  GET/PUT /graph/themes   │
   └──────────────────────┘               └──────────────────────────┘
```

### 3.1 Normalized graph shape

The viewer always consumes:

```ts
interface GraphNode {
  id: string;        // page id (== filename stem)
  wiki: string;
  type: string;      // one of the vault note types
  title: string;
  summary: string;
  tags: string[];
  status: string;
  updated: string;   // ISO date
  path: string;      // vault-relative path to the .md
  degree: number;    // outbound+inbound count, computed
}
interface GraphLink { source: string; target: string; } // directed: source -> target
interface Graph { nodes: GraphNode[]; links: GraphLink[]; }
```

- **Static mode**: the viewer fetches `_index/pages.json` (`{ pages: [...] }`) and `_index/links.json` (`{ <id>: { outbound, inbound } }`), then normalizes: one `GraphNode` per page, one `GraphLink` per outbound edge, `degree` = outbound+inbound count. Dangling edges (target id not in `pages`) are dropped with a console warning.
- **Served mode**: stoa's `GET /graph/data` returns the same `Graph` shape directly.

### 3.2 stoa server additions (served mode only)

Additive routes on the existing HTTP server; no change to MCP tools or stdio:

- `GET /graph` — serve the built viewer static assets.
- `GET /graph/data` — return the normalized `Graph` (built server-side from the in-memory/disk index).
- `GET /graph/themes` / `PUT /graph/themes` — read and write the theme config file (§6).

Static mode uses none of these; it only needs read access to the two `_index` files.

## 4. Navigation modes

Mode **B is the default**; A and C are reachable from it.

### 4.1 Mode B — region drill-down (default)

- Opens with one **super-node per wiki** (16), radius scaled by page count.
- Click a wiki super-node → its pages expand into the scene with their intra-wiki edges; the simulation only includes *expanded* wikis' nodes (this is the lazy-load — calm and fast by default).
- Click again (or a collapse control) → the wiki collapses back to its bubble.
- Inter-wiki edges whose other endpoint is in a collapsed wiki terminate visually on that wiki's bubble.

### 4.2 Mode A — show everything + filters

- "Expand all" expands every wiki → the full graph.
- A filter panel toggles wikis, types, and statuses on/off, and offers a tag filter. Filtering hides nodes rather than drilling.

### 4.3 Mode C — focus / neighborhood

- From a selected node (via click or search), render only that node + its N-hop neighbors (N configurable, default 1–2).
- Entered from the detail panel ("focus this node") or from a search result.

### 4.4 Camera & 3D interaction (all modes)

The layout is genuinely 3D — the explicit contrast with Obsidian's flat 2D graph. The camera orbits the volume; the graph is not projected onto a plane.

- **Controls**: drag = rotate, scroll = zoom (dolly), right-drag = pan.
- **Two control styles, toggleable in the UI**:
  - **Trackball (default)** — free rotation on every axis; the graph can be tumbled into any orientation (no fixed up-vector). Truest to "drag XYZ"; this is `3d-force-graph`'s default `controlType`.
  - **Orbit** — drag-rotate while maintaining an up direction, so the graph never flips. More stable/intuitive at the cost of full tumbling.
  - (`fly` controls are available from the same `controlType` switch but not surfaced in the MVP toggle.)
- "Fly camera to node" (used by search and traversal) animates the camera regardless of control style.

## 5. Detail panel (read-only)

Clicking a node opens a side panel:

- **Frontmatter block**: title, summary, type, wiki, tags, status, updated.
- **Rendered body**: the note's markdown body rendered with `markdown-it`.
- **Clickable wikilinks**: `[[...]]` in the rendered body, plus inbound/outbound link lists, are clickable. Clicking re-selects the target node (and traverses/expands as needed) — read and hop without leaving the viewer.
- Sourcing the body: static mode fetches the `.md` at `node.path`; served mode may serve it via the same origin. If the file can't be loaded, the panel shows metadata only.
- A "focus this node" control enters mode C.

## 6. Theme engine (viewer-side, config-driven)

A **theme** is an ordered list of color rules plus a named palette. No stoa schema change — rules key on fields that already exist on `GraphNode`.

```ts
interface ColorRule {
  match: { wiki?: string; type?: string; tag?: string; status?: string; idGlob?: string };
  color: string; // hex
}
interface Theme {
  name: string;
  palette: string;            // named palette id
  defaultBy: "wiki" | "type"; // fallback dimension when no rule matches
  rules: ColorRule[];         // first match wins
  perWiki?: Record<string, ColorRule[]>; // wiki -> rules applied to that wiki's nodes
}
```

### 6.1 Resolution

For each node: evaluate `perWiki[node.wiki]` rules first (first match wins), then top-level `rules`, then fall back to the `defaultBy` dimension's hue. A node matches a rule when every present `match` key matches (tags match if the node's `tags[]` contains the value).

### 6.2 Examples

- **Global default**: `defaultBy: "wiki"`, no rules → every node colored by its wiki hue. One-key UI toggle flips `defaultBy` to `"type"`.
- **Meal-planning subtypes (the motivating case)**: `perWiki["meal-planning"] = [ {match:{tag:"recipe"},color:"#e06c75"}, {match:{tag:"ingredient"},color:"#98c379"}, {match:{tag:"meal-plan"},color:"#61afef"} ]`. Recipe nodes render red *inside* meal-planning; every other wiki keeps the global by-wiki scheme.

### 6.3 Visual encoding (non-color)

- **Node size** = `degree` (hubs render larger).
- **Edges** = real links; a toggle adds directional particles (source → target).
- **Palettes**: named, switchable (e.g. default / warm / high-contrast / colorblind-safe).

### 6.4 Persistence

- Themes live in a stable vault config file: `graph-themes.json` at the vault root. **Not** under `_index/` (which `/reindex` regenerates).
- Static mode reads it via fetch. Served mode reads/writes it via `GET/PUT /graph/themes`.
- v1 authoring = hand-edited JSON + an in-viewer **switcher** (pick among defined themes, flip `defaultBy`). A visual theme *editor* is deferred (§10).
- **Forward-compatible**: if a first-class `subtype` field is ever added to stoa, it becomes one more optional `match` key with no engine rework.

## 7. Search (all modes)

A global search box, always visible:

- **Type-to-highlight**: matching nodes glow; non-matches dim. Updates live as you type.
- **Type-to-focus**: selecting a result flies the camera to the node, selects it, and opens the detail panel. In mode B, if the hit is in a collapsed wiki, that wiki auto-expands. This is also the entry into mode C.
- **Scope (MVP)**: instant client-side fuzzy match over `title / summary / tags / id`. Works in both static and served modes (1,247 nodes searches live with no index).
- **Deferred**: full note-body search via a served-mode `GET /graph/search?q=` endpoint reusing `_index/tokens.json` (§10).

## 8. Tech stack & packaging

- **Library**: `3d-force-graph` (Three.js + d3-force-3d) for rendering; `markdown-it` for the detail panel. No heavy UI framework (vanilla TS + small DOM helpers) — YAGNI.
- **Build**: a **Vite** app at `stoa/viewer/`, building self-contained static assets (all libs bundled → works offline, no CDN). Reuses stoa's existing TypeScript + vitest toolchain.
- **Output**: built assets are what stoa serves at `GET /graph`, and are equally openable as a static file pointed at a vault's `_index`.

### 8.1 Packaging approaches considered

- **(a) Single HTML + CDN libs** — simplest, but breaks offline and pins to CDN availability. Rejected.
- **(b) Vite-built self-contained static assets** — bundled, offline-capable, testable core. **Chosen.**
- **(c) React/framework SPA** — unnecessary weight for one canvas + a panel + a search box. Rejected (YAGNI).

## 9. Testing & error handling

### Testing (vitest, pure-function core)

- **Normalization**: `pages.json` + `links.json` → `Graph` (node mapping, degree computation, dangling-edge drop).
- **Theme resolution**: rule matching, first-match precedence, per-wiki-over-global, `defaultBy` fallback, tag-membership matching.
- **Wikilink resolution**: parse `[[wikis/<wiki>/<type>/<id>|alias]]` and bare `[[id]]` forms → target node id; unresolved links flagged.
- **Search**: fuzzy ranking over title/summary/tags/id.
- 3D rendering itself is verified manually/visually (documented in a short smoke-test checklist akin to `docs/manual-smoke-test.md`).

### Error handling

- Missing/old `_index` files → banner prompting `/reindex`.
- Malformed `graph-themes.json` → fall back to the built-in default theme + surface a non-blocking warning.
- Missing `.md` on panel render → show metadata only.
- Unresolved wikilink → render with dead-link styling, non-clickable.

## 10. Scope

### MVP

- Volumetric 3D layout with free-orbit camera; trackball/orbit control toggle (trackball default).
- Modes B (default) / A / C.
- By-wiki + by-type coloring; tag-based theme engine with per-wiki rules and named palettes, loaded from `graph-themes.json`; theme switcher UI.
- Node size by degree; edge directional-particle toggle.
- Read-only markdown detail panel with clickable wikilinks.
- Global metadata search (highlight + focus, auto-expand in mode B).
- Static delivery + stoa-served delivery.

### Deferred (each its own follow-up)

- Full note-body search via `_index/tokens.json` (served-mode endpoint). *(Explicitly noted for later by the user.)*
- In-viewer **visual** theme editor (click-to-assign colors, write-back via `PUT /graph/themes`).
- First-class `subtype` frontmatter field in stoa (schema change: frontmatter contract, indexer, templates, lint, per-wiki vocab, CLAUDE.md canon) — separate brainstorm/spec; the theme engine is already forward-compatible.
- **Tauri desktop shell.** Wrap the (unchanged) viewer SPA in a native desktop app. Reads the vault directly via Tauri's Rust fs API, removing the `file://` fetch limitation of static mode and the "server must be running" requirement of served mode. Deliberately deferred: the web paths (static + stoa-served) deliver the MVP, and a Rust toolchain + per-platform build/signing is premature. The design keeps this cheap to add later — `viewer/src/data/load.ts` is the data seam, so Tauri arrives as a third adapter (`loadTauri`, ~30 lines) plus a `src-tauri/` shell, with no changes to the rest of the viewer. For personal/local use the shell can run unsigned (no distribution/signing overhead).
- Directional-edge polish, layout presets, saved camera bookmarks.
