import { it, expect } from "vitest";
import { degreeToRadius, nextControlType } from "./encoding.js";

it("radius is monotonic non-decreasing and bounded", () => {
  expect(degreeToRadius(0)).toBeLessThan(degreeToRadius(10));
  expect(degreeToRadius(10_000)).toBeLessThanOrEqual(12);
});

it("toggle cycles trackball and orbit", () => {
  expect(nextControlType("trackball")).toBe("orbit");
  expect(nextControlType("orbit")).toBe("trackball");
});

it("clamps negative input to minimum (no NaN)", () => {
  const minRadius = degreeToRadius(0);
  expect(degreeToRadius(-5)).toBe(minRadius);
  expect(Number.isNaN(degreeToRadius(-5))).toBe(false);
});
