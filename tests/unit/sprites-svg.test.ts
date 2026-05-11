import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";

import { renderSpriteSvg } from "../../src/core/sprites-svg.js";
import type { Fetcher, SpriteVariant, ColorMode } from "../../src/core/sprites-runtime.js";

// ---------------------------------------------------------------------------
// PNG fixture helper — same quadrant pattern as sprites-runtime.test.ts
// ---------------------------------------------------------------------------
//
//   top-left (0..47, 0..47):      red   (255, 0, 0, 255)
//   top-right (48..95, 0..47):    green (0, 255, 0, 255)
//   bottom-left (0..47, 48..95):  blue  (0, 0, 255, 255)
//   bottom-right (48..95, 48..95): transparent (0, 0, 0, 0)
//
function makeQuadrantPng(): Buffer {
  const width = 96;
  const height = 96;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const left = x < 48;
      const top = y < 48;
      let r = 0, g = 0, b = 0, a = 255;
      if (top && left) { r = 255; }
      else if (top && !left) { g = 255; }
      else if (!top && left) { b = 255; }
      else { a = 0; }
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return PNG.sync.write({ width, height, data });
}

// ---------------------------------------------------------------------------
// Fully-opaque solid PNG — every pixel is red, alpha=255
// ---------------------------------------------------------------------------
function makeSolidPng(): Buffer {
  const width = 96;
  const height = 96;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = 200;     // R
      data[i + 1] = 50;  // G
      data[i + 2] = 50;  // B
      data[i + 3] = 255; // A
    }
  }
  return PNG.sync.write({ width, height, data });
}

// ---------------------------------------------------------------------------
// Fetcher factory
// ---------------------------------------------------------------------------
const ENTRY_URL = "https://pokeapi.co/api/v2/pokemon/squirtle";
const IMAGE_URL = "https://example.com/sprites/squirtle.png";

