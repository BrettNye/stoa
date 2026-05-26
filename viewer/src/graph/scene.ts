import ForceGraph3D from "3d-force-graph";
import type { Graph, GraphNode } from "@stoa/types/graph";
import { degreeToRadius, type ControlType } from "./encoding.js";
import { dimColor } from "./highlight.js";

export interface SceneCallbacks {
  onNodeClick?: (id: string) => void;
}

/** How far toward the background a non-highlighted node is dimmed (0..1). */
const DIM_AMOUNT = 0.8;

export class GraphScene {
  private fg: any;
  /** Base (theme) color accessor; highlight composes on top of this. */
  private baseColor: (n: GraphNode) => string = () => "#888888";
  /** Active highlight set, or null when nothing is highlighted. */
  private highlight: Set<string> | null = null;

  constructor(el: HTMLElement, cb: SceneCallbacks = {}) {
    this.fg = (ForceGraph3D as any)()(el)
      .nodeVal((n: any) => degreeToRadius(n.degree))
      .onNodeClick((n: any) => cb.onNodeClick?.(n.id));
    // Install the effective color accessor once; it always reflects the latest
    // base color fn + highlight set.
    this.fg.nodeColor((n: any) => this.effectiveColor(n));
  }

  setData(g: Graph): void {
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
    this.fg.controlType(c);
  }

  setDirectionalParticles(on: boolean): void {
    this.fg.linkDirectionalParticles(on ? 2 : 0);
  }

  flyToNode(id: string): void {
    const node = (this.fg.graphData().nodes as any[]).find((n) => n.id === id);
    // Missing node, or layout hasn't assigned coordinates yet -> no-op safely.
    if (!node || typeof node.x !== "number") return;
    const distance = 120;
    const hyp = Math.hypot(node.x, node.y, node.z) || 1;
    const r = 1 + distance / hyp;
    this.fg.cameraPosition(
      { x: node.x * r, y: node.y * r, z: node.z * r },
      node,
      1500,
    );
  }

  /** Re-push the effective accessors so the library recomputes colors. */
  private applyColors(): void {
    this.fg.nodeColor((n: any) => this.effectiveColor(n));
    // Dim links whose endpoints are both outside the highlight set.
    this.fg.linkColor((l: any) => this.effectiveLinkColor(l));
  }

  private effectiveColor(n: GraphNode): string {
    const base = this.baseColor(n);
    if (this.highlight && !this.highlight.has(n.id)) {
      return dimColor(base, DIM_AMOUNT);
    }
    return base;
  }

  private effectiveLinkColor(l: any): string {
    const baseLink = "#ffffff";
    if (!this.highlight) return baseLink;
    const src = typeof l.source === "object" ? l.source?.id : l.source;
    const tgt = typeof l.target === "object" ? l.target?.id : l.target;
    const srcHot = src != null && this.highlight.has(src);
    const tgtHot = tgt != null && this.highlight.has(tgt);
    // Keep a link lit if either endpoint is highlighted; dim the rest.
    return srcHot || tgtHot ? baseLink : dimColor(baseLink, DIM_AMOUNT);
  }
}
