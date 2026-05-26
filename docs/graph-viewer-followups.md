# 3D Graph Viewer — follow-ups & handoff

Handoff for continuing the 3D graph viewer in a fresh session. Captures current
state, what's done, and the prioritized backlog (legend, advanced search,
other improvements).

## Where things stand

- **Branch:** `feat/3d-graph-viewer` · **PR:** https://github.com/BrettNye/stoa/pull/14
- **Spec:** `docs/superpowers/specs/2026-05-26-3d-graph-viewer-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-26-3d-graph-viewer-dag.md` (17 tasks, all done)
- **User docs / smoke checklist:** `docs/graph-viewer.md`
- **Status:** feature complete + reviewed; full test suite green (`npm test`),
  `tsc` + `npm run build:viewer` green. Six bugs found and fixed during manual
  browser testing against the real vault (see "Lessons" below).

### Run it

```powershell
# from the stoa repo dir
npm run build:viewer
$env:STOA_TOKEN_SIGNING_SECRET = "dev-secret"
npm run dev -- serve --vault "C:/Users/brett/Documents/Knowledge"
# open http://127.0.0.1:8443/graph   (or: stoa graph)
```

### Current UI controls (in `viewer/src/main.ts`)

Mode buttons (Regions / All / Focus) · Trackball↔Orbit toggle · By-wiki↔By-type
toggle · directional-particle checkbox · search box · detail panel.

## Backlog

### P1 — Legend
Nothing currently maps colors → meaning, which is rough with 16 wikis.
- Render a legend panel alongside the controls listing each visible
  wiki (when `defaultBy: "wiki"`) or each type (when `defaultBy: "type"`) with its
  resolved swatch color. It must re-derive from the **same** `resolveNodeColor`
  used by the scene so colors match exactly (don't recompute the palette
  independently — import from `viewer/src/theme/resolve.ts`).
- Swap legend contents when the By-wiki/By-type toggle flips.
- Reflect active per-wiki rule overrides (e.g. meal-planning `recipe → red`)
  when present in `graph-themes.json`.
- Collapsible; should not obscure the canvas.

### P1 — Advanced search & filters
The data layer already supports filtering (`computeVisibleGraph` reads
`view.filters = { wikis?, types?, statuses?, tag? }`) but there is **no UI**.
- **Filter panel for "All" mode**: checkboxes/multiselects for wiki, type,
  status, plus a tag input. Wire to `view.filters` and `rerender()`. (Logic is
  done — this is purely the missing UI.)
- **Field-scoped search**: let the query target a field (e.g. `tag:recipe`,
  `wiki:_meta`, `type:decision`) in addition to free text. Extend
  `viewer/src/search/rank.ts` (keep it pure + unit-tested).
- **Full note-body search (deferred in spec)**: a served-mode
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
- **WIKI sentinel dedup**: `WIKI_ID_PREFIX` / `WIKI_NODE_TYPE` are duplicated
  between `viewer/src/main.ts` and `viewer/src/nav/visible-graph.ts`. Export them
  from `visible-graph.ts` and import in `main.ts` (left undone to avoid editing a
  completed task's file mid-DAG).
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

## How to resume

Point a new session at this file + the spec/plan, then pick a P1 item. Suggested
first prompt:

> Continue the 3D graph viewer on branch `feat/3d-graph-viewer`. Read
> `docs/graph-viewer-followups.md`, then implement the **legend** (P1): a panel
> mapping colors → wiki/type using the same `resolveNodeColor`, toggling with the
> By-wiki/By-type control. Build with `npm run build:viewer`; smoke-test served at
> http://127.0.0.1:8443/graph.
