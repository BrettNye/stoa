import { it, expect, vi, beforeEach } from "vitest";

const calls: Record<string, unknown[]> = {};
let nodeClickHandler: ((n: unknown) => void) | undefined;

const inst: any = new Proxy(
  {},
  {
    get: (_t, prop: string) =>
      (...args: unknown[]) => {
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
