import ForceGraph3D, {
  type ForceGraph3DInstance,
  type LinkObject,
} from "3d-force-graph";
import type { Graph, GraphNode } from "@stoa/types/graph";
import SpriteText from "three-spritetext";
import { degreeToRadius, type ControlType } from "./encoding.js";
import { dimColor } from "./highlight.js";
import { endId, WIKI_NODE_TYPE } from "../nav/visible-graph.js";
import { selectLabeledIds, type LabelCandidate } from "../labels/select.js";

export interface SceneCallbacks {
  onNodeClick?: (id: string) => void;
}

/** How far toward the background a non-highlighted node is dimmed (0..1). */
const DIM_AMOUNT = 0.8;
/** Camera offset (scene units) from a node when flying to it. */
const FLY_DISTANCE = 120;
/** Camera fly animation duration (ms). */
const FLY_DURATION_MS = 1500;

// --- Force-simulation tuning (the vault graph is ~1.2k nodes) ---------------
/**
 * Ticks to run the layout OFF-screen before the first paint, so the violent
 * high-alpha "explosion" from the origin doesn't animate on-screen on every
 * (re)layout. 3d-force-graph defaults this to 0 (whole explosion is visible).
 */
const WARMUP_TICKS = 60;
/**
 * Cap on the on-screen simulation ticks so a large graph stops settling
 * promptly, instead of re-rendering every tick for the default ~15s cooldown.
 */
const COOLDOWN_TICKS = 200;

const HUB_COUNT = 3;
const LABEL_BUDGET = 12;
const POOL_CAP = 50;
/** Min ms between label LOD passes in the rAF loop (~10 fps). */
const LABEL_INTERVAL_MS = 100;

/**
 * The subset of SpriteText / THREE.Object3D surface we actually use.
 * Typed locally so we don't depend on @types/three (not installed).
 */
interface LabelSprite {
  text: string;
  visible: boolean;
  position: { set(x: number, y: number, z: number): void };
}

export class GraphScene {
  // Assigned in build(), which the constructor always calls.
  private fg!: ForceGraph3DInstance;
  private readonly el: HTMLElement;
  private readonly cb: SceneCallbacks;
  /**
   * `controlType` is a construction-time option in 3d-force-graph, NOT a runtime
   * setter, so changing it requires tearing down and rebuilding the instance.
   * We retain all state (data, colors, highlight, particles) and re-apply it.
   */
  private controlType: ControlType = "trackball";
  /** Base (theme) color accessor; highlight composes on top of this. */
  private baseColor: (n: GraphNode) => string = () => "#888888";
  /** Active highlight set, or null when nothing is highlighted. */
  private highlight: Set<string> | null = null;
  /** Last data set, retained so a control-type rebuild can re-apply it. */
  private data: Graph = { nodes: [], links: [] };
  /** Whether directional particles are enabled, retained across rebuilds. */
  private particles = false;

  // Label renderer state (all retained across setControlType rebuilds).
  private labelsEnabled = false;
  private labelAccessor: (n: GraphNode) => string = (n) => n.title;
  private hoveredId: string | null = null;
  private labelPool: LabelSprite[] = [];
  private rafId: number | null = null;

  constructor(el: HTMLElement, cb: SceneCallbacks = {}) {
    this.el = el;
    this.cb = cb;
    this.build();
  }

  setData(g: Graph): void {
    this.data = g;
    this.fg.graphData({ nodes: g.nodes, links: g.links });
  }

  setNodeColor(fn: (n: GraphNode) => string): void {
    this.baseColor = fn;
    this.applyColors();
  }

  /**
   * Highlight a set of node ids: matches render at full theme color, everything
   * else dims toward the background. `null` (or an empty set) clears highlight.
   */
  setHighlight(ids: Set<string> | null): void {
    this.highlight = ids && ids.size > 0 ? ids : null;
    this.applyColors();
  }

