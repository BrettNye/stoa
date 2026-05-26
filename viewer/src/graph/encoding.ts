export type ControlType = "trackball" | "orbit" | "fly";

export function degreeToRadius(degree: number, opts = { min: 2, max: 12, k: 0.7 }): number {
  return Math.min(opts.max, opts.min + opts.k * Math.sqrt(Math.max(0, degree)));
}

// MVP UI toggle cycles trackball <-> orbit only (fly reachable via config, not the toggle).
export function nextControlType(current: ControlType): ControlType {
  return current === "trackball" ? "orbit" : "trackball";
}
