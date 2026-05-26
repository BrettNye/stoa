# 3D Graph Viewer

## Overview

The graph viewer is a 3D force-directed visualisation of your vault's link graph, built from the `_index/pages.json` and `_index/links.json` indexes. Each note becomes a node; each wikilink becomes an edge. Color, layout, and filtering let you navigate the whole vault spatially rather than through file trees.

---

## Opening the viewer

### Served — recommended

1. Start the server (if it isn't already running):

   ```bash
   stoa serve
   ```

2. Open the viewer in your browser:

   ```bash
   stoa graph
   ```

   This opens `http://127.0.0.1:8443/graph` (or the host/port from your `.stoa.json` `bind` setting). If you configured `bind: "0.0.0.0:8443"`, `stoa graph` substitutes `127.0.0.1` automatically so the URL is always browsable.

   The `/graph` endpoint is **public** — no bearer token is required. Keep that in mind if you expose Stoa on a non-loopback address.

3. If the server is not running when you call `stoa graph`, you will see:

   ```
   Opening http://127.0.0.1:8443/graph (run `stoa serve` first if the server is not running)
   ```

   Start `stoa serve` in another terminal, then reload the page.

### Static — self-contained file serving

Build the viewer assets:

```bash
npm run build:viewer
```

This writes the compiled single-page app to `dist/viewer/`.

**Constraint:** the viewer fetches `_index/pages.json` and `_index/links.json` at paths relative to whatever origin it is served from. Concretely, `loadStatic(".")` fetches `./_index/pages.json` and `./_index/links.json`. This means the viewer must be served from a location where `_index/` is a sibling directory.

The simplest way to satisfy that constraint is to serve the vault root itself as your static file root, with `dist/viewer/index.html` as the entry point. For example, using any static file server from the vault root:

```bash
# From your vault root — _index/ and dist/viewer/ are siblings here
npx serve . --single
# Then open http://localhost:3000/dist/viewer/index.html
```

Alternatively, copy (or symlink) the contents of `dist/viewer/` into the vault root and open `index.html` directly. The key invariant: the page's origin must be able to fetch `_index/pages.json` and `_index/links.json` at `./`.

If the index is missing or unreachable, a reindex banner appears (see [Reindex banner](#reindex-banner) below).

---

## Navigation modes

Three modes control which nodes appear in the graph. Switch between them with the **Regions / All / Focus** buttons in the top control bar.

| Button | Mode key | Behaviour |
|---|---|---|
| **Regions** (default) | `region` | Each wiki collapses to a single super-node bubble. Click a bubble to expand it and show individual pages; click again to collapse. |
| **All** | `all` | Every page node is rendered at once. Supports filter controls to narrow by wiki, type, status, or tag. |
| **Focus** | `focus` | Shows only the N-hop neighbourhood around the currently selected node. Useful for exploring a dense local cluster without visual noise. |

### Camera controls

The camera defaults to **Trackball** mode. Toggle to **Orbit** with the button in the control bar — the change takes effect immediately without reloading.

| Action | Effect |
|---|---|
| Left-drag | Rotate |
| Scroll wheel | Zoom in / out |
| Right-drag | Pan |

Both trackball and orbit use the same drag/scroll/pan gestures; the difference is in how the up-axis is constrained (trackball is free; orbit locks the horizon).

---

## Theming

### The `graph-themes.json` file

Create (or edit) `graph-themes.json` at the **vault root** to define custom color themes. The viewer loads it automatically on startup — in served mode from `/graph/themes`; in static mode from `./graph-themes.json` relative to the page origin.

The file shape (matches `ThemesFile` in `src/types/theme.ts`):

```json
{
  "active": "my-theme",
  "themes": [
    {
      "name": "my-theme",
      "palette": "default",
      "defaultBy": "wiki",
      "rules": [],
      "perWiki": {}
    }
  ]
}
```

`active` (optional) names which theme to select on load. If omitted, the first theme in the array is used.

### Theme fields

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | string | — | Unique identifier shown in the theme switcher. |
| `palette` | string | `"default"` | Fallback palette used when no rule matches. See [Palettes](#palettes). |
| `defaultBy` | `"wiki"` \| `"type"` | `"wiki"` | The node attribute used to assign palette colors when no rule matches. |
| `rules` | `ColorRule[]` | `[]` | Global color rules applied after `perWiki`. |
| `perWiki` | `Record<wikiName, ColorRule[]>` | `{}` | Per-wiki color rules. Applied before global `rules`. |

A `ColorRule` is:

```json
{ "match": { "wiki": "...", "type": "...", "tag": "...", "status": "...", "idGlob": "..." }, "color": "#rrggbb" }
```

All `match` fields are optional; a rule matches when every field that is present matches the node. `idGlob` supports `*` as a wildcard (e.g. `"concept-*"`).

### Color precedence

Resolution order for each node:

1. **`perWiki[node.wiki]`** — rules in the wiki-specific array, first match wins.
2. **`rules`** — global rules, first match wins.
3. **Palette fallback** — a stable hue derived from `node.wiki` (if `defaultBy: "wiki"`) or `node.type` (if `defaultBy: "type"`), using the named palette.

### Palettes

Built-in palette names:

| Name | Character |
|---|---|
| `default` | One Dark blues, greens, purples, reds |
| `warm` | Reds, ambers, oranges, browns |
| `high-contrast` | White, yellow, cyan, magenta — accessibility-focused |
| `colorblind-safe` | Wong palette, distinguishable under common colour-vision deficiencies |

### Meal-planning example

This example marks all `recipe`-tagged notes in the `meal-planning` wiki red, marks `decision` notes green across the whole vault, and falls back to a wiki-keyed warm palette:

```json
{
  "active": "meal-planning",
  "themes": [
    {
      "name": "meal-planning",
      "palette": "warm",
      "defaultBy": "wiki",
      "rules": [
        { "match": { "type": "decision" }, "color": "#98c379" }
      ],
      "perWiki": {
        "meal-planning": [
          { "match": { "tag": "recipe" }, "color": "#e06c75" },
          { "match": { "type": "concept" }, "color": "#e5c07b" }
        ]
      }
    }
  ]
}
```

For a node in the `meal-planning` wiki tagged `recipe`, resolution goes:

1. `perWiki["meal-planning"]` — first rule matches (`tag: "recipe"`) → color `#e06c75`. Done.

For a `decision` node in any wiki:

1. `perWiki[node.wiki]` — no match (assuming the wiki has no rule for `decision`).
2. `rules` — first rule matches (`type: "decision"`) → color `#98c379`. Done.

### Runtime controls

The control bar exposes two theme controls:

- **By wiki / By type** button — flips `defaultBy` on the fly between `"wiki"` and `"type"` without editing the file. The change is local to the session.
- **Theme selector** (drop-down) — switches between all themes defined in `graph-themes.json`. Switching preserves the current `defaultBy` flip.
- **Particles** checkbox — toggles directional particles on edges to show link direction.

Themes can also be updated programmatically via `PUT /graph/themes` (body: a complete `ThemesFile` JSON object). The server atomically replaces `graph-themes.json` on disk.

---

## Detail panel and search

### Detail panel

Click any individual page node to open the detail panel on the right side. The panel shows:

- The note's title, type, wiki, status, and last-updated date.
- Any tags as chips.
- The full note body rendered as Markdown.

Clicking a wikilink inside the rendered body re-selects that node (auto-expanding its wiki in region mode if needed) and re-opens the panel for the linked note.

Close the panel with the × button.

> Note: note bodies are fetched on demand. In served mode, the server reads the file at the vault path. In static mode, the viewer fetches the file relative to the page origin — the same origin constraint applies as for `_index/`.

### Search

The search box (top right) filters nodes by title in real time. Typing a query surfaces a ranked results list beneath the input. Selecting a result:

1. Auto-expands the result's wiki (if in region mode).
2. Flies the camera to that node via `scene.flyToNode`.
3. Opens the detail panel for the node.

Clearing the input dismisses the results list.

---

## Reindex banner

If the viewer cannot load `_index/pages.json` or `_index/links.json` (missing index, wrong origin, or unbuilt vault), a banner appears at the top of the page instead of rendering the graph:

> The graph index could not be loaded. Run `/reindex` (or `stoa reindex`) to rebuild it, then reload this page.

The viewer does not crash — controls remain mounted. Fix the index and reload.

---

## Manual smoke checklist

Run through these steps after any significant change to the app shell to verify end-to-end behaviour.

1. **First load in region mode.** Open the viewer (served or static) against a populated vault. Confirm: wiki bubble super-nodes appear, camera control reads "Trackball", the By-wiki/By-type button reads "By wiki", and nodes are colored by wiki.

2. **Expand and collapse a wiki bubble.** Click a wiki super-node. Confirm: individual page nodes spread out from the bubble (the wiki is expanded). Click the same position (now the wiki label or empty space where the bubble was). Confirm: the wiki collapses back to a single bubble.

3. **Camera toggle.** Click the "Trackball" button. Confirm: label changes to "Orbit". Drag the scene — rotation should now behave with a locked horizon. Click again; confirm it returns to "Trackball" and free-rotation resumes.

4. **By-wiki/By-type color flip.** Click the "By wiki" button. Confirm: button label changes to "By type" and node colors update to reflect node type rather than wiki membership. Click again; confirm revert to by-wiki coloring.

5. **Detail panel and wikilink navigation.** Click an individual page node (not a wiki super-node). Confirm: the detail panel opens with the note's title and rendered Markdown body. If the body contains a wikilink `[[some-other-page]]`, click it. Confirm: the panel navigates to that note (title changes, body updates).

6. **Search and fly-to.** Type a few characters matching a known note title in the search box. Confirm: a ranked results list appears. Click a result. Confirm: the camera moves toward that node (fly-to), the result's wiki auto-expands if it was collapsed, and the detail panel opens for that note. Clear the search box; confirm the results list dismisses.

7. **Missing index / reindex banner.** Open the viewer with `_index/` absent or unreachable (e.g. wrong origin in static mode, or point the browser at a path that has no `_index/` sibling). Confirm: no JavaScript exception is thrown; the reindex banner appears instead of the graph. Restore the index and reload; confirm the graph renders normally.

---

## Known limitations (MVP)

- **`flyToNode` is a placeholder.** The current implementation calls a zoom-to-fit on the full visible graph rather than animating the camera to the specific selected node. A true fly-to animation is deferred.
- **Search does not highlight on the canvas.** Selecting a search result surfaces a results list; it does not dim unmatched nodes or draw a glow around the matched node. Canvas-level highlight/dim is deferred.
- **Full note-body search is not yet available.** Search only covers node titles and metadata fields indexed in `_index/tokens.json`. Full free-text search of note bodies is deferred.
- **No in-viewer visual theme editor.** Themes must be edited in `graph-themes.json` directly (or via `PUT /graph/themes`). A GUI editor is deferred.

---

## Pointers

- `src/types/theme.ts` — canonical `ThemesFile`, `Theme`, `ColorRule` Zod schemas.
- `viewer/src/theme/resolve.ts` — color resolution logic and built-in palettes.
- `viewer/src/nav/visible-graph.ts` — region / all / focus mode implementations.
- `src/transport/graph-routes.ts` — served endpoints (`GET /graph/data`, `GET /graph/themes`, `PUT /graph/themes`).
- `docs/server-mode.md` — `stoa serve` operator guide.