  setControlType(c: ControlType): void {
    // No-op when unchanged (e.g. the app shell sets the default at boot) — this
    // avoids a needless teardown/rebuild.
    if (c === this.controlType) return;
    this.controlType = c;
    // Stop the rAF loop before destroying the old instance.
    this.stopLabelLoop();
    this.fg._destructor?.();
    this.el.innerHTML = "";
    // Drop the pool; fresh sprites are created lazily on the next syncLabels().
    this.labelPool = [];
    this.build();
  }

  setDirectionalParticles(on: boolean): void {
    this.particles = on;
    this.fg.linkDirectionalParticles(on ? 2 : 0);
  }

  flyToNode(id: string): void {
    const node = (this.fg.graphData().nodes as any[]).find((n) => n.id === id);
    // Missing node, or layout hasn't assigned all coordinates yet -> no-op safely.
    // Guard every axis: a partially-positioned node would otherwise yield a NaN
    // camera position (the `|| 1` below only catches a zero magnitude, not NaN).
    if (!node || !Number.isFinite(node.x + node.y + node.z)) return;
    const hyp = Math.hypot(node.x, node.y, node.z) || 1;
    const r = 1 + FLY_DISTANCE / hyp;
    this.fg.cameraPosition(
      { x: node.x * r, y: node.y * r, z: node.z * r },
      node,
      FLY_DURATION_MS,
    );
  }

  /** Enable or disable the label layer. Starts/stops the rAF loop. */
  setLabelsEnabled(on: boolean): void {
    this.labelsEnabled = on;
    if (on) {
      this.startLabelLoop();
    } else {
      this.stopLabelLoop();
      this.hideLabels();
    }
  }

  /** Change the text accessor used for label text. Triggers a sync immediately if enabled. */
  setLabelAccessor(fn: (n: GraphNode) => string): void {
    this.labelAccessor = fn;
    this.syncLabels();
  }

  /**
   * One LOD pass: build candidates from camera distance, select, assign pool.
   * Public so tests can drive one deterministic pass without real rAF.
   */
  syncLabels(): void {
    if (!this.labelsEnabled) return;
    const cam = this.fg.camera();
    const nodes = this.fg.graphData().nodes as Array<GraphNode & { x?: number; y?: number; z?: number }>;
    const candidates: LabelCandidate[] = [];
    for (const n of nodes) {
      if (!Number.isFinite((n.x ?? NaN) + (n.y ?? NaN) + (n.z ?? NaN))) continue;
      candidates.push({
        id: n.id,
        degree: n.degree,
        distance: Math.hypot(
          n.x! - cam.position.x,
          n.y! - cam.position.y,
          n.z! - cam.position.z,
        ),
        isRegion: n.type === WIKI_NODE_TYPE,
      });
    }
    const ids = selectLabeledIds(candidates, {
      hubCount: HUB_COUNT,
      budget: LABEL_BUDGET,
      hoveredId: this.hoveredId,
    });
    this.assignPool(ids, nodes);
  }

  /**
   * (Re)create the underlying graph with the current `controlType` and re-apply
   * all retained state: sizing, click callback, data, particles, colors, labels.
   */
  private build(): void {
    // The package's runtime call style (curried factory) disagrees with its
    // .d.ts (constructor), so the construction call is the one genuine `any`
    // boundary; the resulting instance is fully typed.
    const fg = (ForceGraph3D as any)({ controlType: this.controlType })(
      this.el,
    ) as ForceGraph3DInstance;
    this.fg = fg;
    fg.nodeVal((n) => degreeToRadius((n as GraphNode).degree))
      .onNodeClick((n) => this.cb.onNodeClick?.((n as GraphNode).id))
      .onNodeHover((n) => {
        this.hoveredId = n ? (n as GraphNode).id : null;
        this.syncLabels();
      });
    // Bound the force sim so large (re)layouts settle off-screen and stop
    // promptly, rather than exploding on-screen and animating for ~15s.
    fg.warmupTicks(WARMUP_TICKS).cooldownTicks(COOLDOWN_TICKS);
    fg.graphData({ nodes: this.data.nodes, links: this.data.links });
    fg.linkDirectionalParticles(this.particles ? 2 : 0);
    this.applyColors();

    // Re-establish label pool in the new scene and restart loop if enabled.
    this.reAddPoolToScene();
    if (this.labelsEnabled) {
      this.startLabelLoop();
    }
  }

