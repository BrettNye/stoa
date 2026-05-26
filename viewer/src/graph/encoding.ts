export type ControlType = "trackball" | "orbit" | "fly";

/**
 * Maps a node degree to a scene-unit radius for 3-D rendering.
 *
 * @param min  Lower radius bound (scene units). Default 2.
 * @param max  Upper radius bound (scene units). Default 12.
 * @param k    Growth coefficient. Radius scales as sqrt(degree) so hubs grow
 *             sub-linearly — very-high-degree nodes stay visible without
 *             overwhelming the scene. Default 0.7.
 */
export function degreeToRadius(
  degree: number,
  { min = 2, max = 12, k = 0.7 }: { min?: number; max?: number; k?: number } = {},
): number {
  return Math.min(max, min + k * Math.sqrt(Math.max(0, degree)));
}

// MVP UI toggle cycles trackball <-> orbit only (fly reachable via config, not the toggle).
// Any non-"trackball" value (including "fly") maps back to "trackball" in this toggle.
export function nextControlType(current: ControlType): ControlType {
  return current === "trackball" ? "orbit" : "trackball";
}
