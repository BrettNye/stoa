import ForceGraph3D from "3d-force-graph";
import type { Graph, GraphNode } from "@stoa/types/graph";
import { degreeToRadius, type ControlType } from "./encoding.js";

export interface SceneCallbacks {
  onNodeClick?: (id: string) => void;
}

export class GraphScene {
  private fg: any;

  constructor(el: HTMLElement, cb: SceneCallbacks = {}) {
    this.fg = (ForceGraph3D as any)()(el)
      .nodeVal((n: any) => degreeToRadius(n.degree))
      .onNodeClick((n: any) => cb.onNodeClick?.(n.id));
  }

  setData(g: Graph): void {
    this.fg.graphData({ nodes: g.nodes, links: g.links });
  }

  setNodeColor(fn: (n: GraphNode) => string): void {
    this.fg.nodeColor((n: any) => fn(n));
  }

  setControlType(c: ControlType): void {
    this.fg.controlType(c);
  }

  setDirectionalParticles(on: boolean): void {
    this.fg.linkDirectionalParticles(on ? 2 : 0);
  }

  flyToNode(id: string): void {
    this.fg.zoomToFit?.(0);
    /* implementer: animate camera to node coords */
    void id;
  }
}