function makeFetcher(pngBytes?: Buffer): Fetcher {
  const bytes = pngBytes ?? makeQuadrantPng();
  return async (input) => {
    const url = String(input);
    if (url === ENTRY_URL) {
      return new Response(JSON.stringify({ sprites: { front_default: IMAGE_URL } }), { status: 200 });
    }
    if (url === IMAGE_URL) {
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return new Response(ab as ArrayBuffer, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
}

// ---------------------------------------------------------------------------
// Shared test harness
// ---------------------------------------------------------------------------
describe("sprites-svg — renderSpriteSvg", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "stoa-svg-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  // -- 1. Basic structure: viewBox + at least one rect
  it("emits SVG with correct viewBox and at least one rect element", async () => {
    const out = await renderSpriteSvg({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "squirtle",
      spriteVariant: "front_default",
      colorMode: "truecolor",
      vaultPath,
      fetcher: makeFetcher(),
    });

    expect(out.svg).toMatch(/^<svg [^>]*viewBox="0 0 48 24"/);
    expect(out.svg).toMatch(/<rect /);
    expect(out.source).toBe("rendered");
    expect(existsSync(out.cachePath)).toBe(true);
  });

  // -- 2. Cache path uses <name>-<mode>.svg under _index/sprites/
  it("caches SVG at the correct path", async () => {
    const out = await renderSpriteSvg({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "squirtle",
      spriteVariant: "front_default",
      colorMode: "truecolor",
      vaultPath,
      fetcher: makeFetcher(),
    });

    const expectedPath = join(vaultPath, "_index", "sprites", "squirtle-truecolor.svg");
    expect(out.cachePath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
  });

  // -- 3. Second call returns cached result
  it("returns source='cached' on subsequent call", async () => {
    const fetcher = makeFetcher();
    await renderSpriteSvg({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "squirtle",
      spriteVariant: "front_default",
      colorMode: "truecolor",
      vaultPath,
      fetcher,
    });

    const out2 = await renderSpriteSvg({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "squirtle",
      spriteVariant: "front_default",
      colorMode: "truecolor",
      vaultPath,
      fetcher,
    });

    expect(out2.source).toBe("cached");
    expect(out2.svg).toMatch(/<rect /);
  });

  // -- 4. truecolor mode produces fill="rgb(R,G,B)" on rects
  it("produces fill=\"rgb(R,G,B)\" in truecolor mode", async () => {
    const out = await renderSpriteSvg({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "squirtle",
      spriteVariant: "front_default",
      colorMode: "truecolor",
      vaultPath,
      fetcher: makeFetcher(makeSolidPng()),
    });

    // Should contain at least one rgb() fill on a rect
    expect(out.svg).toMatch(/fill="rgb\(\d+,\d+,\d+\)"/);
    // Should not contain ANSI-palette hex codes (those are used in ansi mode)
    // and should not contain "#222" (that's the none mode silhouette color)
    expect(out.svg).not.toContain('fill="#222"');
  });

  // -- 5. ansi mode quantizes to 16-color palette — no rgb() fills
  it("quantizes to ANSI palette colors in ansi mode (no rgb() fills)", async () => {
    const out = await renderSpriteSvg({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "squirtle",
      spriteVariant: "front_default",
      colorMode: "ansi",
      vaultPath,
      fetcher: makeFetcher(makeSolidPng()),
    });

    // No rgb() fills in ansi mode
    expect(out.svg).not.toMatch(/fill="rgb\(/);
    // Should have hex fills (ANSI palette expressed as CSS hex)
    expect(out.svg).toMatch(/fill="#[0-9a-f]{6}"/i);
  });

  // -- 6. none mode produces single-color silhouette (#222)
  it("produces single-color silhouette with fill=\"#222\" in none mode", async () => {
    const out = await renderSpriteSvg({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "squirtle",
      spriteVariant: "front_default",
      colorMode: "none",
      vaultPath,
      fetcher: makeFetcher(makeSolidPng()),
    });

    // All rects should use #222
    expect(out.svg).toContain('fill="#222"');
    // Should not contain rgb() fills or hex-palette colors
    expect(out.svg).not.toMatch(/fill="rgb\(/);
  });

  // -- 7. Transparent cells are NOT emitted as rects (alpha < 0.5 skipped)
  it("omits rects for fully-transparent cells (alpha<0.5)", async () => {
    // Quadrant PNG: bottom-right quadrant is transparent (x>=48, y>=48)
    // That maps to col 24..47, half-rows 12..23 (pixel rows 48..95)
    // → row 6..11 in the character grid (each char row = 2 half-rows = 8 px)
    // Each of these cells should NOT appear as rect with any fills
    const out = await renderSpriteSvg({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "squirtle",
      spriteVariant: "front_default",
      colorMode: "truecolor",
      vaultPath,
      fetcher: makeFetcher(makeQuadrantPng()),
    });

    // Transparent region: col 24..47 for both halves of rows 6..11
    // Total opaque cells should be less than 48*24 = 1152
    const rectMatches = out.svg.match(/<rect /g);
    expect(rectMatches).not.toBeNull();
    // Transparent quadrant = 24 cols * 12 half-rows = 288 transparent cells
    // Plus some boundary cells that straddle the edge may also be transparent
    // Total rects should be at most 1152 - 144 = 1008 (quarter = 6 rows * 24 cols half-pixels)
    // Actually it's half-pixels not char rows: 24 cols * 12 half-rows in bottom-right = 288 transparent half-cells
    // Remaining opaque: at most 1152 - 288 = 864
    expect(rectMatches!.length).toBeLessThan(1152);
    expect(rectMatches!.length).toBeGreaterThan(0);
  });

  // -- 8. SVG dims: rects use x/y/width/height attributes
  it("rects carry x, y, width, height attributes", async () => {
    const out = await renderSpriteSvg({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "squirtle",
      spriteVariant: "front_default",
      colorMode: "none",
      vaultPath,
      fetcher: makeFetcher(makeSolidPng()),
    });

    // Find one <rect ... /> element and verify attributes
    const rectMatch = out.svg.match(/<rect ([^/]+)\/>/);
    expect(rectMatch).not.toBeNull();
    const attrs = rectMatch![1];
    expect(attrs).toMatch(/x="\d+"/);
    expect(attrs).toMatch(/y="\d+"/);
    expect(attrs).toMatch(/width="\d+"/);
    expect(attrs).toMatch(/height="\d+"/);
  });

  // -- 9. SVG is well-formed (starts and ends correctly)
  it("emits well-formed SVG wrapper", async () => {
    const out = await renderSpriteSvg({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "squirtle",
      spriteVariant: "front_default",
      colorMode: "none",
      vaultPath,
      fetcher: makeFetcher(makeSolidPng()),
    });

    expect(out.svg.startsWith("<svg ")).toBe(true);
    expect(out.svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  // -- 10. Different modes produce different cache paths (different files)
  it("uses different cache paths for different colorModes", async () => {
    const fetcher = makeFetcher(makeSolidPng());
    const outTc = await renderSpriteSvg({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "squirtle",
      spriteVariant: "front_default",
      colorMode: "truecolor",
      vaultPath,
      fetcher,
    });
    const outAnsi = await renderSpriteSvg({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "squirtle",
      spriteVariant: "front_default",
      colorMode: "ansi",
      vaultPath,
      fetcher,
    });
    const outNone = await renderSpriteSvg({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "squirtle",
      spriteVariant: "front_default",
      colorMode: "none",
      vaultPath,
      fetcher,
    });

    expect(outTc.cachePath).not.toBe(outAnsi.cachePath);
    expect(outTc.cachePath).not.toBe(outNone.cachePath);
    expect(outAnsi.cachePath).not.toBe(outNone.cachePath);

    // Verify the cache path ends with the mode
    expect(outTc.cachePath).toMatch(/squirtle-truecolor\.svg$/);
    expect(outAnsi.cachePath).toMatch(/squirtle-ansi\.svg$/);
    expect(outNone.cachePath).toMatch(/squirtle-none\.svg$/);
  });
});
