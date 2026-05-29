# 3D Graph Viewer — Node Labels (design)

Date: 2026-05-26
Branch: `feat/3d-graph-viewer`
Status: design — approved in brainstorm, pending spec review
Related: `docs/superpowers/specs/2026-05-26-3d-graph-viewer-design.md`,
`docs/graph-viewer-followups.md`

## Problem

The 3D graph renders nodes as bare colored spheres — there is no text anywhere
on the canvas (not even a hover tooltip). With ~16 wikis and hundreds of notes
you cannot tell what any sphere *is* without clicking it open. We want readable
labels, but naively labeling every node turns a dense graph into unreadable
text soup. The hard part is the **show/hide strategy**, not the rendering.

## Goal

Add camera-facing text labels to the graph under a single **Labels** on/off
toggle (default **on**), governed by a budgeted, layered strategy so the number
of labels on screen stays bounded and readable regardless of dataset size.

Non-goals (deferred): density slider, absolute-distance fade threshold, label
collision/overlap avoidance beyond the budget, edge/link labels, label styling
themes.

## The strategy (settled in brainstorm)

Labels come from four sources, combined into one **label budget with a priority
order**:

1. **Region labels (always on, unbudgeted).** Collapsed-wiki super-nodes
   (`type === "__wiki__"`) always show their wiki name. There are at most ~16,
   and they are the primary orientation aid in the default region view.
2. **Hub landmarks (always on, budgeted).** The top *N* real nodes by `degree`
   in the current view are always labeled — the landmarks you navigate by.
3. **Proximity fill (budgeted).** Remaining budget is filled by the real nodes
   nearest the camera. Scale-free "nearest fill": always show roughly `budget`
   real-node labels (the closest ones), so flying through the graph continuously
   swaps which notes are named. An optional `maxDistance` cap exists in the pure
   API for a future absolute-fade mode but defaults to unbounded in v1.
4. **Hover (always wins).** The node under the cursor is always labeled, even if
   it is beyond the budget.

Defaults: `hubCount = 3`, `budget = 12` real-node labels, `maxDistance = ∞`.
Region labels are independent of `budget`.

## Architecture

Same pure-core / impure-shell split the viewer already uses
(`resolveNodeColor`, `computeLegend`, `computeVisibleGraph` are all pure and
unit-tested; the scene and app shell are the imperative layer).

### 1. Pure selection — `viewer/src/labels/select.ts` (+ `select.test.ts`)

All the logic, none of the three.js. The caller supplies a per-node camera
`distance` each update; the function decides who gets a label.

```ts
export interface LabelCandidate {
  id: string;
  degree: number;        // GraphNode.degree
  distance: number;      // camera→node distance (scene units), supplied by shell
  isRegion: boolean;     // type === "__wiki__"
}

export interface LabelParams {
  hubCount: number;      // always-on top-degree real nodes
  budget: number;        // max real-node labels on screen (hubs count toward it)
  maxDistance?: number;  // optional proximity cap; default Infinity
  hoveredId?: string | null;
}

/** Ordered list of node ids that should display a label, region nodes first. */
export function selectLabeledIds(
  candidates: LabelCandidate[],
  params: LabelParams,
): string[];
```

Selection order:
1. Every `isRegion` candidate (always, unbudgeted).
2. Among non-region candidates: the top `hubCount` by `degree`
   (tie-break: higher degree, then id) — always included, counting toward
   `budget`.
3. Fill the rest of `budget` with the remaining non-region candidates sorted by
   ascending `distance` (tie-break: higher degree, then id), skipping any with
   `distance > maxDistance`.
4. `hoveredId`, if present and a known candidate, is appended if not already
   selected (overrides the budget).

Result is deterministic (explicit tie-breaks) so it is fully unit-testable.

### 2. Rendering shell — `viewer/src/graph/scene.ts`

- Dependency: add **`three-spritetext`** (small, the canonical companion for
  `3d-force-graph`) for camera-facing `SpriteText` labels.
- **Pooled sprites, not one-per-node.** Maintain a small, lazily-grown, reused
  pool of `SpriteText` objects added directly to `fg.scene()`, capped at
  `POOL_CAP` (≈50 = max regions + budget + hover + slack). This bounds object
  and texture count regardless of graph size — critical for "All" mode with
  every node visible. (One-sprite-per-node via `nodeThreeObject` was rejected:
  it allocates a canvas texture per node and does not bound All-mode cost.)
