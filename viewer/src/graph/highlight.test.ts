import { it, expect } from "vitest";

import { dimColor } from "./highlight.js";

it("amount 0 returns the color unchanged", () => {
  expect(dimColor("#ffffff", 0)).toBe("#ffffff");
});

it("amount 1 returns the background color", () => {
  expect(dimColor("#ffffff", 1)).toBe("#0a0a0a");
});

it("amount 1 with custom bg returns that bg", () => {
  expect(dimColor("#ffffff", 1, "#102030")).toBe("#102030");
});

it("amount 0.5 blends to a mid value between white and the bg", () => {
  // White (0xff = 255) blended halfway toward bg 0x0a (10): round((255+10)/2) = 132 = 0x84..0x85
  const out = dimColor("#ffffff", 0.5);
  // Each channel should sit roughly midway: ~0x85 for bg #0a0a0a.
  const channel = parseInt(out.slice(1, 3), 16);
  expect(channel).toBeGreaterThanOrEqual(0x82);
  expect(channel).toBeLessThanOrEqual(0x88);
  // All three channels equal (white + gray bg => gray result).
  expect(out).toBe(`#${out.slice(1, 3)}${out.slice(1, 3)}${out.slice(1, 3)}`);
});

it("parses 3-digit hex shorthand", () => {
  // #fff expands to #ffffff; amount 0 leaves it as 6-digit white.
  expect(dimColor("#fff", 0)).toBe("#ffffff");
});

it("3-digit shorthand dims like its 6-digit equivalent", () => {
  expect(dimColor("#fff", 0.5)).toBe(dimColor("#ffffff", 0.5));
});

it("clamps amount below 0 to 0", () => {
  expect(dimColor("#61afef", -1)).toBe("#61afef");
});

it("clamps amount above 1 to the bg", () => {
  expect(dimColor("#61afef", 2)).toBe("#0a0a0a");
});

it("preserves per-channel hex for a palette color at amount 0", () => {
  expect(dimColor("#61afef", 0)).toBe("#61afef");
});

it("returns the bg as a safe fallback for unparseable input", () => {
  expect(dimColor("rgb(1,2,3)", 0.5)).toBe("#0a0a0a");
});
