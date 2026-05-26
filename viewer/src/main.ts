import ForceGraph3D from "3d-force-graph";

const container = document.getElementById("graph");
if (!container) {
  throw new Error("Missing #graph container");
}

// Boot an empty 3d-force-graph canvas.
ForceGraph3D()(container).graphData({ nodes: [], links: [] });
