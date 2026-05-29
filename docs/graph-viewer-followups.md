# 3D Graph Viewer — follow-ups & handoff

Handoff for continuing the 3D graph viewer in a fresh session. Captures current
state, what's done, and the prioritized backlog. Legend, node labels, the
DRY/SRP/SoC audit, cursor-zoom, and performance/scale tuning all landed this
round, and **advanced search & filters** (filter panel + field-scoped search)
followed. Remaining: full note-body search (deferred, v2) and P2 polish — the
branch is otherwise feature-complete and ready to PR.

## Where things stand

- **Branch:** `feat/3d-graph-viewer` · **PR:** https://github.com/BrettNye/stoa/pull/14
- **Specs:** `docs/superpowers/specs/2026-05-26-3d-graph-viewer-design.md` ·
  `docs/superpowers/specs/2026-05-26-3d-graph-labels-design.md` (node labels)
- **Plans:** `docs/superpowers/plans/2026-05-26-3d-graph-viewer-dag.md` (17 tasks) ·
  `docs/superpowers/plans/2026-05-26-3d-graph-labels-dag.md` (4 tasks) — all done
- **User docs / smoke checklist:** `docs/graph-viewer.md`
- **Status:** feature complete + reviewed; viewer suite green (133 tests),
  `tsc -p viewer/tsconfig.json --noEmit` + `npm run build:viewer` green. Tuned and
  tested against the real ~1.2k-node / ~1.4k-edge vault. See "Lessons" below.

### Run it

```powershell
# from the stoa repo dir
npm run build:viewer
$env:STOA_TOKEN_SIGNING_SECRET = "dev-secret"
npm run dev -- serve --vault "C:/Users/brett/Documents/Knowledge"
# open http://127.0.0.1:8443/graph   (or: stoa graph)
```

### Current UI controls (in `viewer/src/main.ts`)

Mode buttons (Regions / All / Focus) · Orbit↔Trackball toggle (defaults to
**Orbit** with cursor-centric zoom) · By-wiki↔By-type toggle · **Labels** toggle
(default on) · directional-particle checkbox · search box · collapsible legend ·
detail panel.

## Backlog

### P1 — Legend ✅ DONE
Done in `viewer/src/theme/legend.ts` (pure `computeLegend`, unit-tested in
`legend.test.ts`) + DOM/CSS wiring in `viewer/src/main.ts` / `styles.css`.
- Collapsible panel, bottom-left, listing each wiki (`defaultBy: "wiki"`) or each
  type (`defaultBy: "type"`) with a swatch + node count. Title reads
  "Legend · by wiki|type".
- Swatches re-derive through the **same** `resolveNodeColor`, so colors match the
  canvas exactly. Refreshes from `applyColors()`, so it tracks the By-wiki/By-type
  flip, theme switches, mode changes, and wiki expand/collapse.
- Per-wiki / global rule overrides (e.g. meal-planning `recipe → red`) render as
  extra sub-rows under the group, labeled by the secondary dimension. (No
  overrides appear against the current vault — it has no `graph-themes.json`, so
  the default ruleless theme is used.)
