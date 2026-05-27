import { it, expect, vi, beforeEach, describe } from "vitest";

// Minimal SpriteText mock: just enough surface for the label pool.
// Must be defined with vi.hoisted so it is available when vi.mock factories run
// (vi.mock is hoisted to top of file by vitest, before class declarations).
const { MockSpriteText } = vi.hoisted(() => {
  class MockSpriteText {
    private _text = "";
    /**
     * Counts text assignments. Models three-spritetext, whose `text` setter
     * calls `_genCanvas()` — rebuilding the canvas and allocating a NEW
     * CanvasTexture (a GPU upload) on EVERY assignment. So redundant `.text`
     * writes are expensive; this counter lets tests assert we don't do them.
     */
    textSetCount = 0;
    get text() {
      return this._text;
    }
    set text(v: string) {
      this._text = v;
      this.textSetCount++;
    }
    visible = true;
    position = {
      set(_x: number, _y: number, _z: number) {},
    };
  }
  return { MockSpriteText };
});

vi.mock("three-spritetext", () => ({
  default: MockSpriteText,
}));

// Faithful mock of 3d-force-graph: it exposes ONLY the methods the real library
// actually has. `controlType` is intentionally NOT a method here — it is a
// construction-time option — so any code that calls a non-existent method throws,
// catching API drift instead of silently passing (an earlier all-callable Proxy
// mock hid exactly that bug).
const calls: Record<string, unknown[]> = {};
/** Config object passed to each ForceGraph3D() construction. */
let builds: Array<{ controlType?: string } | undefined> = [];
let nodeClickHandler: ((n: unknown) => void) | undefined;
let nodeHoverHandler: ((n: unknown) => void) | undefined;
let graphStore: { nodes: any[]; links: any[] } = { nodes: [], links: [] };

// Fake THREE.Scene for label pool tracking
interface FakeScene {
  children: any[];
  add(obj: any): void;
  remove(obj: any): void;
}

let fakeScene: FakeScene;

function makeFakeScene(): FakeScene {
  return {
    children: [],
    add(obj: any) { this.children.push(obj); },
    remove(obj: any) { this.children = this.children.filter((c: any) => c !== obj); },
  };
}

// Camera is positioned at origin by default; tests can override.
let cameraPos = { x: 0, y: 0, z: 0 };

const inst: any = {
  nodeVal(fn: unknown) { calls.nodeVal = [fn]; return inst; },
  onNodeClick(fn: any) { calls.onNodeClick = [fn]; nodeClickHandler = fn; return inst; },
  onNodeHover(fn: any) { calls.onNodeHover = [fn]; nodeHoverHandler = fn; return inst; },
  nodeColor(fn: unknown) { calls.nodeColor = [fn]; return inst; },
  linkColor(fn: unknown) { calls.linkColor = [fn]; return inst; },
  linkDirectionalParticles(n: unknown) { calls.linkDirectionalParticles = [n]; return inst; },
  warmupTicks(n: unknown) { calls.warmupTicks = [n]; return inst; },
  cooldownTicks(n: unknown) { calls.cooldownTicks = [n]; return inst; },
  graphData(d?: any) {
    if (d === undefined) return graphStore;
    calls.graphData = [d];
    graphStore = d;
    return inst;
  },
  cameraPosition(...a: unknown[]) { calls.cameraPosition = a; return inst; },
  camera() { return { position: cameraPos }; },
  scene() { return fakeScene; },
  _destructor() { calls._destructor = []; },
};

vi.mock("3d-force-graph", () => ({
  default: (config?: { controlType?: string }) => {
    builds.push(config);
    return () => inst;
  },
}));

import { GraphScene } from "./scene.js";

// Helper: collect visible text labels from the fake scene
function visibleLabelTexts(): string[] {
  return fakeScene.children
    .filter((c: any) => c instanceof MockSpriteText && c.visible)
    .map((c: any) => c.text);
}