- **Update loop.** While labels are enabled, run a throttled `requestAnimation
  Frame` loop (~10 fps). LOD must react to camera *orbit*, which produces no
  engine ticks once the force layout cools, so a rAF loop is required rather
  than `onEngineTick`. Each tick:
  1. Read visible nodes from `fg.graphData().nodes` and the camera from
     `fg.camera()`.
  2. Build `LabelCandidate[]`: `distance = camera.position.distanceTo(node)`,
     `isRegion = node.type === "__wiki__"`, `degree = node.degree`. Skip nodes
     without finite positions (layout not settled yet).
  3. `selectLabeledIds(candidates, params)`.
  4. Assign pooled sprites to the selected nodes — set each sprite's text
     (via the label accessor), color, and world position to the node's
     `(x, y, z)`; show it; hide leftover pool sprites. Grow the pool up to
     `POOL_CAP` if more labels than sprites are selected.
  5. Optional dirty-check: skip the assign pass if camera, data revision, and
     `hoveredId` are unchanged since last tick.
- **Hover.** Register `fg.onNodeHover(node => …)` to update `hoveredId` and
  request an immediate update.
- **New public methods:** `setLabelsEnabled(on: boolean)`,
  `setLabelAccessor(fn: (n: GraphNode) => string)`. Internal:
  `startLabelLoop()` / `stopLabelLoop()`, `syncLabels()`.
- **Survives the controlType rebuild.** `setControlType` calls
  `fg._destructor()` and `build()` to recreate the instance. The label state
  (`labelsEnabled`, `hoveredId`, accessor, pool config) is retained on the
  instance; `build()` must, like it does for data/particles/colors: re-add the
  sprite pool to the *new* `fg.scene()`, re-register `onNodeHover`, and restart
  the loop if enabled. Pool sprites from the destroyed scene are discarded and
  recreated.
- **Coordinate space (impl verification point).** `3d-force-graph` places node
  objects at their `(x, y, z)` in the root scene; pooled sprites added to
  `fg.scene()` at the same coords should align. Verify during implementation; if
  a parenting transform exists, attach the pool to the same parent group.

### 3. App shell — `viewer/src/main.ts`

- Add a **Labels** toggle button in the existing theme/control group, next to
  Particles (reuse `.controls button` styling; mark `.active` when on).
- On boot: `scene.setLabelAccessor(n => n.title || n.id)` and
  `scene.setLabelsEnabled(true)` (default on). Region super-nodes already carry
  `title = wiki`, so their labels read as the wiki name.
- Toggle handler flips state, calls `scene.setLabelsEnabled(...)`, and
  `syncControlsUI()` updates the button's active state.

## Data flow

```
main (boot)
  → scene.setLabelAccessor(title||id)
  → scene.setLabelsEnabled(true)
        → startLabelLoop()  (rAF ~10fps, while enabled)
              each tick:
                gather visible nodes + camera
                → LabelCandidate[]
                → selectLabeledIds()   [pure]
                → sync pooled SpriteText to chosen nodes
fg.onNodeHover → hoveredId → immediate syncLabels()
Labels toggle  → setLabelsEnabled(on) → start/stop loop, hide pool when off
setControlType → rebuild → re-add pool, re-bind hover, restart loop
```

## Testing

- **`labels/select.test.ts` (pure, primary coverage):**
  - region candidates always included, regardless of budget/distance;
  - top-`hubCount` by degree always included; budget respected (≤ budget
    non-region, excluding the unbudgeted regions);
  - proximity fill picks nearest first; deterministic tie-breaks;
  - `hoveredId` included even when budget is already full; ignored when not a
    candidate;
  - `maxDistance` excludes far nodes from proximity fill but not hubs/hover;
  - empty input → empty result; `budget = 0` → only regions (+ hover).
- **`graph/scene.test.ts`:** extend the existing faithful mock (which must
  expose only real library surface) with `scene()`, `camera()`, and
  `onNodeHover`. Assert `setLabelsEnabled(true/false)` starts/stops the loop and
  shows/hides pooled sprites, and that a `setControlType` rebuild re-establishes
  labels — without relying on real wall-clock timers (inject/stub the rAF
  scheduler, or expose `syncLabels()` for direct invocation).

## Files

- New: `viewer/src/labels/select.ts`, `viewer/src/labels/select.test.ts`
- Edit: `viewer/src/graph/scene.ts` (pool, loop, hover, methods, rebuild path)
- Edit: `viewer/src/main.ts` (Labels toggle, accessor, default-on)
- Edit: `viewer/src/styles.css` (only if the toggle needs anything beyond
  `.controls button`)
- Edit: `package.json` (+ `three-spritetext`)

## Tuning constants (one place)

`hubCount = 3`, `budget = 12`, `maxDistance = Infinity`, `POOL_CAP ≈ 50`,
loop ≈ 10 fps. Easy to revisit after smoke-testing against the real vault.

## Verification

`npm test` (incl. new pure tests) green · `tsc -p viewer/tsconfig.json
--noEmit` clean · `npm run build:viewer` · smoke-test at
http://127.0.0.1:8443/graph: labels readable and bounded in region / expanded /
All / focus views; toggle works; hover names the hovered node; flying changes
which notes are named; switching Trackball↔Orbit keeps labels working.