- Describes the **visible** nodes exactly: region super-nodes render as by-wiki
  rows (count = the wiki's page count), real nodes group by the active dimension.
  In collapsed region mode the title reads "by wiki" even if the by-type toggle
  is set, since super-nodes always colour by wiki.

### Colour scale — distinct hues, no collisions ✅ DONE
- Region super-nodes always colour **by wiki** (their synthetic `__wiki__` type is
  meaningless for by-type), so the Regions bubbles + legend agree.
- The default by-wiki / by-type colouring now uses `hueScale` in
  `viewer/src/theme/resolve.ts` — evenly-spaced, deterministic hues so N wikis/types
  get N distinct colours (no more hash collisions like concept/`__wiki__` both blue).
  Scales are built once from the full graph in `main.ts`. Named non-"default"
  palettes keep the legacy hash-into-palette behaviour.

### Node labels ✅ DONE
Spec `…-3d-graph-labels-design.md`, plan `…-3d-graph-labels-dag.md` (4-task DAG,
executed with spec + quality review per task). Camera-facing `SpriteText` labels
under a **Labels** toggle (default on), via a budgeted, layered strategy:
- Pure `viewer/src/labels/select.ts` (`selectLabeledIds`, fully unit-tested):
  region super-nodes always labelled, then top-degree **hub landmarks**, then
  **proximity** fill, then the **hovered** node (overrides budget). Capped by
  `LABEL_BUDGET` (12), so on-screen label count stays bounded at any graph size.
- `viewer/src/graph/scene.ts` renders a reused, capped `SpriteText` pool
  (`POOL_CAP` 50), synced by a throttled rAF loop; survives the controlType
  rebuild. New dep: `three-spritetext`.

### Cursor-centric zoom ✅ DONE
Default control mode is now **Orbit** with `OrbitControls.zoomToCursor` — the
wheel dollies toward the pointer. TrackballControls has no equivalent, so
cursor-zoom only applies in orbit mode (Trackball is still on the toggle).

### Architecture audit (DRY / SRP / SoC) ✅ DONE
- `main.ts` split (482→330 LOC) into a `viewer/src/ui/` view layer: `dom.ts`
  (`el`), `legend.ts`, `panel.ts`, `search.ts`; `main.ts` is now control-bar +
  state + boot.
- Single-sourced `WIKI_NODE_TYPE` / `WIKI_ID_PREFIX` / `endId` (exported from
  `nav/visible-graph.ts`) and `NEUTRAL` + `nodeColor()` (from `theme/resolve.ts` —
  the one source of truth shared by the scene colour accessor and the legend).
- `scene.ts` typed with `ForceGraph3DInstance` (the lone `any` is the lib's
  construction call).

### Performance & scale ✅ DONE (this round)
Tuned for the real ~1.2k-node vault; analysed to ~10k:
- **Force sim:** `warmupTicks(60)` runs the layout explosion **off-screen**;
  `cooldownTicks(200)` caps the on-screen settle (3d-force-graph defaults are
  warmup 0 + ~15s render-every-tick → the "blow-up" lag).
- **Label loop idle-skip:** once `onEngineStop` fires, `syncLabels` short-circuits
  unless the camera moved or the hover changed — a static graph costs ~nothing.
- **Region remap O(N+E):** `regionView` was O(E·N) (a `nodes.find` per edge
  endpoint); now indexed by an id→wiki map. Mattered approaching ~10k.
- **Label texture reuse:** gate `SpriteText.text` writes (three-spritetext rebuilds
  a CanvasTexture on every assignment); `nodeResolution` 8→6.
- **Remaining ceiling (inherent):** "All" mode renders every node as its own mesh
  every frame — 3d-force-graph has no GPU instancing — so ~10k-all-at-once is the
  wall. The collapse-by-default region view keeps the common case fast; the real
  lever for large sets is the **filter UI** below (don't render everything at once).

### Advanced search & filters — ✅ filter panel + field-scoped search DONE
This was also the scale lever: filtering avoids handing all N nodes to the
renderer at once (see the Performance ceiling above).
- **Filter panel for "All" mode** ✅ — collapsible bottom-right panel with
  wiki/type/status checkboxes + a tag input (`viewer/src/ui/filters.ts`), built
  from the graph's distinct values via pure, tested
  `viewer/src/nav/filter-options.ts`. Activating a filter auto-switches to All
  mode. Empty dimensions normalize to `undefined` (the `applyFilters`
  empty-Set-excludes-everything footgun is unit-tested).
- **Field-scoped search** ✅ — `field:value` prefixes (`type:`, `tag:`, `wiki:`,
  `status:`, `id:`, `title:`) in the search box; unknown prefixes fall back to
  free text. Pure `viewer/src/search/rank.ts` (`parseQuery` / `rankNodes`),
  unit-tested; drives both the results list and the canvas highlight.
- **Full note-body search** (still deferred, v2) — a served-mode
  `GET /graph/search?q=` endpoint reusing `_index/tokens.json` (the same stemmed
  index that powers `/recall`); the viewer falls back to metadata search in
  static mode. See spec §7 "Deferred".

### P2 — Theming UI
Today only a By-wiki↔By-type toggle exists.
- Theme **switcher** dropdown to pick among named themes in `graph-themes.json`
  (the `ThemesFile.active` field) and a palette picker (palettes live in
  `viewer/src/theme/resolve.ts`: `default`, `warm`, `high-contrast`,
  `colorblind-safe`).
- In-viewer **visual theme editor** (click-to-assign colors, save via
  `PUT /graph/themes`) — deferred in spec.

### P2 — Other improvements
- **Control-toggle camera reset**: switching Trackball↔Orbit rebuilds the
  scene (3d-force-graph bakes controls at construction), resetting the camera.
  Consider preserving/restoring camera position across the rebuild.
- **Bundle size**: the viewer bundle is ~1.5 MB (three.js). Code-split or lazy-load
  if startup feels heavy.
- **Static-file delivery ergonomics**: static mode needs the viewer served where
  `./_index/` resolves as a sibling. Consider a `stoa graph --static` that copies
  built assets next to the index, or document the `npx serve` recipe better.
- **WIKI sentinel dedup** ✅ done in the audit — `WIKI_NODE_TYPE` /
  `WIKI_ID_PREFIX` / `endId` are now exported from `nav/visible-graph.ts` and
  reused by `main.ts`, `theme/resolve.ts`, and `graph/scene.ts`.
- **First-class `subtype`** (separate spec): a validated per-wiki subtype field in
  stoa, which the theme engine already accommodates as a `match` key.
- **Tauri desktop shell** (deferred): wrap the SPA; `viewer/src/data/load.ts` is
  the adapter seam (add a `loadTauri`). See spec §10.

## Lessons (so a fresh instance doesn't regress them)

- **d3-force mutates link objects.** `3d-force-graph` replaces `link.source` /
  `link.target` (string ids) with node-object references after rendering. Always
  read endpoints id-safely and emit fresh string-id link objects — never hand the
  engine your canonical `links` array. (This caused "edges vanish after All mode".)
- **`controlType` is constructor-only**, not a runtime setter — changing it
  requires rebuilding the instance.
- **Test against the real index, not just clean fixtures.** Real
  `_index/pages.json` has pages missing `id`/`type`/`wiki`; `links.json` has
  `null` array entries. Parsing is now lenient (`src/types/graph.ts`).
- **Faithful mocks.** The scene test originally used an all-callable Proxy mock
  that made non-existent methods (`controlType()`) appear to work and hid a real
  bug. Mocks must expose only the library's real surface.
- **three-spritetext rebuilds a texture on every `.text` set** (`_genCanvas` →
  `new CanvasTexture`). Never re-assign label text unconditionally in a loop —
  gate on change, or you regenerate dozens of GPU textures/sec.
- **3d-force-graph defaults target small graphs.** `warmupTicks: 0` + ~15s
  cooldown + render-every-tick means a large graph's layout "explosion" animates
  on-screen and pins the main thread. Warm up off-screen + cap cooldown.
- **No GPU instancing.** Each node is its own mesh re-rendered every frame, so
  "All" mode is draw-call-bound at scale — collapse/filter rather than render all.
- **Faithful mocks can't model performance.** The label texture-regen and the
  idle CPU churn were invisible to the unit tests (the SpriteText mock makes
  `.text`/loops free); only manual observation against the real vault caught them.
- **Cursor-zoom needs OrbitControls** (`zoomToCursor`); TrackballControls lacks it.
- **`computeVisibleGraph` region remap was O(E·N)** via a `nodes.find` per edge
  endpoint — fine at ~1.2k, a freeze approaching ~10k. Index id→wiki for O(1).

## How to resume

All P1 items are done. The branch is feature-complete; the natural next move is
to **open the PR** (it's branch `feat/3d-graph-viewer`). Remaining backlog is
deferred/P2: full note-body search, the theming UI, control-toggle camera reset,
bundle code-splitting, and (for true scale) instanced node rendering. Point a
new session at this file + the specs/plans and pick one, e.g.:

> Continue the 3D graph viewer on branch `feat/3d-graph-viewer`. Read
> `docs/graph-viewer-followups.md`, then add **full note-body search**: a
> served-mode `GET /graph/search?q=` endpoint over `_index/tokens.json`, with the
> viewer falling back to metadata search in static mode (spec §7 "Deferred").
> Build with `npm run build:viewer`; smoke-test at http://127.0.0.1:8443/graph.