// Shared node fixtures
const hub = {
  id: "hub-1",
  wiki: "w",
  type: "concept",
  title: "Hub Node",
  summary: "",
  tags: [],
  status: "active",
  updated: "",
  path: "/hub-1",
  degree: 9,
  x: 1,
  y: 0,
  z: 0,
};

const leaf = {
  id: "leaf-1",
  wiki: "w",
  type: "concept",
  title: "Leaf Node",
  summary: "",
  tags: [],
  status: "active",
  updated: "",
  path: "/leaf-1",
  degree: 1,
  x: 100,
  y: 100,
  z: 100,
};

const regionNode = {
  id: "wiki:myregion",
  wiki: "myregion",
  type: "__wiki__",
  title: "My Region",
  summary: "",
  tags: [],
  status: "active",
  updated: "",
  path: "",
  degree: 5,
  x: 50,
  y: 0,
  z: 0,
};

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
  builds = [];
  nodeClickHandler = undefined;
  nodeHoverHandler = undefined;
  graphStore = { nodes: [], links: [] };
  fakeScene = makeFakeScene();
  cameraPos = { x: 0, y: 0, z: 0 };
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

it("tunes the force sim for large graphs: warms up off-screen and caps cooldown", () => {
  // The vault graph is ~1.2k nodes; without these the default sim explodes
  // on-screen and re-renders every tick for ~15s ("blow-up" lag).
  new GraphScene({} as unknown as HTMLElement);
  expect((calls.warmupTicks?.[0] as number) ?? 0).toBeGreaterThan(0);
  expect((calls.cooldownTicks?.[0] as number) ?? 0).toBeGreaterThan(0);
});

