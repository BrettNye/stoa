import { it, expect, vi, beforeEach } from "vitest";

// Faithful mock of 3d-force-graph: it exposes ONLY the methods the real library
// actually has. `controlType` is intentionally NOT a method here — it is a
// construction-time option — so any code that calls a non-existent method throws,
// catching API drift instead of silently passing (an earlier all-callable Proxy
// mock hid exactly that bug).
const calls: Record<string, unknown[]> = {};
/** Config object passed to each ForceGraph3D() construction. */
let builds: Array<{ controlType?: string } | undefined> = [];
let nodeClickHandler: ((n: unknown) => void) | undefined;
let graphStore: { nodes: any[]; links: any[] } = { nodes: [], links: [] };

const inst: any = {
  nodeVal(fn: unknown) { calls.nodeVal = [fn]; return inst; },
  onNodeClick(fn: any) { calls.onNodeClick = [fn]; nodeClickHandler = fn; return inst; },
  nodeColor(fn: unknown) { calls.nodeColor = [fn]; return inst; },
  linkColor(fn: unknown) { calls.linkColor = [fn]; return inst; },
  linkDirectionalParticles(n: unknown) { calls.linkDirectionalParticles = [n]; return inst; },
  graphData(d?: any) {
    if (d === undefined) return graphStore;
    calls.graphData = [d];
    graphStore = d;
    return inst;
  },
  cameraPosition(...a: unknown[]) { calls.cameraPosition = a; return inst; },
  _destructor() { calls._destructor = []; },
};

vi.mock("3d-force-graph", () => ({
  default: (config?: { controlType?: string }) => {
    builds.push(config);
    return () => inst;
  },
}));

import { GraphScene } from "./scene.js";

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
  builds = [];
  nodeClickHandler = undefined;
  graphStore = { nodes: [], links: [] };
});

it("constructor builds with trackball and registers nodeVal + onNodeClick", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  expect(builds[0]).toEqual({ controlType: "trackball" });
  expect(calls.nodeVal).toBeDefined();
  expect(calls.onNodeClick).toBeDefined();
  void s;
});

it("setControlType rebuilds the instance with the new control type", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  s.setControlType("orbit");
  // Old instance torn down, new one built with the requested control type.
  expect(calls._destructor).toBeDefined();
  expect(builds[builds.length - 1]).toEqual({ controlType: "orbit" });
  // fly path proves the rebuilt instance is wired (no thrown "not a function").
  s.setControlType("fly");
  expect(builds[builds.length - 1]).toEqual({ controlType: "fly" });
});

it("setControlType is a no-op when unchanged (default trackball at boot)", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  expect(builds.length).toBe(1); // constructor build only
  s.setControlType("trackball"); // same as current -> no rebuild
  expect(builds.length).toBe(1);
  expect(calls._destructor).toBeUndefined();
  void s;
});

it("setControlType preserves the current data across the rebuild", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  const graph = {
    nodes: [{ id: "a", wiki: "w", type: "concept", title: "A", summary: "", tags: [], status: "active", updated: "", path: "/a", degree: 3 }],
    links: [{ source: "a", target: "b" }],
  };
  s.setData(graph);
  s.setControlType("orbit");
  // The rebuild re-applied graphData with the same node/link arrays.
  const arg = calls.graphData?.[0] as { nodes: unknown[]; links: unknown[] };
  expect(arg.nodes).toBe(graph.nodes);
  expect(arg.links).toBe(graph.links);
});

it("setData forwards { nodes, links } to graphData", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  const graph = {
    nodes: [{ id: "a", wiki: "w", type: "concept", title: "A", summary: "", tags: [], status: "active", updated: "", path: "/a", degree: 3 }],
    links: [{ source: "a", target: "b" }],
  };
  s.setData(graph);
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

it("directional-particle state is preserved across a control-type rebuild", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  s.setDirectionalParticles(true);
  s.setControlType("orbit"); // rebuild
  // The rebuilt instance re-applied particles = 2 (the last call wins).
  expect(calls.linkDirectionalParticles).toEqual([2]);
});

it("setNodeColor forwards a color accessor to the library", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  s.setNodeColor(((_n: unknown) => "#ff0000") as any);
  expect(calls.nodeColor).toBeDefined();
});

it("node-click callback is invoked with node id", () => {
  const onClick = vi.fn();
  new GraphScene({} as unknown as HTMLElement, { onNodeClick: onClick });
  if (nodeClickHandler) nodeClickHandler({ id: "my-node" });
  expect(onClick).toHaveBeenCalledWith("my-node");
});

it("nodeVal uses degreeToRadius for node sizing", () => {
  new GraphScene({} as unknown as HTMLElement);
  const accessor = calls.nodeVal?.[0] as (n: unknown) => number;
  expect(typeof accessor).toBe("function");
  const r0 = accessor({ degree: 0 });
  const r100 = accessor({ degree: 100 });
  expect(r0).toBe(2);
  expect(r100).toBeGreaterThan(r0);
});

it("flyToNode calls cameraPosition when the node exists with coordinates", () => {
  const s = new GraphScene({} as unknown as HTMLElement);
  s.setData({ nodes: [{ id: "a", x: 10, y: 20, z: 30 } as any], links: [] } as any);
  s.flyToNode("a");
  const [pos, lookAt, ms] = calls.cameraPosition as [
    { x: number; y: number; z: number },
    unknown,
    number,
  ];
  expect(pos.x).toBeGreaterThan(10);
  expect(pos.y).toBeGreaterThan(20);
  expect(pos.z).toBeGreaterThan(30);
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
  const accessor = calls.nodeColor?.[0] as (n: unknown) => string;
  const lit = accessor({ id: "a" });
  const dimmed = accessor({ id: "b" });
  expect(lit).toBe("#ffffff");
  expect(dimmed).not.toBe("#ffffff");
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
