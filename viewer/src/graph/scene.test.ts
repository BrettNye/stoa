import { it, expect, vi, beforeEach } from "vitest";

const calls: Record<string, unknown[]> = {};
let nodeClickHandler: ((n: unknown) => void) | undefined;
// Backing store for the mock's graphData(): a no-arg call returns this; a call
// with an argument records it (and stores the data so flyToNode can read it back).
let graphStore: { nodes: any[]; links: any[] } = { nodes: [], links: [] };

const inst: any = new Proxy(
  {},
  {
    get: (_t, prop: string) =>
      (...args: unknown[]) => {
        if (prop === "graphData") {
          // No-arg read returns current data; setter records + stores it.
          if (args.length === 0) return graphStore;
          calls[prop] = args;
          graphStore = args[0] as { nodes: any[]; links: any[] };
          return inst;
        }
        calls[prop] = args;
        if (prop === "onNodeClick") {
          nodeClickHandler = args[0] as (n: unknown) => void;
        }
        return inst;
      },
  },
);

vi.mock("3d-force-graph", () => ({ default: () => () => inst }));

import { GraphScene } from "./scene.js";

beforeEach(() => {
  // Clear recorded calls before each test
  for (const key of Object.keys(calls)) {
    delete calls[key];
  }
  nodeClickHandler = undefined;
  graphStore = { nodes: [], links: [] };
});

it("constructor calls the factory and registers onNodeClick", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  // nodeVal should be set during construction
  expect(calls.nodeVal).toBeDefined();
  // onNodeClick should be registered during construction
  expect(calls.onNodeClick).toBeDefined();
  void s;
});

it("forwards control type to the underlying graph", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  s.setControlType("orbit");
  expect(calls.controlType).toEqual(["orbit"]);
});

it("setData forwards { nodes, links } to graphData", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  const graph = {
    nodes: [{ id: "a", wiki: "w", type: "concept", title: "A", summary: "", tags: [], status: "active", updated: "", path: "/a", degree: 3 }],
    links: [{ source: "a", target: "b" }],
  };
  s.setData(graph);
  expect(calls.graphData).toBeDefined();
  const arg = calls.graphData?.[0] as { nodes: unknown[]; links: unknown[] };
  expect(arg.nodes).toBe(graph.nodes);
  expect(arg.links).toBe(graph.links);
});

it("setDirectionalParticles(true) sets particles to 2", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  s.setDirectionalParticles(true);
  expect(calls.linkDirectionalParticles).toEqual([2]);
});

it("setDirectionalParticles(false) sets particles to 0", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  s.setDirectionalParticles(false);
  expect(calls.linkDirectionalParticles).toEqual([0]);
});

it("setControlType forwards all valid ControlType values", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  s.setControlType("trackball");
  expect(calls.controlType).toEqual(["trackball"]);
  s.setControlType("fly");
  expect(calls.controlType).toEqual(["fly"]);
});

it("setNodeColor forwards a color accessor to the library", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  const colorFn = (_n: unknown) => "#ff0000";
  s.setNodeColor(colorFn as any);
  expect(calls.nodeColor).toBeDefined();
});

it("node-click callback is invoked with node id", () => {
  const onClick = vi.fn();
  new GraphScene({} as unknown as HTMLElement, { onNodeClick: onClick });
  // Simulate the library calling back with a node
  if (nodeClickHandler) {
    nodeClickHandler({ id: "my-node" });
  }
  expect(onClick).toHaveBeenCalledWith("my-node");
});

it("nodeVal uses degreeToRadius for node sizing", () => {
  new GraphScene({} as unknown as HTMLElement);
  // The nodeVal accessor was registered; call it with a node
  const accessor = calls.nodeVal?.[0] as (n: unknown) => number;
  expect(typeof accessor).toBe("function");
  // degree 0 => min radius (2), degree 100 => larger
  const r0 = accessor({ degree: 0 });
  const r100 = accessor({ degree: 100 });
  expect(r0).toBe(2); // degreeToRadius(0) = min = 2
  expect(r100).toBeGreaterThan(r0);
});

it("flyToNode calls cameraPosition when the node exists with coordinates", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  s.setData({
    nodes: [{ id: "a", x: 10, y: 20, z: 30 } as any],
    links: [],
  } as any);
  s.flyToNode("a");
  expect(calls.cameraPosition).toBeDefined();
  const [pos, lookAt, ms] = calls.cameraPosition as [
    { x: number; y: number; z: number },
    unknown,
    number,
  ];
  // Camera position is the node direction scaled out past the node.
  expect(pos.x).toBeGreaterThan(10);
  expect(pos.y).toBeGreaterThan(20);
  expect(pos.z).toBeGreaterThan(30);
  // lookAt is the node object itself; duration is a positive ms value.
  expect((lookAt as { id: string }).id).toBe("a");
  expect(ms).toBeGreaterThan(0);
});

it("flyToNode no-ops when the node is not in the graph", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  s.setData({ nodes: [{ id: "a", x: 1, y: 2, z: 3 } as any], links: [] } as any);
  s.flyToNode("missing");
  expect(calls.cameraPosition).toBeUndefined();
});

it("flyToNode no-ops when the node has no position yet", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  s.setData({ nodes: [{ id: "a" } as any], links: [] } as any);
  s.flyToNode("a");
  expect(calls.cameraPosition).toBeUndefined();
});

it("setHighlight dims non-matching nodes and keeps matches at base color", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  s.setNodeColor(((_n: unknown) => "#ffffff") as any);
  s.setHighlight(new Set(["a"]));
  // Re-read the effective accessor registered on the library.
  const accessor = calls.nodeColor?.[0] as (n: unknown) => string;
  expect(typeof accessor).toBe("function");
  const lit = accessor({ id: "a" });
  const dimmed = accessor({ id: "b" });
  expect(lit).toBe("#ffffff");
  expect(dimmed).not.toBe("#ffffff");
  // Dimmed should be closer to the dark bg than the lit base.
  expect(parseInt(dimmed.slice(1, 3), 16)).toBeLessThan(0xff);
});

it("setHighlight(null) restores base colors for all nodes", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  s.setNodeColor(((_n: unknown) => "#61afef") as any);
  s.setHighlight(new Set(["a"]));
  s.setHighlight(null);
  const accessor = calls.nodeColor?.[0] as (n: unknown) => string;
  expect(accessor({ id: "a" })).toBe("#61afef");
  expect(accessor({ id: "b" })).toBe("#61afef");
});

it("setHighlight with an empty set behaves like null (no dimming)", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  s.setNodeColor(((_n: unknown) => "#61afef") as any);
  s.setHighlight(new Set());
  const accessor = calls.nodeColor?.[0] as (n: unknown) => string;
  expect(accessor({ id: "a" })).toBe("#61afef");
  expect(accessor({ id: "b" })).toBe("#61afef");
});

it("setNodeColor after setHighlight recomposes against the active highlight", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  s.setHighlight(new Set(["a"]));
  s.setNodeColor(((_n: unknown) => "#ffffff") as any);
  const accessor = calls.nodeColor?.[0] as (n: unknown) => string;
  expect(accessor({ id: "a" })).toBe("#ffffff");
  expect(accessor({ id: "b" })).not.toBe("#ffffff");
});