it("does not re-render a sprite's texture when its label is unchanged across passes", () => {
  // Regression: assignPool used to assign sprite.text every pass, and
  // three-spritetext rebuilds a CanvasTexture on every text set — so a static
  // graph rebuilt ~120 textures/sec, starving the render loop. A redundant
  // syncLabels pass must NOT re-set any visible label's text.
  const s = new GraphScene({} as unknown as HTMLElement);
  s.setData({ nodes: [hub, leaf], links: [] });
  s.setLabelsEnabled(true);

  s.syncLabels();
  const sprites = fakeScene.children.filter(
    (c: any) => c instanceof MockSpriteText,
  );
  const afterFirst = sprites.map((c: any) => c.textSetCount);
  // First pass must have rendered at least one label.
  expect(afterFirst.some((n: number) => n > 0)).toBe(true);

  // Identical state (camera + nodes + hover unchanged): no texture rebuilds.
  s.syncLabels();
  const afterSecond = sprites.map((c: any) => c.textSetCount);
  expect(afterSecond).toEqual(afterFirst);
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

// ---- Label renderer tests ----

describe("label renderer", () => {
  it("labels the highest-degree node when enabled, clears them when disabled", () => {
    const s = new GraphScene({} as unknown as HTMLElement);
    s.setData({ nodes: [hub, leaf], links: [] });
    s.setLabelsEnabled(true);
    s.syncLabels();
    expect(visibleLabelTexts()).toContain(hub.title);
    s.setLabelsEnabled(false);
    expect(visibleLabelTexts()).toEqual([]);
  });

  it("syncLabels does nothing when labels are disabled", () => {
    const s = new GraphScene({} as unknown as HTMLElement);
    s.setData({ nodes: [hub, leaf], links: [] });
    // labels not enabled -- syncLabels should be a no-op
    s.syncLabels();
    expect(visibleLabelTexts()).toEqual([]);
  });

  it("pools SpriteText objects: never creates more than POOL_CAP even with many nodes", () => {
    const POOL_CAP = 50;
    // Build 200 nodes, all with coordinates
    const manyNodes = Array.from({ length: 200 }, (_, i) => ({
      id: `node-${i}`,
      wiki: "w",
      type: "concept",
      title: `Node ${i}`,
      summary: "",
      tags: [],
      status: "active",
      updated: "",
      path: `/node-${i}`,
      degree: i + 1,
      x: i,
      y: 0,
      z: 0,
    }));
    const s = new GraphScene({} as unknown as HTMLElement);
    s.setData({ nodes: manyNodes, links: [] });
    s.setLabelsEnabled(true);
    s.syncLabels();
    // Total SpriteText instances in the scene should never exceed POOL_CAP
    const spriteCount = fakeScene.children.filter(
      (c: any) => c instanceof MockSpriteText
    ).length;
    expect(spriteCount).toBeLessThanOrEqual(POOL_CAP);
  });

  it("region super-nodes (__wiki__ type) are always labeled when enabled", () => {
    const s = new GraphScene({} as unknown as HTMLElement);
    s.setData({ nodes: [regionNode, leaf], links: [] });
    s.setLabelsEnabled(true);
    s.syncLabels();
    // regionNode has type __wiki__ so it must always appear
    expect(visibleLabelTexts()).toContain(regionNode.title);
  });

  it("onNodeHover shows the hovered node label immediately, even beyond budget", () => {
    // Place many hub nodes so the label budget is full, then hover a leaf
    const hubs = Array.from({ length: 20 }, (_, i) => ({
      id: `hub-${i}`,
      wiki: "w",
      type: "concept",
      title: `Hub ${i}`,
      summary: "",
      tags: [],
      status: "active",
      updated: "",
      path: `/hub-${i}`,
      degree: 100 + i,
      x: i,
      y: 0,
      z: 0,
    }));
    const farLeaf = {
      id: "far-leaf",
      wiki: "w",
      type: "concept",
      title: "Far Leaf",
      summary: "",
      tags: [],
      status: "active",
      updated: "",
      path: "/far-leaf",
      degree: 1,
      x: 9999,
      y: 9999,
      z: 9999,
    };
    const s = new GraphScene({} as unknown as HTMLElement);
    s.setData({ nodes: [...hubs, farLeaf], links: [] });
    s.setLabelsEnabled(true);
    s.syncLabels();

    // Hover over the leaf that is far away and low-degree
    if (nodeHoverHandler) nodeHoverHandler(farLeaf);

    expect(visibleLabelTexts()).toContain("Far Leaf");
  });

  it("onNodeHover(null) clears the hover override on next syncLabels", () => {
    // Use many hub nodes to saturate the budget, plus a far leaf that only appears via hover.
    const manyHubs = Array.from({ length: 15 }, (_, i) => ({
      id: `hub-many-${i}`,
      wiki: "w",
      type: "concept",
      title: `Big Hub ${i}`,
      summary: "",
      tags: [],
      status: "active",
      updated: "",
      path: `/hub-many-${i}`,
      degree: 100 + i,
      x: i,
      y: 0,
      z: 0,
    }));
    const farLeaf2 = {
      id: "far-leaf-2",
      wiki: "w",
      type: "concept",
      title: "Far Leaf 2",
      summary: "",
      tags: [],
      status: "active",
      updated: "",
      path: "/far-leaf-2",
      degree: 1,
      x: 9999,
      y: 9999,
      z: 9999,
    };
    const s = new GraphScene({} as unknown as HTMLElement);
    s.setData({ nodes: [...manyHubs, farLeaf2], links: [] });
    s.setLabelsEnabled(true);
    s.syncLabels();
    // Without hover, farLeaf2 should not appear (budget filled by hubs)
    expect(visibleLabelTexts()).not.toContain("Far Leaf 2");

    // Hover over the leaf
    if (nodeHoverHandler) nodeHoverHandler(farLeaf2);
    expect(visibleLabelTexts()).toContain("Far Leaf 2");

    // After hover-out, hoveredId should clear and farLeaf2 drops off
    if (nodeHoverHandler) nodeHoverHandler(null);
    s.syncLabels();
    expect(visibleLabelTexts()).not.toContain("Far Leaf 2");
  });

  it("setControlType rebuild re-establishes labels: pool re-added to new scene, onNodeHover re-bound, loop re-started", () => {
    // Stub rAF so it returns a fake id and does NOT invoke the callback,
    // allowing us to assert the loop actually re-started after the rebuild.
    let rafCallCount = 0;
    const FAKE_RAF_ID = 99;
    vi.stubGlobal("requestAnimationFrame", (_cb: FrameRequestCallback) => {
      rafCallCount++;
      return FAKE_RAF_ID;
    });
    vi.stubGlobal("cancelAnimationFrame", (_id: number) => { /* no-op */ });

    try {
      const s = new GraphScene({} as unknown as HTMLElement);
      s.setData({ nodes: [hub, leaf], links: [] });

      // Enable labels -> startLabelLoop calls rAF once
      s.setLabelsEnabled(true);
      const rafCountAfterEnable = rafCallCount;
      expect(rafCountAfterEnable).toBeGreaterThan(0);

      s.syncLabels();

      // Before rebuild, verify labels are visible
      expect(visibleLabelTexts()).toContain(hub.title);

      // Rebuild: setControlType tears down old instance and calls build(),
      // which calls startLabelLoop() again -> rAF must be called again.
      s.setControlType("orbit");
      expect(rafCallCount).toBeGreaterThan(rafCountAfterEnable);

      // After rebuild, syncLabels should still work (pool re-added to new scene)
      s.syncLabels();
      expect(visibleLabelTexts()).toContain(hub.title);

      // onNodeHover must be re-bound in new build
      expect(calls.onNodeHover).toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("setLabelsEnabled(false) hides all pooled sprites", () => {
    const s = new GraphScene({} as unknown as HTMLElement);
    s.setData({ nodes: [hub, leaf], links: [] });
    s.setLabelsEnabled(true);
    s.syncLabels();
    expect(visibleLabelTexts().length).toBeGreaterThan(0);
    s.setLabelsEnabled(false);
    expect(visibleLabelTexts()).toEqual([]);
  });

  it("setLabelAccessor changes the text used for each sprite", () => {
    const s = new GraphScene({} as unknown as HTMLElement);
    s.setData({ nodes: [hub, leaf], links: [] });
    s.setLabelsEnabled(true);
    // Use id as label accessor instead of title
    s.setLabelAccessor((n) => `id:${n.id}`);
    s.syncLabels();
    expect(visibleLabelTexts()).toContain(`id:${hub.id}`);
  });

  it("rAF loop lifecycle: setLabelsEnabled(false) cancels the frame; re-enabling restarts it", () => {
    // Stub rAF so it returns a deterministic id and NEVER invokes the callback
    // (avoids recursion and gives us a stable id to assert against).
    let rafCallCount = 0;
    let cancelledId: number | undefined;
    const FAKE_RAF_ID = 42;

    vi.stubGlobal("requestAnimationFrame", (_cb: FrameRequestCallback) => {
      rafCallCount++;
      return FAKE_RAF_ID;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      cancelledId = id;
    });

    try {
      const s = new GraphScene({} as unknown as HTMLElement);
      s.setData({ nodes: [hub, leaf], links: [] });

      // Enable labels -> loop must start (rAF called once)
      s.setLabelsEnabled(true);
      expect(rafCallCount).toBe(1);

      // Disable labels -> cancelAnimationFrame must be called with the active rafId
      s.setLabelsEnabled(false);
      expect(cancelledId).toBe(FAKE_RAF_ID);

      // Re-enable -> rAF must be called again (loop re-starts)
      const rafCountBeforeRestart = rafCallCount;
      s.setLabelsEnabled(true);
      expect(rafCallCount).toBeGreaterThan(rafCountBeforeRestart);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