  /** Re-push the effective accessors so the library recomputes colors. */
  private applyColors(): void {
    this.fg.nodeColor((n) => this.effectiveColor(n as GraphNode));
    this.fg.linkColor((l) => this.effectiveLinkColor(l));
  }

  private effectiveColor(n: GraphNode): string {
    const base = this.baseColor(n);
    if (this.highlight && !this.highlight.has(n.id)) {
      return dimColor(base, DIM_AMOUNT);
    }
    return base;
  }

  private effectiveLinkColor(l: LinkObject): string {
    const baseLink = "#ffffff";
    if (!this.highlight) return baseLink;
    // d3-force may have replaced the string endpoints with node refs; endId
    // reads either form (the shared helper from visible-graph).
    const srcHot = this.highlight.has(endId(l.source));
    const tgtHot = this.highlight.has(endId(l.target));
    // Keep a link lit if either endpoint is highlighted; dim the rest.
    return srcHot || tgtHot ? baseLink : dimColor(baseLink, DIM_AMOUNT);
  }

  /**
   * Assign pool sprites to the selected ids. Grows pool up to POOL_CAP by
   * creating new SpriteText instances. Sets text + position + visible for
   * matched sprites; hides leftover pool slots.
   */
  private assignPool(
    ids: string[],
    nodes: Array<GraphNode & { x?: number; y?: number; z?: number }>,
  ): void {
    const scene = this.fg.scene();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Grow pool as needed (up to POOL_CAP)
    const needed = Math.min(ids.length, POOL_CAP);
    while (this.labelPool.length < needed) {
      const sprite = new SpriteText() as unknown as LabelSprite;
      this.labelPool.push(sprite);
      scene.add(sprite as unknown as Parameters<typeof scene.add>[0]);
    }

    // Assign sprite slots to selected ids (up to POOL_CAP)
    const assigned = ids.slice(0, POOL_CAP);
    for (let i = 0; i < this.labelPool.length; i++) {
      const sprite = this.labelPool[i];
      if (i < assigned.length) {
        const n = nodeMap.get(assigned[i]);
        if (n) {
          // Only assign text when it changes: three-spritetext rebuilds a
          // CanvasTexture on every `text` set, so a redundant assignment is a
          // needless GPU upload. position.set is cheap (no regen).
          const text = this.labelAccessor(n);
          if (sprite.text !== text) sprite.text = text;
          sprite.position.set(n.x ?? 0, n.y ?? 0, n.z ?? 0);
          sprite.visible = true;
        } else {
          sprite.visible = false;
        }
      } else {
        sprite.visible = false;
      }
    }
  }

  /** Hide all pooled sprites without removing them from the scene. */
  private hideLabels(): void {
    for (const sprite of this.labelPool) {
      sprite.visible = false;
    }
  }

  /** Re-add existing pool sprites to the current fg scene (after a rebuild). */
  private reAddPoolToScene(): void {
    if (this.labelPool.length === 0) return;
    const scene = this.fg.scene();
    for (const sprite of this.labelPool) {
      scene.add(sprite);
    }
  }

  /** Start the throttled rAF label sync loop. */
  private startLabelLoop(): void {
    if (this.rafId !== null) return; // already running
    // We use requestAnimationFrame if available; in test environments it may not be.
    // Gracefully degrade: if rAF isn't available, the loop just doesn't run
    // (tests drive syncLabels() directly).
    if (typeof requestAnimationFrame === "undefined") return;

    let lastSync = 0;
    const tick = (now: number) => {
      if (now - lastSync >= LABEL_INTERVAL_MS) {
        lastSync = now;
        this.syncLabels();
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** Cancel the rAF loop if running. */
  private stopLabelLoop(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
  }
}
