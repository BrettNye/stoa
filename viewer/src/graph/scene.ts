import ForceGraph3D, {
  type ForceGraph3DInstance,
  type LinkObject,
} from "3d-force-graph";
import type { Graph, GraphNode } from "@stoa/types/graph";
import { degreeToRadius, type ControlType } from "./encoding.js";
import { dimColor } from "./highlight.js";
import { endId } from "../nav/visible-graph.js";

export interface SceneCallbacks {
  onNodeClick?: (id: string) => void;
}

/** How far toward the background a non-highlighted node is dimmed (0..1). */
const DIM_AMOUNT = 0.8;
/** Camera offset (scene units) from a node when flying to it. */
const FLY_DISTANCE = 120;
/** Camera fly animation duration (ms). */
const FLY_DURATION_MS = 1500;

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
    this.fg._destructor?.();
    this.el.innerHTML = "";
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

  /**
   * (Re)create the underlying graph with the current `controlType` and re-apply
   * all retained state: sizing, click callback, data, particles, colors.
   */
  private build(): void {
    // The package's runtime call style (curried factory) disagrees with its
    // .d.ts (constructor), so the construction call is the one genuine `any`
    // boundary; the resulting instance is fully typed.
    const fg = (ForceGraph3D as any)({ controlType: this.controlType })(
      this.el,
    ) as ForceGraph3DInstance;
    this.fg = fg;
    fg.nodeVal((n) => degreeToRadius((n as GraphNode).degree)).onNodeClick((n) =>
      this.cb.onNodeClick?.((n as GraphNode).id),
    );
    fg.graphData({ nodes: this.data.nodes, links: this.data.links });
    fg.linkDirectionalParticles(this.particles ? 2 : 0);
    this.applyColors();
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
}
